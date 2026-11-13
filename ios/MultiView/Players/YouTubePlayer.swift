import MultiViewCore
import UIKit
import WebKit

/// YouTube 官方內嵌播放器（桌面版 R3；iOS 版 R121）。
/// 由 App 自己提供載入播放器的頁面，不經過 YouTube 網站；隱藏 YouTube 的控制列，點擊由格子攔下。
@MainActor
final class YouTubePlayer: NSObject, CellPlayer, WKScriptMessageHandler {
    /// 載入播放器頁面時用的來源網址。YouTube 內嵌播放器要求頁面有 http(s) 的來源。
    private static let origin = "https://local.multiview.ios"
    private static let handlerName = "multiview"

    var view: UIView { webView }
    var onUpdate: ((PlayerUpdate) -> Void)?
    /// iOS 上網頁不能設定影片的音量，先只提供靜音開關；R121 驗證後再決定（規格 R128）。
    let supportsVolume = false
    let isInteractive = false

    private let webView: WKWebView
    private var failure: String?

    init(videoID: String, source: CellSource) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        configuration.userContentController.add(WeakMessageHandler(self), name: Self.handlerName)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // 點擊攔截層：點擊不傳到 YouTube 播放器（桌面版 R3 共用定義）
        webView.isUserInteractionEnabled = false

        var config: [String: Any] = [
            "videoId": videoID,
            "autoplay": source.autoplay,
            "muted": source.muted,
            "origin": Self.origin
        ]
        // 上次的觀看進度（R55）：在載入時指定，播放後才生效
        if let resume = source.resume, resume > 0 {
            config["start"] = Int(resume)
        }
        webView.loadHTMLString(Self.page(config: config), baseURL: URL(string: Self.origin + "/"))
    }

    func play() {
        run("player.playVideo()")
    }

    func pause() {
        run("player.pauseVideo()")
    }

    func setMuted(_ muted: Bool) {
        run(muted ? "player.mute()" : "player.unMute()")
    }

    func setVolume(_ volume: Int) {
        // iOS 上沒有作用，保留給 R121 驗證
        run("player.setVolume(\(max(0, min(volume, 100))))")
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        run("player.seekTo(\(seconds), true)")
    }

    func shutdown() {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        onUpdate = nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "state":
            handleState(body)
        case "error":
            failure = Self.errorMessage(code: (body["code"] as? NSNumber)?.intValue ?? 0)
            onUpdate?(PlayerUpdate(status: .error, progress: nil, title: nil, errorMessage: failure))
        default:
            break
        }
    }

    private func handleState(_ body: [String: Any]) {
        guard failure == nil else { return }
        let state = (body["state"] as? NSNumber)?.intValue ?? -1
        let current = (body["current"] as? NSNumber)?.doubleValue ?? 0
        let duration = (body["duration"] as? NSNumber)?.doubleValue ?? 0
        let live = (body["live"] as? NSNumber)?.boolValue ?? false
        let title = (body["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }

        let status: PlayStatus
        switch state {
        case 1: status = .playing
        case 3: status = .loading
        case 0: status = .ended
        default: status = .paused // 尚未開始、暫停、已載入
        }
        let media = MediaInfo(
            duration: duration > 0 ? duration : .nan,
            currentTime: current,
            seekable: live && duration > 0 ? [0...duration] : [],
            live: live ? true : nil
        )
        onUpdate?(PlayerUpdate(status: status, progress: ProgressRules.fromMedia(media), title: title, errorMessage: nil))
    }

    private func run(_ command: String) {
        webView.evaluateJavaScript("if (window.ready) { \(command) }; void 0", completionHandler: nil)
    }

    private static func errorMessage(code: Int) -> String {
        switch code {
        case 100: return "找不到這部影片（可能已被移除或設為私人）"
        case 101, 150: return "這部影片不允許在其他地方播放"
        case 2: return "影片代碼不正確"
        default: return "YouTube 播放器發生錯誤（\(code)）"
        }
    }

    private static func page(config: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: config)) ?? Data("{}".utf8)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
        <style>
          html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
          #player { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
        </style>
        </head>
        <body>
        <div id="player"></div>
        <script>
          var cfg = \(json);
          var player = null;
          window.ready = false;
          function post(message) {
            try { window.webkit.messageHandlers.\(handlerName).postMessage(message); } catch (e) {}
          }
          function report() {
            if (!window.ready) return;
            var data = player.getVideoData ? (player.getVideoData() || {}) : {};
            post({
              type: 'state',
              state: player.getPlayerState(),
              current: player.getCurrentTime() || 0,
              duration: player.getDuration() || 0,
              live: !!data.isLive,
              title: data.title || ''
            });
          }
          function onYouTubeIframeAPIReady() {
            var vars = {
              autoplay: cfg.autoplay ? 1 : 0,
              mute: cfg.muted ? 1 : 0,
              controls: 0,
              rel: 0,
              iv_load_policy: 3,
              playsinline: 1,
              disablekb: 1,
              fs: 0,
              origin: cfg.origin
            };
            if (cfg.start) vars.start = cfg.start;
            player = new YT.Player('player', {
              width: '100%',
              height: '100%',
              videoId: cfg.videoId,
              playerVars: vars,
              events: {
                onReady: function () { window.ready = true; report(); },
                onStateChange: report,
                onError: function (event) { post({ type: 'error', code: event.data }); }
              }
            });
          }
          setInterval(report, 500);
        </script>
        <script src="https://www.youtube.com/iframe_api"></script>
        </body>
        </html>
        """
    }
}

/// WKUserContentController 會強持有訊息處理器；透過這個物件轉交，避免播放器無法釋放。
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
