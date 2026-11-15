import AVFoundation
import AVKit
import MultiViewCore
import UIKit

/// 原生播放器（AVPlayer）：播 mp4、m3u8（規格第 3 節）。
@MainActor
final class NativePlayer: NSObject, CellPlayer {
    let view: UIView
    var onUpdate: ((PlayerUpdate) -> Void)?
    let supportsVolume = true
    let isInteractive = false
    let usesWebAudio = false
    var badge: String? { nil }

    private let player = AVPlayer()
    private let layerView: PlayerLayerView
    private var pictureInPicture: AVPictureInPictureController?
    private var automaticPictureInPicture = false
    private var inBackground = false
    private let item: AVPlayerItem
    private var timeObserver: Any?
    private var observations: [NSKeyValueObservation] = []
    private var endObserver: NSObjectProtocol?
    /// 載入後要跳到的位置（上次的觀看進度，R55）。
    private var pendingResume: Double?
    private var ended = false
    private var failure: String?
    /// 聲音軌（R135、桌面版 R95）：HLS 主清單有多條聲音軌時才有。
    private var audioGroup: AVMediaSelectionGroup?
    private var audioTracks: [RawAudioTrack] = []
    private var audioOptions: [AudioOption] = []
    /// 這一格記住的語言（來源的 audioLang）；nil 為自動。
    private var audioLang: String?
    /// 字幕（R131）：yt-dlp 讀到的字幕；App 自己下載 WebVTT、自己顯示，讀不到字幕不影響播放。
    private let captionTracks: [CaptionTrack]
    /// 下載字幕檔要帶的標頭（yt-dlp 給的 User-Agent、Referer）。
    private let captionHeaders: [String: String]
    /// 目前顯示的字幕（CaptionTrack.key）；關閉時為 nil。
    private var currentCaption: String?
    private var cues: [Cue] = []
    private var captionTask: Task<Void, Never>?
    private var captionObserver: Any?

    /// 能不能選畫質：HLS 才有不同畫質可以選（mp4 只有一種）。
    let supportsQuality: Bool

    /// headers：串流請求要帶的標頭（其他網站用 yt-dlp 播放時，桌面版 R110）。
    /// adaptive：串流是 HLS，可以選畫質（R131）。
    /// captions：yt-dlp 讀到的字幕；captionHeaders：下載字幕檔要帶的標頭，nil 時用 headers（R131）。
    init(
        url: URL, source: CellSource, headers: [String: String] = [:], adaptive: Bool = false,
        captions: [CaptionTrack] = [], captionHeaders: [String: String]? = nil
    ) {
        supportsQuality = adaptive
        captionTracks = captions
        self.captionHeaders = captionHeaders ?? headers
        let layerView = PlayerLayerView()
        layerView.backgroundColor = .black
        layerView.playerLayer.videoGravity = .resizeAspect
        view = layerView
        self.layerView = layerView
        if headers.isEmpty {
            item = AVPlayerItem(url: url)
        } else {
            // AVURLAsset 沒有公開的設定標頭方式；這個鍵是常用的做法
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            item = AVPlayerItem(asset: asset)
        }
        pendingResume = source.resume
        audioLang = source.audioLang
        super.init()

        layerView.playerLayer.player = player
        player.replaceCurrentItem(with: item)
        player.isMuted = source.muted
        player.volume = Float(Volume.fraction(source.volume))
        if adaptive {
            applyQuality(source.quality)
        }
        // AirPlay 只送聲音，畫面留在裝置上（R132）
        player.allowsExternalPlayback = false
        observe()
        loadAudioTracks()
        // 這一格選過的字幕：依 R31 的規則找這部影片的同一種語言
        if let track = CaptionRules.find(captionTracks, key: source.captions) {
            setCaption(track.key)
        }
        if source.autoplay {
            player.play()
        }
    }

    func play() {
        if ended {
            ended = false
            player.seek(to: .zero)
        }
        player.play()
    }

    func pause() {
        player.pause()
    }

    func setMuted(_ muted: Bool) {
        player.isMuted = muted
    }

