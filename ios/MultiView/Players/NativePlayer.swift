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

    /// 能不能選畫質：HLS 才有不同畫質可以選（mp4 只有一種）。
    let supportsQuality: Bool

    /// headers：串流請求要帶的標頭（其他網站用 yt-dlp 播放時，桌面版 R110）。
    /// adaptive：串流是 HLS，可以選畫質（R131）。
    init(url: URL, source: CellSource, headers: [String: String] = [:], adaptive: Bool = false) {
        supportsQuality = adaptive
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
        onUpdate?(PlayerUpdate(status: status, progress: currentProgress(), title: nil, errorMessage: failure))
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

/// 以 AVPlayerLayer 當作圖層的 view，大小跟著格子改變。
final class PlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer {
        // layerClass 已經指定成 AVPlayerLayer
        layer as! AVPlayerLayer // swiftlint:disable:this force_cast
    }
}
