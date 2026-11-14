import MultiViewCore
import UIKit

/// 網頁來源的播放器（桌面版 R12、R102、R103；iOS 版 R135、R137）。
/// 其他網站的播放方式是 yt-dlp 時，先用 yt-dlp 解析，成功就用原生播放器播放（可以多格同時出聲）；
/// 失敗或播放方式是網頁時，顯示網頁（WebPagePlayer）。
@MainActor
final class WebSourcePlayer: NSObject, CellPlayer {
    let view: UIView
    var onUpdate: ((PlayerUpdate) -> Void)?
    var onModeChange: ((WebMode) -> Void)?
    var onNotice: ((String) -> Void)?
    var onYouTubeVideo: ((String) -> Void)?

    var supportsVolume: Bool { inner?.supportsVolume ?? false }
    var isInteractive: Bool { inner?.isInteractive ?? false }
    var usesWebAudio: Bool { inner?.usesWebAudio ?? false }
    var badge: String? { usingYtDlp ? "yt-dlp" : nil }
    var isResolving: Bool { inner == nil && !closed }
    var supportsPictureInPicture: Bool { inner?.supportsPictureInPicture ?? false }

    /// 正在顯示網頁時的網頁播放器；用 yt-dlp 播放或解析中時為 nil。
    var webPage: WebPagePlayer? { inner as? WebPagePlayer }

    private let url: URL
    private var source: CellSource
    private let mode: WebMode
    private let interceptYouTube: Bool
    private var inner: CellPlayer?
    private var usingYtDlp = false
    private var closed = false
    private var wantsPlaying: Bool?
    private var automaticPictureInPicture = false

    init(url: URL, source: CellSource, mode: WebMode, interceptYouTube: Bool, method: WebMethod) {
        let container = UIView()
        container.backgroundColor = .black
        container.clipsToBounds = true
        view = container
        self.url = url
        self.source = source
        self.mode = mode
        self.interceptYouTube = interceptYouTube
        super.init()

        // YouTube 網站頁面一律用網頁（R57）
        if method == .ytdlp, !interceptYouTube {
            resolve()
        } else {
            showPage()
        }
    }

    // MARK: CellPlayer

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

    func shutdown() {
        closed = true
        inner?.shutdown()
        inner = nil
        onUpdate = nil
        onModeChange = nil
        onNotice = nil
        onYouTubeVideo = nil
    }

    // MARK: yt-dlp（R103）

    private func resolve() {
        Task { [weak self] in
            guard let self else { return }
            do {
                let stream = try await YtDlpResolver.shared.resolve(self.url.absoluteString)
                self.resolved(stream)
            } catch {
                // 不支援的網站、解析失敗：顯示網頁（桌面版 R103）
                self.showPage()
            }
        }
    }

    private func resolved(_ stream: YtStream) {
        guard !closed, let streamURL = URL(string: stream.url) else {
            showPage()
            return
        }
        usingYtDlp = true
        var start = startingSource()
        if stream.isLive { start.resume = nil }
        install(NativePlayer(
            url: streamURL, source: start, headers: Self.headers(page: url, fromYtdlp: stream.headers), adaptive: stream.kind == .hls
        ))
    }

    /// 串流要帶的標頭：Referer 是原本的網頁網址，yt-dlp 有提供時用 yt-dlp 的（桌面版 R110）。
    static func headers(page: URL, fromYtdlp: [String: String]) -> [String: String] {
        var out = fromYtdlp
        if !out.keys.contains(where: { $0.lowercased() == "referer" }) {
            out["Referer"] = page.absoluteString
        }
        return out
    }

    private func showPage() {
        guard !closed else { return }
        usingYtDlp = false
        let page = WebPagePlayer(
            url: url, source: startingSource(), mode: mode, adblock: source.adblock, interceptYouTube: interceptYouTube
        )
        page.onModeChange = { [weak self] mode in self?.onModeChange?(mode) }
        page.onNotice = { [weak self] text in self?.onNotice?(text) }
        page.onYouTubeVideo = { [weak self] href in self?.onYouTubeVideo?(href) }
        install(page)
        onModeChange?(page.mode)
    }

    private func startingSource() -> CellSource {
        var start = source
        if let wantsPlaying {
            start.autoplay = wantsPlaying
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
            // yt-dlp 的串流播放失敗：改顯示網頁
            if self.usingYtDlp, update.status == .error {
                self.showPage()
                return
            }
            self.onUpdate?(update)
        }
    }
}
