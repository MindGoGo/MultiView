import MultiViewCore
import SwiftUI

/// 版型的圖示（R124）：依版型實際的格子位置畫出小方框，`2` 版型上下排列時也跟著畫成上下。
struct LayoutIcon: View {
    let layout: LayoutID
    var stacked = false

    private static let gap: CGFloat = 2
    private static let corner: CGFloat = 2

    var body: some View {
        Canvas { context, size in
            let rects = LayoutMath.cellRects(layout, Ratios.defaults(for: layout), stacked: stacked)
            for rect in rects {
                let frame = CGRect(
                    x: rect.x * size.width + Self.gap / 2,
                    y: rect.y * size.height + Self.gap / 2,
                    width: max(rect.w * size.width - Self.gap, 1),
                    height: max(rect.h * size.height - Self.gap, 1)
                )
                context.fill(Path(roundedRect: frame, cornerRadius: Self.corner), with: .foreground)
            }
        }
        .frame(width: stacked && layout == .two ? 16 : 26, height: stacked && layout == .two ? 22 : 17)
        .accessibilityHidden(true)
    }
}
