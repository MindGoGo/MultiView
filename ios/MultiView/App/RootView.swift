import MultiViewCore
import SwiftUI

/// 主畫面：只有格子；工具列和提示蓋在上面（R123、R127）。
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    /// YouTube 小視窗打開過：之後一直留在畫面裡（關掉時移到畫面外），裡面的網頁不用每次重新載入（R140）。
    @State private var companionCreated = false
    /// 整個畫面（包括安全區域）的大小，用來判斷小視窗要不要和影片上下排（R162）。
    @State private var screenSize: CGSize = .zero
    /// 正在拖曳上下排的小視窗（R163）：從按下的位置算起的垂直移動距離（往下為正）。
    @State private var stackDrag: CGFloat = 0

    /// iPhone（小螢幕）直向、畫面上只有一格（版型 `1` 或單格全螢幕）時打開小視窗：上面影片、下面小視窗（R162）。
    private var companionStacked: Bool {
        model.companionOpen && stackAvailable
    }

    /// 打開小視窗的話會上下排（R164：這時在影片上往上滑就打開小視窗）。
    private var stackAvailable: Bool {
        let portraitPhone = screenSize.height > screenSize.width &&
            !ScreenRules.isLarge(width: screenSize.width, height: screenSize.height)
        return portraitPhone && (model.solo != nil || model.displayedLayout == .one)
    }

    /// 上下排時影片的高度：占滿寬度、16:9。
    private var stackedVideoHeight: CGFloat {
        (screenSize.width * 9 / 16).rounded()
    }

    /// 上下排時小視窗的上緣（從安全區域上緣算起，R163）：接在影片下面；拉到最上面時占滿畫面（蓋住影片，影片照常播放）。
    private var stackedPanelTop: CGFloat {
        let rest = model.companionExpanded ? 0 : stackedVideoHeight
        // 接在影片下面時可以往下拉（往下拉就關掉，R164）
        let limit = model.companionExpanded ? stackedVideoHeight : screenSize.height
        return min(max(rest + stackDrag, 0), limit)
    }

    /// 按著小視窗上方的小把手上下拖曳，放開時往拖曳的方向收合或展開（R163）。
    private var stackPanelDrag: PanelDrag {
        PanelDrag(
            changed: { stackDrag = $0 },
            ended: { moved in
                if !model.companionExpanded, moved > 80 {
                    // 接在影片下面時往下拉：關掉，從手指放開的位置往下收起（R164）；收起之後才把拖曳的距離歸零
                    withAnimation(.easeOut(duration: 0.25)) {
                        model.closeCompanion()
                    }
                    Task {
                        try? await Task.sleep(for: .milliseconds(320))
                        stackDrag = 0
                    }
                    return
                }
                let expand = moved < -40 ? true : (moved > 40 ? false : model.companionExpanded)
                withAnimation(.easeOut(duration: 0.25)) {
                    model.companionExpanded = expand
                    stackDrag = 0
                }
            }
        )
    }

    /// 包括安全區域的整個畫面大小。
    private static func fullSize(_ proxy: GeometryProxy) -> CGSize {
        let insets = proxy.safeAreaInsets
        return CGSize(width: proxy.size.width + insets.leading + insets.trailing, height: proxy.size.height + insets.top + insets.bottom)
    }

    var body: some View {
        // 收起的動畫中也維持上下排（R164）：影片等小視窗離開後才放大回整個畫面
        let stacked = companionStacked || model.companionClosingStacked
        // 上下排時打開、關掉是上下滑動；其他情況（蓋在右側、占滿寬度）照原本左右滑動
        let slidesDown = model.companionOpen ? companionStacked : (stackAvailable || model.companionClosingStacked)
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            // 格子畫到螢幕邊緣（滿版）；操作列等會自己避開瀏海、圓角和 Home 指示條。
            // 安全區域要在忽略安全區域之前量（忽略之後量到的都是 0）。
            // 上下排（R162）時格子區域縮成 16:9 放在上面（從安全區域上緣開始）；
            // 一直是同一個 GridView，只改大小，格子不會重新載入
            GeometryReader { proxy in
                let insets = proxy.safeAreaInsets
                GridView(safeArea: stacked ? EdgeInsets(top: 0, leading: insets.leading, bottom: 0, trailing: insets.trailing) : insets)
                    .frame(height: stacked ? stackedVideoHeight : nil)
                    .padding(.top, stacked ? insets.top : 0)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .ignoresSafeArea()
                    .onChange(of: Self.fullSize(proxy), initial: true) { _, size in
                        screenSize = size
                    }
            }

            if model.toolbarVisible {
                ToolbarView()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // YouTube 小視窗：大螢幕在右側（寬 360pt，蓋在影片上方），小螢幕占滿寬度（R140）。
            // 第一次打開之後一直留著，關掉時只是移到畫面右邊外面：每次打開都重新建立的話，
            // 裡面的網頁會重新載入，搜尋的內容也不見（2026-11-15 使用者回報）
            if companionCreated {
                GeometryReader { proxy in
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        CompanionPanel(open: model.companionOpen, drag: stacked ? stackPanelDrag : nil)
                            .frame(maxWidth: model.isLarge ? 360 : .infinity)
                    }
                    .offset(
                        x: model.companionOpen || slidesDown ? 0 : proxy.size.width + 40,
                        y: !model.companionOpen && slidesDown ? proxy.size.height + 40 : 0
                    )
                }
                // 上下排時小視窗接在影片下面，不跟著工具列移動
                .padding(.top, stacked ? stackedPanelTop : (model.toolbarVisible ? 52 : 0))
                .allowsHitTesting(model.companionOpen)
                .accessibilityHidden(!model.companionOpen)
            }

            // 清單面板：位置和 YouTube 小視窗相同，一次只開一個（R141）
            if model.listPanelOpen {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    ListPanel()
                        .frame(maxWidth: model.isLarge ? 360 : .infinity)
                }
                .padding(.top, model.toolbarVisible ? 52 : 0)
                .transition(.move(edge: .trailing))
            }

            if let toast = model.toast {
                Text(toast)
                    .font(.callout)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.top, model.toolbarVisible ? 64 : 12)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.toolbarVisible)
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .animation(.easeOut(duration: 0.2), value: model.listPanelOpen)
        .animation(.easeOut(duration: 0.2), value: model.companionOpen)
        .sheet(isPresented: Binding(get: { model.settingsOpen }, set: { model.settingsOpen = $0 })) {
            SettingsView()
        }
        .confirmationDialog(
            "沒有空格，要取代哪一格？",
            isPresented: Binding(get: { model.pendingReplaceURL != nil }, set: { if !$0 { model.pendingReplaceURL = nil } }),
            titleVisibility: .visible
        ) {
            // 沒有空格時選擇要取代的格子（R64）
            ForEach(model.visibleSlotIndices, id: \.self) { index in
                Button("第 \(index + 1) 格") {
                    if let url = model.pendingReplaceURL {
                        model.replaceSlot(index, with: url)
                    }
                    model.pendingReplaceURL = nil
                }
            }
            Button("取消", role: .cancel) {
                model.pendingReplaceURL = nil
            }
        }
        .onChange(of: model.companionOpen, initial: true) { _, open in
            if open { companionCreated = true }
        }
        .onChange(of: companionStacked, initial: true) { _, value in
            model.companionStacked = value
        }
        .onChange(of: stackAvailable, initial: true) { _, value in
            model.companionStackAvailable = value
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        // 在畫面邊緣拖曳（例如拖下方的格子、進度條）時，第一次滑動不會直接回到主畫面或拉出控制中心
        .defersSystemGestures(on: .all)
        // 從其他 App 的分享捷徑送網址進來（R126）
        .onOpenURL { url in
            model.openExternalLink(url.absoluteString)
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // 回到主畫面或鎖定螢幕：有聲音的原生播放器繼續播，其他暫停（R132）
                model.didEnterBackground()
            case .active:
                model.willEnterForeground()
            default:
                // iOS 沒有「關閉程式」的時機：離開前景時立刻保存（R134）
                model.saveNow()
            }
        }
    }
}
