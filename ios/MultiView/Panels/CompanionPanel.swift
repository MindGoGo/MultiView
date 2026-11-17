import MultiViewCore
import SwiftUI
import WebKit

/// YouTube 小視窗（桌面版 R78–R83；iOS 版 R140）：搜尋、推薦影片、留言、聊天室。
/// 內容跟著最後點過的 YouTube 格子。面板裡的網頁不播放影片，不會搶走格子的聲音。
/// 例外是搜尋分頁選了「在這裡看」（R162）：點影片時網頁照常換頁、播放，開始播放時格子暫停，關掉小視窗時恢復。
struct CompanionPanel: View {
    @Environment(AppModel.self) private var model
    /// 面板是不是開著。關著的時候面板在畫面外，裡面的網頁留著，但不載入新的網頁
    /// （連結的影片換了，等打開面板才載入）。
    var open = true
    /// 上下排時（R163）：上方的小把手可以拖曳，往上拉占滿畫面、往下拉回到影片下面。
    var drag: PanelDrag?
    /// 載入過聊天室的影片：同一部影片切換分頁時不重新載入。
    @State private var chatVideo: String?
    /// 在這裡看（R162）：上方的標題與分頁和格子的工具列一樣，3 秒沒有操作就隱藏，點小把手再叫出來。
    @State private var headerShown = true
    /// 按了上方的按鈕的次數：每按一次重新計算自動隱藏的時間。
    @State private var headerTouches = 0

    /// 上方的標題與分頁自動隱藏的時間（和格子的工具列相同）。
    private static let headerTimeout: Duration = .seconds(3)

