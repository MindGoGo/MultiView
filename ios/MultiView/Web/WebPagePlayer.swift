import MultiViewCore
import UIKit
import WebKit

/// 網頁格子的兩種顯示方式（桌面版 R13、R14）。
enum WebMode: String {
    /// 只顯示網頁中的影片：影片填滿格子，點擊由格子攔下。
    case video
    /// 顯示整個網頁：可以點擊、捲動、輸入。
    case page
}

/// 網頁格子（桌面版 R12–R17、R57、R113；iOS 版 R137、R138）。
/// 網頁的每一個框架都注入桌面版的偵測程式（ios/web/inject.ts），由它找主要影片、只顯示影片、回報播放狀態。
@MainActor
final class WebPagePlayer: NSObject, CellPlayer, WKNavigationDelegate, WKScriptMessageHandler {
    var view: UIView { container }
    var onUpdate: ((PlayerUpdate) -> Void)?
    /// 顯示方式改變（找不到影片時自動換成整頁、按「只顯示影片」找到影片時換回來）。
    var onModeChange: ((WebMode) -> Void)?
    /// 要顯示給使用者的提示（例如「找不到影片」）。
    var onNotice: ((String) -> Void)?
    /// YouTube 網站頁面裡點了影片（桌面版 R57）：這一格換成那部影片。
    var onYouTubeVideo: ((String) -> Void)?

    /// iOS 上網頁不能設定影片的音量。
    let supportsVolume = false
    var isInteractive: Bool { mode == .page }
    let usesWebAudio = true
    var badge: String? { nil }

    private(set) var mode: WebMode
    private let webView: WKWebView
    private let container: ScaledWebContainer
    private let pageURL: URL
    private let interceptYouTube: Bool

    // 送給網頁的狀態（桌面版 WebState）
    private var version = 0
    private var intent: String
    private var muted: Bool
    private var volume: Int
    private var kick = 0
    private var pauseOnStart = false

    // 網頁回報的結果
    private var loaded = false
    private var found = false
    private var failed = false
    private var lastProgress: PlaybackProgress?
    private var lastStatus: PlayStatus?
    private var title: String?

    /// 上次的觀看進度（R55）：等影片長度大於這個位置才跳過去；30 秒內等不到就放棄。
    private var pendingStart: Double?
    private var pendingSince: Date?

    private var loadTimer: Task<Void, Never>?
    private var noVideoTimer: Task<Void, Never>?
    private var autoKickTimer: Task<Void, Never>?
    private var autoKickDone = false
    private var waitVideoTimer: Task<Void, Never>?

    private static let handlerName = "multiview"
    /// 從開始載入算起，這麼久還沒載入完成就算失敗（桌面版 R16）。
    private static let loadTimeout: Duration = .seconds(30)
    /// 網頁載入完成後找不到主要影片多久就切換成整頁模式（桌面版 R13 AC4）。
    private static let noVideoTimeout: Duration = .seconds(15)
    /// 影片模式、網頁載入完成後這麼久還找不到影片，自動按一次網站的播放鈕（桌面版 R113）。
    private static let autoKickDelay: Duration = .seconds(3)
    /// 按「只顯示影片」時自動按播放後，最多等這麼久找影片（桌面版 R113）。
    private static let kickWait: Duration = .seconds(6)
    private static let pendingStartTimeout: TimeInterval = 30