    func setVolume(_ volume: Int) {
        player.volume = Float(Volume.fraction(volume))
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        ended = false
        pendingResume = nil
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor [weak self] in self?.report() }
        }
    }

    // MARK: 畫質（R131）

    func setQuality(_ quality: Quality) {
        guard supportsQuality else { return }
        applyQuality(quality)
    }

    /// 限制 HLS 的最高畫質：系統只在不超過這個大小的畫質之間自動切換。自動時不限制。
    private func applyQuality(_ quality: Quality) {
        switch quality {
        case .auto:
            item.preferredMaximumResolution = .zero
        case .height(let height):
            // 寬度用 16:9 換算；直式影片也只看高度不超過
            item.preferredMaximumResolution = CGSize(width: CGFloat(height) * 16 / 9, height: CGFloat(height))
        }
    }

    // MARK: 聲音軌（R135、桌面版 R95）

    /// 讀取聲音軌，依「這一格記住的語言 → 系統語言 → 原本的聲音 → 第一條」選擇。
    /// 不選的話 AVPlayer 會自己挑，可能挑到 AI 配音。
    private func loadAudioTracks() {
        let asset = item.asset
        Task { [weak self] in
            guard let group = try? await asset.loadMediaSelectionGroup(for: .audible) else { return }
            self?.audioGroupLoaded(group)
        }
    }

    private func audioGroupLoaded(_ group: AVMediaSelectionGroup) {
        // 已經移除（shutdown 會把 item 拿掉）
        guard player.currentItem === item else { return }
        // LANGUAGE 對應 extendedLanguageTag（沒有時用 locale）；HLS 的 NAME 對應 displayName
        let tracks = group.options.map { option in
            RawAudioTrack(lang: option.extendedLanguageTag ?? option.locale?.identifier, name: option.displayName)
        }
        guard tracks.count >= 2 else { return }
        audioGroup = group
        audioTracks = tracks
        audioOptions = AudioTrackRules.options(tracks)
        let index = AudioTrackRules.pick(tracks, saved: audioLang, system: Locale.preferredLanguages.first ?? "")
        if group.options.indices.contains(index) {
            item.select(group.options[index], in: group)
        }
        report()
    }

    func setAudioTrack(_ option: AudioOption) {
        guard let audioGroup, audioGroup.options.indices.contains(option.index) else { return }
        audioLang = option.lang.isEmpty ? nil : option.lang
        item.select(audioGroup.options[option.index], in: audioGroup)
        report()
    }

    /// 聲音軌選單：不同的聲音軌有兩條以上才顯示。
    private func audioMenu() -> AudioMenu? {
        guard let audioGroup, audioOptions.count >= 2 else { return nil }
        let selected = item.currentMediaSelection.selectedMediaOption(in: audioGroup)
            .flatMap { audioGroup.options.firstIndex(of: $0) } ?? -1
        let current = AudioTrackRules.currentOption(audioTracks, audioOptions, current: selected)
        return AudioMenu(options: audioOptions, current: current)
    }

    // MARK: 字幕（R131）

    func setCaption(_ key: String?) {
        captionTask?.cancel()
        captionTask = nil
        stopCaptionTimer()
        cues = []
        layerView.showCaption(nil)
        let track = captionTracks.first { $0.key == key }
        currentCaption = track?.key
        report()
        guard let track, let url = URL(string: track.url) else { return }
        let headers = captionHeaders
        captionTask = Task { [weak self] in
            guard let cues = await Self.loadCues(url: url, headers: headers), !Task.isCancelled else { return }
            guard let self, self.currentCaption == track.key, self.player.currentItem != nil else { return }
            self.cues = cues
            self.startCaptionTimer()
        }
    }

    /// 下載並解析字幕檔；失敗時回傳 nil。
    private nonisolated static func loadCues(url: URL, headers: [String: String]) async -> [Cue]? {
        var request = URLRequest(url: url, timeoutInterval: 15)
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        return CaptionRules.parseVtt(text)
    }

    /// 約每 0.2 秒依播放位置更新字幕。
    private func startCaptionTimer() {
        stopCaptionTimer()
        guard !cues.isEmpty else { return }
        let interval = CMTime(seconds: 0.2, preferredTimescale: 600)
        captionObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in self?.showCue(at: time.seconds) }
        }
        showCue(at: player.currentTime().seconds)
    }

    private func stopCaptionTimer() {
        if let captionObserver {
            player.removeTimeObserver(captionObserver)
        }
        captionObserver = nil
    }

    private func showCue(at seconds: Double) {
        guard seconds.isFinite else { return }
        layerView.showCaption(CaptionRules.cueAt(cues, seconds: seconds))
    }

    /// 字幕選單：這部影片有字幕才顯示。
    private func captionMenu() -> CaptionMenu? {
        captionTracks.isEmpty ? nil : CaptionMenu(tracks: captionTracks, current: currentCaption)
    }

    // MARK: 子母畫面與背景播放（R132）

    var supportsPictureInPicture: Bool {
        AVPictureInPictureController.isPictureInPictureSupported()
    }

    private func preparePictureInPicture() -> AVPictureInPictureController? {
        if pictureInPicture == nil, supportsPictureInPicture {
            pictureInPicture = AVPictureInPictureController(playerLayer: layerView.playerLayer)
        }
        return pictureInPicture
    }

    func startPictureInPicture() {
        preparePictureInPicture()?.startPictureInPicture()
    }

    func setAutomaticPictureInPicture(_ enabled: Bool) {
        automaticPictureInPicture = enabled
        if enabled {
            preparePictureInPicture()?.canStartPictureInPictureAutomaticallyFromInline = true
        } else {
            pictureInPicture?.canStartPictureInPictureAutomaticallyFromInline = false
        }
    }

    func didEnterBackground(keepAudio: Bool) {
        inBackground = true
        // 子母畫面會自己繼續播
        if pictureInPicture?.isPictureInPictureActive == true { return }
        guard keepAudio else {
            player.pause()
            return
        }
        guard automaticPictureInPicture, pictureInPicture != nil else {
            continueAudioOnly()
            return
        }
        // 回到主畫面時系統會自動進入子母畫面；鎖定螢幕時不會，影片會被暫停。
        // 等一下還沒進入子母畫面的話，改成只播聲音。
        let application = UIApplication.shared
        var task = UIBackgroundTaskIdentifier.invalid
        task = application.beginBackgroundTask {
            application.endBackgroundTask(task)
            task = .invalid
        }
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            if let self, self.inBackground, self.pictureInPicture?.isPictureInPictureActive != true {
                self.continueAudioOnly()
                self.player.play()
            }
            if task != .invalid {
                application.endBackgroundTask(task)
            }
        }
    }

    /// 影片在背景會被系統暫停；把畫面從播放器拿掉，聲音才會繼續。
    private func continueAudioOnly() {
        layerView.playerLayer.player = nil
    }

    func willEnterForeground() {
        inBackground = false
        if layerView.playerLayer.player == nil {
            layerView.playerLayer.player = player
        }
    }

    func shutdown() {
        pictureInPicture?.stopPictureInPicture()
        pictureInPicture = nil
        player.pause()
        captionTask?.cancel()
        captionTask = nil
        stopCaptionTimer()
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        observations.forEach { $0.invalidate() }
        observations = []
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        player.replaceCurrentItem(with: nil)
        onUpdate = nil
    }

    // MARK: 狀態

    private func observe() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.report() }
        }
        observations.append(player.observe(\.timeControlStatus) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.report() }
        })
        observations.append(item.observe(\.status) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.itemStatusChanged() }
        })
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                // 播完後停在最後一個畫面，不自動重播（R2 AC3）
                self?.ended = true
                self?.report()
            }
        }
    }

    private func itemStatusChanged() {
        switch item.status {
        case .readyToPlay:
            if let resume = pendingResume, !item.duration.isIndefinite {
                pendingResume = nil
                player.seek(to: CMTime(seconds: resume, preferredTimescale: 600))
            }
        case .failed:
            failure = item.error?.localizedDescription ?? "無法播放這個影片"
        default:
            break
        }
        report()
    }

    private func report() {
        let status: PlayStatus
        if failure != nil {
            status = .error
        } else if ended {
            status = .ended
        } else {
            switch player.timeControlStatus {
            case .playing:
                status = .playing
            case .waitingToPlayAtSpecifiedRate:
                status = .loading
            default:
                status = item.status == .readyToPlay ? .paused : .loading
            }
        }
        onUpdate?(PlayerUpdate(
            status: status, progress: currentProgress(), title: nil, errorMessage: failure, audio: audioMenu(),
            captions: captionMenu()
        ))
    }

    private func currentProgress() -> PlaybackProgress? {
        guard item.status == .readyToPlay else { return nil }
        let duration = item.duration
        let durationSeconds: Double
        if duration.isIndefinite {
            durationSeconds = .infinity
        } else if duration.isNumeric {
            durationSeconds = duration.seconds
        } else {
            durationSeconds = .nan
        }
        let ranges: [ClosedRange<Double>] = item.seekableTimeRanges.compactMap { value in
            let range = value.timeRangeValue
            let start = range.start.seconds
            let end = range.end.seconds
            guard start.isFinite, end.isFinite, end >= start else { return nil }
            return start...end
        }
        let current = player.currentTime().seconds
        return ProgressRules.fromMedia(MediaInfo(
            duration: durationSeconds,
            currentTime: current.isFinite ? current : 0,
            seekable: ranges
        ))
    }
}

