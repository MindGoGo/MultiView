import MultiViewCore
import UIKit
import WebKit

/// 網頁格子：直接顯示整個網頁，可以點擊、捲動、輸入（整頁模式，桌面版 R14；iOS 版 R137）。
/// 「只顯示網頁中的影片」、廣告阻擋會在之後的版本加入。
@MainActor
final class WebPagePlayer: NSObject, CellPlayer, WKNavigationDelegate {
    var view: UIView { webView }
    var onUpdate: ((PlayerUpdate) -> Void)?
    let supportsVolume = false
    let isInteractive = true
    let usesWebAudio = true
    var badge: String? { nil }

    private let webView: WKWebView
    private var muted: Bool

    init(url: URL, source: CellSource) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        muted = source.muted
        super.init()

        webView.navigationDelegate = self
        webView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = true
        // 沒有設定 uiDelegate：網頁要開新視窗一律不開（和桌面版相同）
        webView.load(URLRequest(url: url))
    }

    func play() {
        runOnVideos("video.play()")
    }

    func pause() {
        runOnVideos("video.pause()")
    }

    func setMuted(_ muted: Bool) {
        self.muted = muted
        runOnVideos("video.muted = \(muted)")
    }

    func setVolume(_ volume: Int) {
        // iOS 上網頁不能設定影片的音量
    }

    func seek(to seconds: Double) {}

    func shutdown() {
        webView.navigationDelegate = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        onUpdate = nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        report(.loading)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setMuted(muted)
        report(.paused)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        report(.paused)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        // 使用者自己換頁造成的取消不是錯誤
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        onUpdate?(PlayerUpdate(status: .error, progress: nil, title: nil, errorMessage: "無法載入網頁：\(error.localizedDescription)"))
    }

    private func report(_ status: PlayStatus) {
        let title = webView.title.flatMap { $0.isEmpty ? nil : $0 }
        onUpdate?(PlayerUpdate(status: status, progress: nil, title: title, errorMessage: nil))
    }

    private func runOnVideos(_ statement: String) {
        let script = "document.querySelectorAll('video').forEach(function (video) { try { \(statement) } catch (e) {} }); void 0"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}
