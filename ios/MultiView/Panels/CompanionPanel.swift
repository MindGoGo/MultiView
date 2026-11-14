import MultiViewCore
import SwiftUI
import WebKit

/// YouTube 小視窗（桌面版 R78–R83；iOS 版 R140）：搜尋、推薦影片、留言、聊天室。
/// 內容跟著最後點過的 YouTube 格子。面板裡的網頁不播放影片，不會搶走格子的聲音。
struct CompanionPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let videoID = model.companionVideoID
        let tab = model.companionTab

        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack {
                    Text(CompanionRules.header(cell: model.companionCell, title: model.companionTitle))
                        .font(.footnote)
                        .lineLimit(2)
                    Spacer()
                    Button {
                        model.closeCompanion()
                    } label: {
                        Image(systemName: "xmark")
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("關閉 YouTube 小視窗")
                }
                Picker("分頁", selection: Binding(get: { tab }, set: { model.companionTab = $0 })) {
                    ForEach(CompanionTab.allCases, id: \.self) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(12)

            ZStack {
                Color(white: 0.06)
                // 每個分頁各自一個網頁，切換分頁時保留原本的內容
                CompanionWebView(page: .search, videoID: nil) { href in
                    model.companionOpenVideo(href, replaceLinkedCell: false)
                }
                .opacity(tab == .search ? 1 : 0)
                .allowsHitTesting(tab == .search)

                if let videoID {
                    CompanionWebView(page: .watch(section: tab == .comments ? "comments" : "related"), videoID: videoID) { href in
                        model.companionOpenVideo(href, replaceLinkedCell: true)
                    }
                    .opacity(tab == .related || tab == .comments ? 1 : 0)
                    .allowsHitTesting(tab == .related || tab == .comments)

                    // 聊天室要到那個分頁才載入
                    if tab == .chat {
                        CompanionWebView(page: .chat, videoID: videoID) { _ in }
                    }
                } else if tab != .search {
                    Text("先點一下 YouTube 的格子")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .background(.regularMaterial)
    }
}

/// 小視窗裡的一個網頁。
private struct CompanionWebView: UIViewRepresentable {
    enum Page: Equatable {
        case search
        case watch(section: String)
        case chat
    }

    let page: Page
    let videoID: String?
    let onVideo: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onVideo: onVideo)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        // 面板裡的網頁不自動播放影片：不出聲，也不會讓 iOS 暫停格子裡的影片
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        if page == .search {
            // 搜尋用手機版的 YouTube（R82）
            configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        }
        let controller = configuration.userContentController
        controller.add(WeakMessageHandler(context.coordinator), name: Coordinator.handlerName)
        controller.addUserScript(WKUserScript(
            source: Coordinator.script, injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        if page != .search {
            webView.customUserAgent = CompanionRules.desktopUserAgent
        }
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = page == .search
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onVideo = onVideo

        let address: String
        var section: String?
        switch page {
        case .search:
            address = CompanionRules.mobileHome
        case .watch(let name):
            address = videoID.map(CompanionRules.watchPageURL) ?? ""
            section = name
        case .chat:
            address = videoID.map(CompanionRules.liveChatURL) ?? ""
        }

        // 只顯示推薦區或留言區（R79、R80）
        if coordinator.section != section {
            coordinator.section = section
            coordinator.applySection()
        }
        // 換了影片才重新載入；搜尋分頁只載入一次，之後讓使用者自己逛
        if coordinator.loaded != address, let url = URL(string: address) {
            coordinator.loaded = address
            webView.load(URLRequest(url: url))
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.handlerName)
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler {
        static let handlerName = "multiview"

        var onVideo: (String) -> Void
        weak var webView: WKWebView?
        var loaded = ""
        var section: String?

        init(onVideo: @escaping (String) -> Void) {
            self.onVideo = onVideo
        }

        func applySection() {
            let argument = section.map { "'\($0)'" } ?? "null"
            webView?.evaluateJavaScript("window.__multiViewSection = \(argument); window.__multiViewApply && window.__multiViewApply(); void 0", completionHandler: nil)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                // 網頁（重新）載入：告訴它現在要顯示哪一區
                applySection()
            case "video":
                guard let href = body["href"] as? String else { return }
                if SourceParser.parse(href)?.kind == .youtube {
                    onVideo(href)
                } else if let url = URL(string: href) {
                    // 不是單一影片（頻道、播放清單、Shorts）：照常換頁
                    webView?.load(URLRequest(url: url))
                }
            default:
                break
            }
        }

        /// 注入網頁的程式：攔下影片連結的點擊；只顯示推薦區或留言區；影片一開始播放就暫停。
        /// 樣式和桌面版 electron/webPreload.ts 的 sectionCss 相同。
        static let script = #"""
        (function () {
          if (window.__multiViewInstalled) return;
          window.__multiViewInstalled = true;
          var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.multiview;
          function post(message) { try { handler.postMessage(message); } catch (e) {} }

          // 影片連結：不讓網頁換頁，交給 App 處理
          document.addEventListener('click', function (event) {
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!link) return;
            var href = link.href || '';
            if (!/^https?:\/\/([a-z]+\.)?(youtube\.com\/(watch|live\/|shorts\/|embed\/)|youtu\.be\/)/.test(href)) return;
            event.preventDefault();
            event.stopPropagation();
            post({ type: 'video', href: href });
          }, true);

          var SELECTORS = { related: 'ytd-watch-flexy #related', comments: 'ytd-watch-flexy #comments' };
          var PANE = 'position: fixed !important; inset: 0 !important; width: auto !important; min-width: 0 !important;' +
            'max-width: none !important; height: auto !important; margin: 0 !important; padding: 12px 16px !important;' +
            'box-sizing: border-box !important; overflow-y: auto !important; z-index: 2147483647 !important;' +
            'display: block !important; background: #fff !important;';
          function css(active) {
            var both = SELECTORS.related + ', ' + SELECTORS.comments;
            var inactive = SELECTORS[active === 'related' ? 'comments' : 'related'];
            return 'html:has(' + SELECTORS[active] + '), html:has(' + SELECTORS[active] + ') body { overflow: hidden !important; }' +
              both + ' { ' + PANE + ' }' +
              'html[dark] :is(' + both + ') { background: #0f0f0f !important; }' +
              SELECTORS[active] + ' { visibility: visible !important; }' +
              inactive + ' { visibility: hidden !important; pointer-events: none !important; }' +
              'html:has(' + SELECTORS[active] + ') #masthead-container { display: none !important; }' +
              'body { visibility: hidden !important; }' +
              'html { background: #fff !important; }' +
              'html[dark] { background: #0f0f0f !important; }';
          }
          var style = null;
          window.__multiViewApply = function () {
            var section = window.__multiViewSection;
            if (!section) {
              if (style) { style.remove(); style = null; }
              return;
            }
            if (!document.documentElement) return;
            if (!style) style = document.createElement('style');
            style.textContent = css(section);
            if (!style.isConnected) document.documentElement.appendChild(style);
            document.querySelectorAll('video').forEach(function (video) {
              video.muted = true;
              if (!video.paused) video.pause();
            });
          };
          // 只顯示某一區時，影片（包括廣告）一開始播放就暫停
          window.addEventListener('play', function (event) {
            var video = event.target;
            if (!window.__multiViewSection || !video || video.tagName !== 'VIDEO') return;
            video.muted = true;
            video.pause();
          }, true);
          document.addEventListener('DOMContentLoaded', function () { window.__multiViewApply(); });
          post({ type: 'ready' });
        })();
        """#
    }
}