    /// 注入網頁的程式（編譯時由 ios/scripts/build-web.sh 產生，放在 App 的 web/web-inject.js）。
    private static let injectedScript: String? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("web/web-inject.js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    init(url: URL, source: CellSource, mode: WebMode, adblock: Bool, interceptYouTube: Bool) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        container = ScaledWebContainer(webView: webView)
        pageURL = url
        self.mode = mode
        self.interceptYouTube = interceptYouTube
        intent = source.autoplay ? "play" : "pause"
        muted = source.muted
        volume = source.volume
        pendingStart = source.resume
        super.init()

        let controller = configuration.userContentController
        controller.add(WeakMessageHandler(self), name: Self.handlerName)
        if let script = Self.injectedScript {
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }

        webView.navigationDelegate = self
        // 沒有設定 uiDelegate：網頁要開新視窗一律不開（和桌面版相同）
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        applyModeToView()
        report(.loading)

        Task { [weak self] in
            // 廣告阻擋：規則還沒準備好時最多等一下，等不到就先不擋（R138）
            if adblock {
                let lists = await AdBlocker.shared.listsWhenReady(timeout: .seconds(2))
                for list in lists {
                    controller.add(list)
                }
            }
            self?.startLoading()
        }
    }

    private func startLoading() {
        startLoadTimer()
        webView.load(URLRequest(url: pageURL))
    }

    // MARK: CellPlayer

    func play() {
        updateState { $0.intent = "play" }
    }

    func pause() {
        updateState { $0.intent = "pause" }
    }

    func setMuted(_ muted: Bool) {
        guard self.muted != muted else { return }
        updateState { $0.muted = muted }
    }

    func setVolume(_ volume: Int) {
        guard self.volume != volume else { return }
        updateState { $0.volume = volume }
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        send("mv:seek", seconds)
    }

    func shutdown() {
        cancelTimers()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
        webView.navigationDelegate = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        onUpdate = nil
        onModeChange = nil
        onNotice = nil
        onYouTubeVideo = nil
    }

    // MARK: 顯示方式（R13、R14）

    /// 由 App 切換顯示方式。
    func setMode(_ next: WebMode) {
        guard mode != next else { return }
        mode = next
        applyModeToView()
        updateState { _ in }
        checkNoVideo()
    }

    /// 「只顯示影片」：找得到影片就切換；找不到時先按一次網站的播放鈕，等一下再找（桌面版 R14 AC2、R113）。
    func requestVideoMode() {
        if found {
            changeMode(.video)
            return
        }
        onNotice?("正在找影片…")
        updateState { $0.kick += 1 }
        waitVideoTimer?.cancel()
        waitVideoTimer = Task { [weak self] in
            try? await Task.sleep(for: Self.kickWait)
            guard let self, !Task.isCancelled else { return }
            self.waitVideoTimer = nil
            if self.found {
                self.changeMode(.video)
            } else {
                self.onNotice?("找不到影片")
            }
        }
    }

    var canGoBack: Bool { webView.canGoBack }

    func goBack() {
        if webView.canGoBack { webView.goBack() }
    }

    private func changeMode(_ next: WebMode) {
        guard mode != next else { return }
        setMode(next)
        onModeChange?(next)
    }

    private func applyModeToView() {
        container.scalesUp = mode == .video
        // 整頁模式：網頁照原本的樣子，可以左緣右滑回上一頁；影片模式：點擊由格子攔下
        webView.isUserInteractionEnabled = mode == .page
        webView.allowsBackForwardNavigationGestures = mode == .page
        webView.scrollView.isScrollEnabled = mode == .page
        webView.backgroundColor = mode == .page ? .white : .black
    }

    // MARK: 和網頁之間的狀態

    private struct StateChange {
        var intent: String
        var muted: Bool
        var volume: Int
        var kick: Int
        var pauseOnStart: Bool
    }

    private func updateState(_ change: (inout StateChange) -> Void) {
        var next = StateChange(intent: intent, muted: muted, volume: volume, kick: kick, pauseOnStart: pauseOnStart)
        change(&next)
        intent = next.intent
        muted = next.muted
        volume = next.volume
        kick = next.kick
        pauseOnStart = next.pauseOnStart
        version += 1
        sendState()
    }

    private func sendState() {
        let state: [String: Any] = [
            "v": version,
            "mode": mode.rawValue,
            "intent": intent,
            "volume": volume,
            "muted": muted,
            "interceptYouTube": interceptYouTube,
            "kick": kick,
            "pauseOnStart": pauseOnStart
        ]
        send("mv:state", state)
    }

