import MultiViewCore
import UIKit

/// YouTube 來源的播放器（R135）：依設定先用 yt-dlp 解析，成功就用原生播放器播放
/// （沒有 YouTube 的按鈕與廣告，而且可以多格同時出聲）；失敗或設定為內嵌時用 YouTube 內嵌播放器（R90）。
@MainActor
final class YouTubeSourcePlayer: NSObject, CellPlayer {
    let view: UIView
    var onUpdate: ((PlayerUpdate) -> Void)?
    /// 退回內嵌播放器時通知一次（顯示提示用）。
    var onFallback: (() -> Void)?

    var supportsVolume: Bool { inner?.supportsVolume ?? false }
    let isInteractive = false
    /// 解析中還不知道用哪一種；當作原生（不會讓其他網頁格子靜音）。
    var usesWebAudio: Bool { inner?.usesWebAudio ?? false }
    var badge: String? { usingYtDlp ? "yt-dlp" : nil }

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

    init(videoID: String, source: CellSource, methods: YouTubeMethods) {
        let container = UIView()
        container.backgroundColor = .black
        container.clipsToBounds = true
        view = container
        self.videoID = videoID
        self.source = source
        self.methods = methods
        super.init()

        if methods.needsResolve {
            startResolving()
        } else {
            useEmbed()
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

    func shutdown() {
        closed = true
        resolveTask?.cancel()
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
                self?.fallBack()
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
        install(NativePlayer(url: url, source: startingSource(live: stream.isLive)))
    }

    /// yt-dlp 失敗：改用內嵌播放器，從原本的時間點繼續（R90）。
    private func fallBack() {
        guard !closed else { return }
        let wasUsingYtDlp = usingYtDlp || methods.needsResolve
        usingYtDlp = false
        Task { await YtDlpResolver.shared.forget(SourceParser.watchPageURL(videoID: videoID)) }
        useEmbed()
        if wasUsingYtDlp {
            onFallback?()
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

        player.onUpdate = { [weak self, weak player] update in
            guard let self, let player, self.inner === player else { return }
            self.forward(update)
        }
    }

    private func forward(_ update: PlayerUpdate) {
        // 用 yt-dlp 播放時播放器出錯（例如串流網址失效）：退回內嵌播放器
        if usingYtDlp, update.status == .error {
            fallBack()
            return
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
