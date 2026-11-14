import SwiftUI
import UIKit

/// 選單裡的一個項目。
struct MenuItem {
    let title: String
    let systemImage: String
    var destructive = false
    let action: () -> Void
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
                completion(build().map { item in
                    UIAction(
                        title: item.title,
                        image: UIImage(systemName: item.systemImage),
                        attributes: item.destructive ? .destructive : []
                    ) { _ in item.action() }
                })
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
