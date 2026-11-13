import MultiViewCore
import SwiftUI

/// 步驟 1（R119）的空畫面：只用來確認 App 能編譯、安裝、開啟。
struct ContentView: View {
    private var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "rectangle.split.2x2")
                    .font(.system(size: 56))
                Text(AppInfo.versionLabel(version: version))
                    .font(.title2.weight(.semibold))
                Text("安裝成功。功能還在開發中。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.white)
            .padding()
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