    private func send(_ channel: String, _ value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let script = "window.__multiViewReceive && window.__multiViewReceive('\(channel)', \(json)[0]); void 0"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // 只接受最上層框架的訊息；子框架由網頁裡的程式轉給最上層
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any],
              let channel = body["channel"] as? String
        else { return }
        let args = body["args"] as? [Any] ?? []
        switch channel {
        case "mv:hello":
            sendState()
        case "mv:startPaused":
            updateState {
                $0.pauseOnStart = false
                $0.intent = "pause"
            }
        case "mv:report":
            if let data = args.first as? [String: Any] {
                handleReport(data)
            }
        case "mv:ytvideo":
            if let href = args.first as? String, SourceParser.parse(href)?.kind == .youtube {
                onYouTubeVideo?(href)
            }
        default:
            break
        }
    }

    private func handleReport(_ data: [String: Any]) {
        if (data["drm"] as? Bool) == true {
            fail("這個影片有版權保護，無法播放")
            return
        }
        guard !failed else { return }
        found = (data["found"] as? Bool) == true
        let status = data["status"] as? String
        let reportVersion = (data["v"] as? NSNumber)?.intValue ?? -1

        if found, waitVideoTimer != nil {
            waitVideoTimer?.cancel()
            waitVideoTimer = nil
            changeMode(.video)
        }

        let progress = (data["progress"] as? [String: Any]).flatMap(Self.progress)
        lastProgress = progress
        // 上次的觀看進度：等影片長度大於那個位置才跳過去（R55）
        if let start = pendingStart, let progress {
            pendingSince = pendingSince ?? Date()
            if progress.live {
                pendingStart = nil
            } else if start < progress.end {
                pendingStart = nil
                send("mv:seek", start)
            } else if let since = pendingSince, Date().timeIntervalSince(since) > Self.pendingStartTimeout {
                pendingStart = nil
            }
        }
        checkNoVideo()

        let playStatus: PlayStatus
        switch status {
        case "playing": playStatus = .playing
        case "paused": playStatus = .paused
        case "ended": playStatus = .ended
        default:
            // 影片模式還在找影片：顯示讀取動畫；整頁模式沒有影片時當作暫停
            playStatus = mode == .video || !loaded ? .loading : .paused
        }
        report(playStatus)

        // 整頁模式中使用者直接按網站的播放／暫停，也算播放意圖（桌面版 R15 AC7）
        if mode == .page, reportVersion == version {
            if status == "playing", intent == "pause" {
                updateState { $0.intent = "play" }
            } else if status == "paused", intent == "play" {
                updateState { $0.intent = "pause" }
            }
        }
    }

    private static func progress(_ raw: [String: Any]) -> PlaybackProgress? {
        guard let current = (raw["current"] as? NSNumber)?.doubleValue,
              let start = (raw["start"] as? NSNumber)?.doubleValue,
              let end = (raw["end"] as? NSNumber)?.doubleValue
        else { return nil }
        return PlaybackProgress(current: current, start: start, end: end, live: (raw["live"] as? Bool) == true)
    }

    private func report(_ status: PlayStatus) {
        lastStatus = status
        // 跳到上次的位置之前不回報進度，存檔時保留原本的位置（R55）
        let progress = pendingStart == nil ? lastProgress : nil
        onUpdate?(PlayerUpdate(status: status, progress: progress, title: title, errorMessage: nil))
    }

    private func fail(_ message: String) {
        guard !failed else { return }
        failed = true
        cancelTimers()
        updateState { $0.intent = "pause" }
        onUpdate?(PlayerUpdate(status: .error, progress: nil, title: title, errorMessage: message))
    }

    // MARK: 找不到影片（R13 AC4、R113）

    private func checkNoVideo() {
        let waiting = mode == .video && loaded && !found && !failed
        guard waiting else {
            noVideoTimer?.cancel()
            noVideoTimer = nil
            return
        }
        if !autoKickDone, autoKickTimer == nil {
            autoKickTimer = Task { [weak self] in
                try? await Task.sleep(for: Self.autoKickDelay)
                guard let self, !Task.isCancelled else { return }
                self.autoKickDone = true
                self.autoKickTimer = nil
                if !self.found, self.mode == .video {
                    self.updateState { $0.kick += 1 }
                }
            }
        }
        if noVideoTimer == nil {
            noVideoTimer = Task { [weak self] in
                try? await Task.sleep(for: Self.noVideoTimeout)
                guard let self, !Task.isCancelled else { return }
                self.noVideoTimer = nil
                self.changeMode(.page)
                self.onNotice?("找不到影片，可以在網頁中操作後按「只顯示影片」")
            }
        }
    }

    private func startLoadTimer() {
        loadTimer?.cancel()
        loadTimer = Task { [weak self] in
            try? await Task.sleep(for: Self.loadTimeout)
            guard let self, !Task.isCancelled, !self.loaded else { return }
            self.fail("無法載入網頁")
        }
    }

    private func cancelTimers() {
        [loadTimer, noVideoTimer, autoKickTimer, waitVideoTimer].forEach { $0?.cancel() }
        loadTimer = nil
        noVideoTimer = nil
        autoKickTimer = nil
        waitVideoTimer = nil
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loaded = false
        autoKickTimer?.cancel()
        autoKickTimer = nil
        autoKickDone = false
        checkNoVideo()
        startLoadTimer()
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
    ) {
        // 主文件的 HTTP 狀態碼 400 以上算載入失敗（桌面版 R16 AC2）
        if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            decisionHandler(.allow)
            fail("無法載入網頁（HTTP \(http.statusCode)）")
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadTimer?.cancel()
        loadTimer = nil
        loaded = true
        title = webView.title.flatMap { $0.isEmpty ? nil : $0 }
        sendState()
        checkNoVideo()
        if !found, lastStatus == .loading {
            report(mode == .page ? .paused : .loading)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        // 被新的導覽取代或被停止，不是載入失敗
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }
        fail("無法載入網頁：\(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail("無法載入網頁")
    }
}