    var body: some View {
        let videoID = model.companionVideoID
        let tab = model.companionTab
        let browser = model.companionBrowser
        let browsing = model.companionBrowse && tab == .search
        // 在這裡看的是一部影片：可以放進格子
        let currentVideo = SourceParser.parse(browser.currentURL)?.kind == .youtube ? browser.currentURL : nil

        VStack(spacing: 0) {
            if headerShown || !browsing {
                // 上下排時標題上面也有小把手：拖曳，或點一下切換占滿畫面／回到影片下面（R163）
                if let drag {
                    PanelHandle(label: model.companionExpanded ? "小視窗回到影片下面" : "小視窗占滿畫面", drag: drag) {
                        withAnimation(.easeOut(duration: 0.25)) { model.companionExpanded.toggle() }
                    }
                }
                header(tab: tab, browsing: browsing, canGoBack: browser.canGoBack, currentVideo: currentVideo)
            } else {
                // 小把手：點一下叫出上方的標題與分頁；上下排時也可以拖曳（R163）
                PanelHandle(label: "顯示小視窗的工具列", drag: drag) {
                    headerShown = true
                }
            }

            ZStack {
                Color(white: 0.06)
                // 每個分頁各自一個網頁，切換分頁時保留原本的內容
                CompanionWebView(
                    page: .search, videoID: nil, active: open, browse: model.companionBrowse, browser: browser,
                    onMediaStarted: { model.companionMediaStarted() }
                ) { href in
                    model.companionOpenVideo(href, replaceLinkedCell: false)
                }
                .opacity(tab == .search ? 1 : 0)
                .allowsHitTesting(tab == .search)

                if let videoID {
                    CompanionWebView(page: .watch(section: tab == .comments ? "comments" : "related"), videoID: videoID, active: open) { href in
                        model.companionOpenVideo(href, replaceLinkedCell: true)
                    }
                    .opacity(tab == .related || tab == .comments ? 1 : 0)
                    .allowsHitTesting(tab == .related || tab == .comments)

                    // 聊天室要到那個分頁才載入；同一部影片載入過就留著
                    if chatVideo == videoID {
                        CompanionWebView(page: .chat, videoID: videoID, active: open) { _ in }
                            .opacity(tab == .chat ? 1 : 0)
                            .allowsHitTesting(tab == .chat)
                    }
                } else if tab != .search {
                    Text("先點一下 YouTube 的格子")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .background(.regularMaterial)
        .onChange(of: open && tab == .chat ? videoID : nil, initial: true) { _, video in
            if let video { chatVideo = video }
        }
        .onChange(of: browsing) { _, value in
            if !value { headerShown = true }
        }
        // 在這裡看時，上方的標題與分頁 3 秒沒有操作就隱藏
        .task(id: "\(browsing)-\(headerShown)-\(headerTouches)-\(open)") {
            guard browsing, headerShown, open else { return }
            try? await Task.sleep(for: Self.headerTimeout)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { headerShown = false }
        }
    }

    /// 上方的標題、按鈕與分頁。
    private func header(tab: CompanionTab, browsing: Bool, canGoBack: Bool, currentVideo: String?) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 0) {
                if browsing, canGoBack {
                    BarButton(icon: "chevron.backward", label: "上一頁") {
                        headerTouches += 1
                        _ = model.companionBrowser.goBack()
                    }
                }
                Text(browsing ? "在小視窗裡看" : CompanionRules.header(cell: model.companionCell, title: model.companionTitle))
                    .font(.footnote)
                    .lineLimit(2)
                Spacer(minLength: 4)
                // 在這裡看的是一部影片：放進格子（放進空格，沒有空格時詢問）
                if browsing, let currentVideo {
                    BarButton(icon: "rectangle.stack.badge.plus", label: "放進格子") {
                        headerTouches += 1
                        model.companionPushCurrent(currentVideo)
                    }
                }
                // 搜尋分頁點影片的方式：圖示是目前的方式，按一下切換（R162）
                if tab == .search {
                    BarButton(
                        icon: model.companionBrowse ? "play.rectangle.fill" : "square.grid.2x2",
                        label: model.companionBrowse ? "點影片：在這裡看（按一下改成放進格子）" : "點影片：放進格子（按一下改成在這裡看）",
                        highlighted: model.companionBrowse
                    ) {
                        headerTouches += 1
                        model.setCompanionBrowse(!model.companionBrowse)
                        model.showToast(model.companionBrowse ? "點影片：在小視窗裡看" : "點影片：放進格子")
                    }
                }
                // 上下排時往下拉小把手就關掉，不用關閉按鈕（R164）
                if drag == nil {
                    BarButton(icon: "xmark", label: "關閉 YouTube 小視窗") {
                        model.closeCompanion()
                    }
                }
            }
            Picker("分頁", selection: Binding(get: { tab }, set: {
                headerTouches += 1
                model.selectCompanionTab($0)
            })) {
                ForEach(CompanionTab.allCases, id: \.self) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

/// 小視窗搜尋分頁的網頁（R162）：目前的網址、能不能回上一頁，以及暫停網頁裡的影片。
@MainActor
@Observable
final class CompanionBrowser {
    /// 網頁目前的網址（包括 YouTube 手機版不重新載入的換頁）。
    private(set) var currentURL = ""
    private(set) var canGoBack = false
    @ObservationIgnored private weak var webView: WKWebView?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []

    func attach(_ webView: WKWebView) {
        self.webView = webView
        observations = [
            webView.observe(\.url, options: [.initial, .new]) { [weak self] _, change in
                let address = (change.newValue ?? nil)?.absoluteString ?? ""
                Task { @MainActor [weak self] in self?.currentURL = address }
            },
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, change in
                let value = change.newValue ?? false
                Task { @MainActor [weak self] in self?.canGoBack = value }
            },
        ]
    }

    func detach() {
        observations = []
        webView = nil
    }

    /// 暫停網頁裡的影片。
    func pauseMedia() {
        webView?.evaluateJavaScript("document.querySelectorAll('video').forEach(function (v) { v.pause(); }); void 0", completionHandler: nil)
    }

    /// 網頁回上一頁；沒有上一頁時回傳 false。
    func goBack() -> Bool {
        guard let webView, webView.canGoBack else { return false }
        webView.goBack()
        return true
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
    /// 面板開著：關著的時候不載入新的網頁。
    var active = true
    /// 搜尋分頁點影片時在這裡看（R162），不交給 App。
    var browse = false
    /// 搜尋分頁的網頁交給 App（上一頁、放進格子、暫停影片）。
    var browser: CompanionBrowser?
    /// 在這裡看：網頁開始播放有聲音的影片。
    var onMediaStarted: () -> Void = {}
    let onVideo: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onVideo: onVideo)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        // 面板裡的網頁不自動播放影片：不出聲，也不會讓 iOS 暫停格子裡的影片。
        // 搜尋分頁可以在這裡看（R162）：有聲音的影片要使用者點過才播放，靜音的可以自動播放
        // （YouTube 手機版換頁後常常先靜音自動播放；靜音的影片不會讓 iOS 暫停其他網頁的聲音）
        configuration.mediaTypesRequiringUserActionForPlayback = page == .search ? .audio : .all
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
        context.coordinator.browser = browser
        browser?.attach(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onVideo = onVideo
        coordinator.onMediaStarted = onMediaStarted
        if coordinator.browse != browse {
            coordinator.browse = browse
            coordinator.applyBrowse()
        }

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
        if active, coordinator.loaded != address, let url = URL(string: address) {
            coordinator.loaded = address
            webView.load(URLRequest(url: url))
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.browser?.detach()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.handlerName)
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler {
        static let handlerName = "multiview"

        var onVideo: (String) -> Void
        var onMediaStarted: () -> Void = {}
        weak var webView: WKWebView?
        weak var browser: CompanionBrowser?
        var loaded = ""
        var section: String?
        /// 在這裡看（R162）：點影片時網頁照常換頁，不交給 App。
        var browse = false

        init(onVideo: @escaping (String) -> Void) {
            self.onVideo = onVideo
        }

        func applySection() {
            let argument = section.map { "'\($0)'" } ?? "null"
            webView?.evaluateJavaScript("window.__multiViewSection = \(argument); window.__multiViewApply && window.__multiViewApply(); void 0", completionHandler: nil)
        }

        func applyBrowse() {
            webView?.evaluateJavaScript("window.__multiViewBrowse = \(browse); void 0", completionHandler: nil)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "ready":
                // 網頁（重新）載入：告訴它現在要顯示哪一區、點影片的方式
                applySection()
                applyBrowse()
            case "playing":
                // 在這裡看的影片開始播放（R162）
                if browse { onMediaStarted() }
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

        /// 注入網頁的程式：攔下影片連結的點擊（在這裡看時不攔）；只顯示推薦區或留言區；影片一開始播放就暫停；
        /// 在這裡看時，有聲音的影片開始播放就告訴 App。
        /// 樣式和桌面版 electron/webPreload.ts 的 sectionCss 相同。
        static let script = #"""
        (function () {
          if (window.__multiViewInstalled) return;
          window.__multiViewInstalled = true;
          var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.multiview;
          function post(message) { try { handler.postMessage(message); } catch (e) {} }

          // 影片連結：不讓網頁換頁，交給 App 處理。在這裡看（R162）時照常換頁
          document.addEventListener('click', function (event) {
            if (window.__multiViewBrowse) return;
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
          // 在這裡看（R162）：有聲音的影片開始播放時告訴 App（搜尋結果裡靜音的預覽不算）
          function audible(event) {
            var video = event.target;
            if (!window.__multiViewBrowse || !video || video.tagName !== 'VIDEO' || video.muted || video.paused) return;
            post({ type: 'playing' });
          }
          window.addEventListener('playing', audible, true);
          // 靜音開始播放、之後才打開聲音
          window.addEventListener('volumechange', audible, true);
          document.addEventListener('DOMContentLoaded', function () { window.__multiViewApply(); });
          post({ type: 'ready' });
        })();
        """#
    }
}

/// 上下排時拖曳小視窗上方的小把手（R163）：參數是從按下的位置算起的垂直移動距離（往下為正）。
struct PanelDrag {
    var changed: (CGFloat) -> Void
    var ended: (CGFloat) -> Void
}

/// 小視窗上方的小把手：點一下做 onTap；有 drag 時可以上下拖曳。
private struct PanelHandle: View {
    let label: String
    let drag: PanelDrag?
    let onTap: () -> Void

    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.35))
            .frame(width: 44, height: 5)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            // 拖曳時小視窗本身也在移動：用整個畫面的座標，移動距離才不會跳動
            .gesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .global)
                    .onChanged { value in drag?.changed(value.translation.height) }
                    .onEnded { value in drag?.ended(value.translation.height) }
            )
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onTap() }
    }
}
