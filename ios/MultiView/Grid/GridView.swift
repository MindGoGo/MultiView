import MultiViewCore
import SwiftUI

/// 依版型排列格子與分隔線（R124、R125）。
struct GridView: View {
    @Environment(AppModel.self) private var model

    static let coordinateSpace = "grid"
    /// 格子之間的間隔（分隔線看起來的寬度）。
    private static let gap: CGFloat = 2

    /// 畫面上的一格。有來源的格子以來源的 id 識別，換位時沿用同一個畫面，不重新載入（R6 AC1）。
    private struct Cell: Identifiable {
        let id: String
        let index: Int
        let rect: FracRect
        let source: CellSource?
    }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let isLarge = ScreenRules.isLarge(width: size.width, height: size.height)
            let layout = ScreenRules.displayedLayout(model.layout, isLarge: isLarge)
            let stacked = ScreenRules.isStacked(width: size.width, height: size.height)
            let ratios = model.ratios(for: layout)

            ZStack(alignment: .topLeading) {
                Color(white: 0.16)

                ForEach(cells(layout: layout, ratios: ratios, stacked: stacked)) { cell in
                    cellView(cell)
                        .frame(
                            width: max(cell.rect.w * size.width - Self.gap, 0),
                            height: max(cell.rect.h * size.height - Self.gap, 0)
                        )
                        .position(
                            x: (cell.rect.x + cell.rect.w / 2) * size.width,
                            y: (cell.rect.y + cell.rect.h / 2) * size.height
                        )
                }

                ForEach(Array(LayoutMath.dividers(layout, ratios, stacked: stacked).enumerated()), id: \.offset) { _, divider in
                    DividerHandle(layout: layout, divider: divider, size: size)
                }

                if !model.toolbarVisible, showsToolbarHandle(layout: layout) {
                    toolbarHandle
                        .position(x: size.width / 2, y: 14)
                }
            }
            .coordinateSpace(name: Self.coordinateSpace)
            .onChange(of: isLarge, initial: true) { _, value in
                model.setScreen(isLarge: value)
            }
        }
    }

    private func cells(layout: LayoutID, ratios: Ratios, stacked: Bool) -> [Cell] {
        LayoutMath.cellRects(layout, ratios, stacked: stacked).enumerated().map { index, rect in
            let source = index < model.slots.count ? model.slots[index] : nil
            let id = source.map { "source-\($0.id)" } ?? "empty-\(index)"
            return Cell(id: id, index: index, rect: rect, source: source)
        }
    }

    @ViewBuilder
    private func cellView(_ cell: Cell) -> some View {
        if let source = cell.source {
            CellView(index: cell.index, source: source)
        } else {
            EmptyCellView(index: cell.index)
        }
    }

    /// 沒有任何「點一下就會叫出工具列」的格子時（全部是空白格或網頁），用上方的小把手叫出工具列（R127）。
    private func showsToolbarHandle(layout: LayoutID) -> Bool {
        !model.slots.prefix(layout.cellCount).contains { source in
            guard let source else { return false }
            return source.parsed.kind != .web
        }
    }

    private var toolbarHandle: some View {
        Button {
            model.showControls(for: nil)
        } label: {
            Capsule()
                .fill(.white.opacity(0.35))
                .frame(width: 44, height: 5)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("顯示工具列")
    }
}

/// 分隔線：看起來是格子之間 2pt 的間隔，手指可以按的範圍是 24pt（R125）。
private struct DividerHandle: View {
    @Environment(AppModel.self) private var model
    let layout: LayoutID
    let divider: DividerDef
    let size: CGSize

    private static let hitWidth: CGFloat = 24

    /// 畫面上是直的分隔線（左右拖曳）。
    private var isVertical: Bool { divider.screenAxis == .cols }

    /// 分隔線移動方向上的畫面長度。
    private var length: CGFloat { isVertical ? size.width : size.height }

    private var minFraction: Double {
        LayoutMath.minFraction(divider.screenAxis, containerLength: length)
    }

    var body: some View {
        let span = divider.to - divider.from
        let middle = (divider.from + divider.to) / 2
        Color.clear
            .frame(
                width: isVertical ? Self.hitWidth : span * size.width,
                height: isVertical ? span * size.height : Self.hitWidth
            )
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                // 雙擊：回到平均分配
                model.resetDivider(layout: layout, axis: divider.axis, index: divider.index, min: minFraction)
            }
            .gesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .named(GridView.coordinateSpace))
                    .onChanged { value in
                        guard length > 0 else { return }
                        let position = (isVertical ? value.location.x : value.location.y) / length
                        model.moveDivider(
                            layout: layout, axis: divider.axis, index: divider.index, to: position, min: minFraction
                        )
                    }
            )
            .position(
                x: isVertical ? divider.pos * size.width : middle * size.width,
                y: isVertical ? middle * size.height : divider.pos * size.height
            )
    }
}