/// 網頁格子的外框：影片模式時網頁至少以 1280×720 排版，再縮小到格子的大小（桌面版 R13）。
/// 格子很小時（例如 iPhone 的分割畫面），網站會改用手機版的窄版面，影片常常排在畫面外面而找不到；
/// 用比較大的版面排，影片比較會在畫面裡。整頁模式照格子的大小排版，方便操作。
final class ScaledWebContainer: UIView {
    static let minWidth: CGFloat = 1280
    static let minHeight: CGFloat = 720

    private let webView: UIView

    var scalesUp = false {
        didSet {
            if scalesUp != oldValue { setNeedsLayout() }
        }
    }

    init(webView: UIView) {
        self.webView = webView
        super.init(frame: .zero)
        backgroundColor = .black
        clipsToBounds = true
        addSubview(webView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// 縮小的比例：格子比 1280×720 小時，網頁以 (寬 / 比例) × (高 / 比例) 排版再縮小；格子夠大時為 1。
    static func scale(for size: CGSize) -> CGFloat {
        guard size.width > 0, size.height > 0 else { return 1 }
        return min(1, size.width / minWidth, size.height / minHeight)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let factor = scalesUp ? Self.scale(for: bounds.size) : 1
        webView.transform = .identity
        webView.frame = CGRect(x: 0, y: 0, width: bounds.width / factor, height: bounds.height / factor)
        if factor != 1 {
            // 以左上角為原點縮小
            webView.transform = CGAffineTransform(scaleX: factor, y: factor)
            webView.frame.origin = .zero
        }
    }
}