/// 以 AVPlayerLayer 當作圖層的 view，大小跟著格子改變。字幕疊在影片下方（R131）。
final class PlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer {
        // layerClass 已經指定成 AVPlayerLayer
        layer as! AVPlayerLayer // swiftlint:disable:this force_cast
    }

    private let captionLabel: CaptionLabel = {
        let label = CaptionLabel()
        label.textColor = .white
        label.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.layer.cornerRadius = 4
        label.layer.masksToBounds = true
        label.isHidden = true
        label.isUserInteractionEnabled = false
        return label
    }()

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(captionLabel)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        addSubview(captionLabel)
    }

    /// 顯示字幕；nil 時隱藏。
    func showCaption(_ text: String?) {
        guard let text, !text.isEmpty else {
            captionLabel.isHidden = true
            return
        }
        let wasHidden = captionLabel.isHidden
        captionLabel.isHidden = false
        if wasHidden || captionLabel.text != text {
            captionLabel.text = text
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard !captionLabel.isHidden, bounds.width > 0 else { return }
        // 字的大小跟著格子：高度的 5% 和寬度的 4.5% 取小的，最小 10pt
        // （直向時格子很高，只看高度字會太大、長句超出畫面；Android 0.0.17、iOS 0.0.30 實測）
        let fontSize = max(10, min(bounds.height * 0.05, bounds.width * 0.045))
        if captionLabel.font.pointSize != fontSize {
            captionLabel.font = .systemFont(ofSize: fontSize, weight: .medium)
        }
        let maxWidth = bounds.width * 0.9
        let fitted = captionLabel.sizeThatFits(CGSize(width: maxWidth, height: .greatestFiniteMagnitude))
        let width = min(maxWidth, fitted.width)
        let height = min(bounds.height, fitted.height)
        captionLabel.frame = CGRect(
            x: (bounds.width - width) / 2,
            y: max(0, bounds.height - bounds.height * 0.06 - height),
            width: width,
            height: height
        )
    }
}

/// 有內距的字幕文字。
private final class CaptionLabel: UILabel {
    private let insets = UIEdgeInsets(top: 2, left: 8, bottom: 2, right: 8)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let inner = super.sizeThatFits(CGSize(
            width: max(0, size.width - insets.left - insets.right),
            height: size.height
        ))
        return CGSize(width: inner.width + insets.left + insets.right, height: inner.height + insets.top + insets.bottom)
    }
}
