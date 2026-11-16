import MultiViewCore
import SwiftUI

/// 「已跳過業配　取消」（R161）：格子右上角的跳過提示，左邊的小圓點是類別在進度條上的顏色。
/// 播放器自己在 5 秒後收起（NativePlayer），這裡只負責顯示與「取消」。
struct SkipNoticeView: View {
    let notice: SkipNotice
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(notice.segment.category.swiftUIColor)
                .frame(width: 8, height: 8)
            Text(SponsorBlockRules.skippedLabel(notice.segment.category))
                .font(.caption)
                .foregroundStyle(.white)
            Button(action: onUndo) {
                Text("取消")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("取消跳過，回到片段開頭")
        }
        .padding(.leading, 10)
        .background(.black.opacity(0.7), in: Capsule())
        .fixedSize()
    }
}

extension SponsorCategory {
    /// 進度條色塊、提示的小圓點用的顏色（0xRRGGBB）。
    var swiftUIColor: Color {
        Color(
            red: Double((color >> 16) & 0xFF) / 255,
            green: Double((color >> 8) & 0xFF) / 255,
            blue: Double(color & 0xFF) / 255
        )
    }
}
