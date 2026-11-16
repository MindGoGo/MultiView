import MultiViewCore
import UIKit

/// YouTube 來源的播放器（R135）：依設定先用 yt-dlp 解析，成功就用原生播放器播放
/// （沒有 YouTube 的按鈕與廣告，而且可以多格同時出聲）；失敗或設定為內嵌時用 YouTube 內嵌播放器（R90）。
@MainActor
final class YouTubeSourcePlayer: NSObject, CellPlayer {
    let view: UIView
    var onUpdate: ((PlayerUpdate) -> Void)?
    /// 退回內嵌播放器時通知一次（顯示提示用）；參數是失敗的原因。
    var onFallback: ((String) -> Void)?

    var supportsVolume: Bool { inner?.supportsVolume ?? false }
    let isInteractive = false
    /// 解析中還不知道用哪一種；當作原生（不會讓其他網頁格子靜音）。
    var usesWebAudio: Bool { inner?.usesWebAudio ?? false }
    var badge: String? { usingYtDlp ? "yt-dlp" : nil }
    /// 還沒有裡面的播放器：yt-dlp 解析中。
    var isResolving: Bool { inner == nil && !closed }

    private let videoID: String
    private var source: CellSource
    private let methods: YouTubeMethods
    private var inner: CellPlayer?
    private var usingYtDlp = false
    private var resolveTask: Task<Void, Never>?
    private var closed = false
    /// 使用者在解析完成前按了播放或暫停；nil 表示沒按過，照來源原本的設定。
    private var wantsPlaying: Bool?
    /// 目前的觀看位置（退回內嵌時從這裡繼續）。
    private var lastPosition: Double?
    private var title: String?
    private var automaticPictureInPicture = false
    /// 播放中斷後已經重新解析幾次；開始播放後歸零。
    private var retries = 0
    /// 最近一次回報的狀態是不是播放中（重新解析後維持原本的播放或暫停）。
    private var wasPlaying = false

    /// SponsorBlock（R161）：設定、這部影片的片段（還沒過濾；nil 是還沒抓到）、背景的請求。
    private var sponsorBlock: SponsorBlockSettings
    private var sponsorRaw: [SponsorSegment]?
    private var sponsorTask: Task<Void, Never>?
    /// yt-dlp 解析出來是直播：不抓片段。
    private var isLive = false

    /// 播放中斷時最多重新解析幾次（R90）。
    private static let maxRetries = 3

    init(videoID: String, source: CellSource, methods: YouTubeMethods, sponsorBlock: SponsorBlockSettings = SponsorBlockSettings()) {
        let container = UIView()
        container.backgroundColor = .black
        container.clipsToBounds = true
        view = container
        self.videoID = videoID
        self.source = source
        self.methods = methods
        self.sponsorBlock = sponsorBlock
        super.init()

        if methods.needsResolve {
            startResolving()
        } else {
            useEmbed()
        }
        // 影片 ID 一開始就知道：和 yt-dlp 解析同時在背景抓片段
        fetchSponsorSegments()
    }

    // MARK: SponsorBlock（R161）：只有 yt-dlp 播放的一般影片（內嵌播放器沒有這些）

    func undoSkip() {
        inner?.undoSkip()
    }

    func setSponsorBlock(_ settings: SponsorBlockSettings) {
        sponsorBlock = settings
        inner?.setSponsorBlock(settings)
        fetchSponsorSegments()
    }

    /// 在背景抓 SponsorBlock 的片段：開啟、一般影片用 yt-dlp 播放、不是直播、還沒抓過時才抓。
    /// 抓不到（失敗、逾時）當作沒有片段，不影響播放。
    private func fetchSponsorSegments() {
        guard !closed, sponsorBlock.active, methods.vod == .ytdlp, !isLive else { return }
        guard sponsorRaw == nil, sponsorTask == nil else { return }
        let id = videoID
        sponsorTask = Task { [weak self] in
            let raw = await SponsorBlockClient.segments(videoID: id)
            guard !Task.isCancelled, let self, !self.closed else { return }
            self.sponsorTask = nil
            self.sponsorRaw = raw
            (self.inner as? NativePlayer)?.loadSponsorSegments(raw)
        }
    }

    func play() {
        wantsPlaying = true
        inner?.play()
    }

    func pause() {
        wantsPlaying = false
        inner?.pause()
    }

    func setMuted(_ muted: Bool) {
        source.muted = muted
        inner?.setMuted(muted)
    }

    func setVolume(_ volume: Int) {
        source.volume = volume
        inner?.setVolume(volume)
    }

    func seek(to seconds: Double) {
        inner?.seek(to: seconds)
    }

    var supportsPictureInPicture: Bool { inner?.supportsPictureInPicture ?? false }

    func startPictureInPicture() {
        inner?.startPictureInPicture()
    }

    func setAutomaticPictureInPicture(_ enabled: Bool) {
        automaticPictureInPicture = enabled
        inner?.setAutomaticPictureInPicture(enabled)
    }

    func didEnterBackground(keepAudio: Bool) {
        inner?.didEnterBackground(keepAudio: keepAudio)
    }

    func willEnterForeground() {
        inner?.willEnterForeground()
    }

