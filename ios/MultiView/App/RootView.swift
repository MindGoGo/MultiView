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
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            // iOS 沒有「關閉程式」的時機：離開前景時立刻保存（R134）
            if phase != .active {
                model.saveNow()
            }
        }
    }
}
