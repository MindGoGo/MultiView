import SwiftUI
import UIKit

/// 把播放器的畫面放進格子裡。播放器自己保有畫面，格子重建時只是把同一個畫面搬過來，不重新載入。
struct PlayerHostView: UIViewRepresentable {
    let player: CellPlayer

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        container.clipsToBounds = true
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let content = player.view
        guard content.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        content.removeFromSuperview()
        content.frame = container.bounds
        content.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(content)
    }
}
