import UIKit

/// 畫面方向（R123、R129）：使用者關了自動旋轉時也能切換橫向、直向；
/// iPhone 直向時進入單格全螢幕自動轉成橫向，離開後轉回來。
///
/// iOS 只會轉到 App 允許的方向，所以強制橫向時要把允許的方向限制成只有橫向，
/// 否則手機拿直的、又開著自動旋轉時，系統會馬上轉回直向。
@MainActor
enum Orientation {
    /// 目前允許的方向；nil 表示跟著裝置（Info.plist 允許的全部方向）。
    private(set) static var locked: UIInterfaceOrientationMask?

    static var allowed: UIInterfaceOrientationMask {
        locked ?? (UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown)
    }

    private static var scene: UIWindowScene? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ??
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    }

    /// 目前畫面是不是直向。
    static var isPortrait: Bool {
        scene?.interfaceOrientation.isPortrait ?? true
    }

    /// 轉成指定的方向並固定在那裡；傳 nil 解除固定，回到跟著裝置。
    static func lock(_ mask: UIInterfaceOrientationMask?) {
        locked = mask
        guard let scene else { return }
        for window in scene.windows {
            window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
        if let mask {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
    }
}

/// 讓系統問 App 允許哪些方向時，回答 Orientation 的設定。
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated { Orientation.allowed }
    }
}
