import MultiViewCore
import SwiftUI

/// 主畫面：只有格子；工具列和提示蓋在上面（R123、R127）。
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            // 格子畫到螢幕邊緣（滿版）；操作列等會自己避開瀏海、圓角和 Home 指示條
            GridView()
                .ignoresSafeArea()

            if model.toolbarVisible {
                ToolbarView()
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // 清單面板、YouTube 小視窗：大螢幕在右側（寬 360pt，蓋在影片上方），小螢幕占滿寬度（R140、R141）
            if model.listPanelOpen || model.companionOpen {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    Group {
                        if model.companionOpen {
                            CompanionPanel()
                        } else {
                            ListPanel()
                        }
                    }
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
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        // 在畫面邊緣拖曳（例如拖下方的格子、進度條）時，第一次滑動不會直接回到主畫面或拉出控制中心
        .defersSystemGestures(on: .all)
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