    var supportsQuality: Bool { inner?.supportsQuality ?? false }

    func setQuality(_ quality: Quality) {
        source.quality = quality
        inner?.setQuality(quality)
    }

    /// 記住選的語言，重新解析時沿用（R135）。
    func setAudioTrack(_ option: AudioOption) {
        source.audioLang = option.lang.isEmpty ? nil : option.lang
        inner?.setAudioTrack(option)
    }

    /// 記住選的字幕，重新解析時沿用（R131）。
    func setCaption(_ key: String?) {
        source.captions = key
        inner?.setCaption(key)
    }

    func shutdown() {
        PreviewThumbnails.setStoryboard(nil, for: source.id)
        closed = true
        resolveTask?.cancel()
        sponsorTask?.cancel()
        sponsorTask = nil
        inner?.shutdown()
        inner = nil
        onUpdate = nil
        onFallback = nil
    }

    // MARK: yt-dlp

    private func startResolving() {
        // 解析中：格子顯示讀取動畫
        let url = SourceParser.watchPageURL(videoID: videoID)
        resolveTask = Task { [weak self] in
            do {
                let stream = try await YtDlpResolver.shared.resolve(url)
                self?.resolved(stream)
            } catch {
                let reason = (error as? YtDlpRules.ResolveError)?.message ?? error.localizedDescription
                self?.fallBack(reason)
            }
        }
    }

    private func resolved(_ stream: YtStream) {
        guard !closed else { return }
        title = stream.title
        // 每一組（直播、一般影片）各自的播放方式（R88）
        let method = stream.isLive ? methods.live : methods.vod
        guard method == .ytdlp, let url = URL(string: stream.url) else {
            useEmbed()
            return
        }
        usingYtDlp = true
        PreviewThumbnails.setStoryboard(stream.storyboard, for: source.id)
        let native = NativePlayer(
            url: url, source: startingSource(live: stream.isLive), adaptive: stream.kind == .hls,
            captions: stream.captions, captionHeaders: stream.headers
        )
        install(native)
        // SponsorBlock（R161）：直播不處理
        isLive = stream.isLive
        if isLive {
            sponsorTask?.cancel()
            sponsorTask = nil
        } else {
            native.setSponsorBlock(sponsorBlock)
            if let sponsorRaw {
                native.loadSponsorSegments(sponsorRaw)
            }
            fetchSponsorSegments()
        }
    }

    /// yt-dlp 失敗：改用內嵌播放器，從原本的時間點繼續（R90）。
    private func fallBack(_ reason: String) {
        guard !closed else { return }
        usingYtDlp = false
        Task { await YtDlpResolver.shared.forget(SourceParser.watchPageURL(videoID: videoID)) }
        useEmbed()
        onFallback?(reason)
    }

    /// 播放中斷（例如串流網址過期）：重新解析，從原本的位置繼續。
    private func retry() {
        retries += 1
        wantsPlaying = wantsPlaying ?? wasPlaying
        inner?.shutdown()
        inner = nil
        view.subviews.forEach { $0.removeFromSuperview() }
        onUpdate?(PlayerUpdate(status: .loading, progress: nil, title: title, errorMessage: nil))
        let url = SourceParser.watchPageURL(videoID: videoID)
        resolveTask = Task { [weak self] in
            await YtDlpResolver.shared.forget(url)
            self?.startResolving()
        }
    }

    private func useEmbed() {
        guard !closed else { return }
        usingYtDlp = false
        install(YouTubePlayer(videoID: videoID, source: startingSource(live: false)))
    }

    /// 建立裡面的播放器時用的來源：帶上目前的靜音、音量、播放狀態與位置。
    private func startingSource(live: Bool) -> CellSource {
        var start = source
        if let wantsPlaying {
            start.autoplay = wantsPlaying
        }
        if live {
            start.resume = nil
        } else if let lastPosition {
            start.resume = lastPosition
        }
        return start
    }

    private func install(_ player: CellPlayer) {
        inner?.shutdown()
        view.subviews.forEach { $0.removeFromSuperview() }
        inner = player
        let content = player.view
        content.frame = view.bounds
        content.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(content)

        player.setAutomaticPictureInPicture(automaticPictureInPicture)

        player.onUpdate = { [weak self, weak player] update in
            guard let self, let player, self.inner === player else { return }
            self.forward(update)
        }
    }

    private func forward(_ update: PlayerUpdate) {
        // 用 yt-dlp 播放時播放器出錯（例如串流網址過期）：重新解析，3 次都失敗才退回內嵌播放器（R90）
        if usingYtDlp, update.status == .error {
            if retries < YouTubeSourcePlayer.maxRetries {
                retry()
            } else {
                fallBack(update.errorMessage ?? "播放中斷")
            }
            return
        }
        if update.status == .playing {
            retries = 0
            wasPlaying = true
            wantsPlaying = nil
        } else if update.status == .paused || update.status == .ended {
            wasPlaying = false
        }
        if let progress = update.progress, !progress.live {
            lastPosition = progress.current
        }
        var next = update
        if next.title == nil {
            next.title = title
        }
        onUpdate?(next)
    }
}
