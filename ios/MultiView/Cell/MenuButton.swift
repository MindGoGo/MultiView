import SwiftUI
import UIKit

/// 選單裡的一個項目。
struct MenuItem {
    let title: String
    let systemImage: String
    var destructive = false
    /// 目前選中的選項（顯示打勾）。
    var checked = false
    /// 有子項目時是子選單，action 不會被呼叫。
    var children: [MenuItem] = []
    var action: () -> Void = {}

    /// 轉成系統的選單元素。
    func element() -> UIMenuElement {
        let image = systemImage.isEmpty ? nil : UIImage(systemName: systemImage)
        if !children.isEmpty {
            return UIMenu(title: title, image: image, children: children.map { $0.element() })
        }
        let run = action
        return UIAction(
            title: title,
            image: image,
            attributes: destructive ? .destructive : [],
            state: checked ? .on : .off
        ) { _ in run() }
    }
}

/// 點一下就打開系統浮動選單的圖示按鈕（R127 的「⋯」）。
/// 和 SwiftUI 的 Menu 外觀相同，但選單打開、關閉時會通知，操作列才不會在選單開著時自動收起、把選單關掉。
struct MenuButton: UIViewRepresentable {
    let systemImage: String
    let accessibilityLabel: String
    let items: () -> [MenuItem]
    let onOpenChange: (Bool) -> Void

    func makeUIView(context: Context) -> TrackingMenuButton {
        let button = TrackingMenuButton(type: .system)
        button.showsMenuAsPrimaryAction = true
        button.tintColor = .label
        button.setImage(UIImage(systemName: systemImage), for: .normal)
        button.accessibilityLabel = accessibilityLabel
        return button
    }

    func updateUIView(_ button: TrackingMenuButton, context: Context) {
        button.onOpenChange = onOpenChange
        let build = items
        // 打開時才建立選單，項目的文字（例如「加入最愛」／「從最愛移除」）才會是最新的
        button.menu = UIMenu(children: [
            UIDeferredMenuElement.uncached { completion in
                completion(build().map { $0.element() })
            }
        ])
    }
}

/// 回報選單打開、關閉的按鈕。
final class TrackingMenuButton: UIButton {
    var onOpenChange: ((Bool) -> Void)?

    override func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        willDisplayMenuFor configuration: UIContextMenuConfiguration,
        animator: UIContextMenuInteractionAnimating?
    ) {
        super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
        onOpenChange?(true)
    }

    override func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        willEndFor configuration: UIContextMenuConfiguration,
        animator: UIContextMenuInteractionAnimating?
    ) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        onOpenChange?(false)
    }
}
