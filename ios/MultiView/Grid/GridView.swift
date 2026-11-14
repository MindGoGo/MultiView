import MultiViewCore
import SwiftUI

/// 依版型排列格子與分隔線（R124、R125）。
struct GridView: View {
    @Environment(AppModel.self) private var model
    /// 螢幕的安全區域（瀏海、圓角、Home 指示條）：格子畫到邊緣，貼著邊緣的操作列、按鈕要避開。
    let safeArea: EdgeInsets

    static let coordinateSpace = "grid"
    /// 格子之間的間隔（分隔線看起來的寬度）。只在格子和格子之間，畫面邊緣沒有。
    private static let gap: CGFloat = 2
    /// 判斷格子有沒有貼到畫面邊緣時容許的誤差。
    private static let edgeTolerance = 1e-6

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
            let solo = model.solo

            ZStack(alignment: .topLeading) {
                Color(white: 0.16)

                ForEach(cells(layout: layout, ratios: ratios, stacked: stacked, solo: solo)) { cell in
                    let frame = Self.frame(of: cell.rect, in: size)
                    cellView(cell, insets: Self.insets(of: cell.rect, safeArea: safeArea), touchesTop: cell.rect.y <= Self.edgeTolerance)
                        // 拖曳換位中：被拖的格子半透明，手指所在的格子顯示外框（R125）
                        .opacity(model.swapFrom == cell.index ? 0.45 : 1)
                        .overlay {
                            if model.swapFrom != nil, model.swapOver == cell.index, model.swapFrom != cell.index {
                                Rectangle()
                                    .strokeBorder(Color.accentColor, lineWidth: 4)
                                    .allowsHitTesting(false)
                            }
                        }
                        .frame(width: frame.width, height: frame.height)
                        .position(x: frame.midX, y: frame.midY)
                }

                // 單格全螢幕時不顯示分隔線（R20）
                if solo == nil {
                    ForEach(Array(LayoutMath.dividers(layout, ratios, stacked: stacked).enumerated()), id: \.offset) { _, divider in
                        DividerHandle(layout: layout, divider: divider, size: size)
                    }
                }

                if !model.toolbarVisible, showsToolbarHandle(layout: layout) {
                    toolbarHandle
                        .position(x: size.width / 2, y: safeArea.top + 14)
                }
            }
            .coordinateSpace(name: Self.coordinateSpace)
            .onChange(of: isLarge, initial: true) { _, value in
                model.setScreen(isLarge: value)
            }
            .onChange(of: size, initial: true) { _, value in
                model.setGrid(size: value, stacked: stacked)
            }
        }
    }

    private func cells(layout: LayoutID, ratios: Ratios, stacked: Bool, solo: Int?) -> [Cell] {
        // 單格全螢幕：只有放大的那一格，占滿畫面。識別方式不變，所以不會重新載入（R20）
        if let solo, solo < model.slots.count, let source = model.slots[solo] {
            return [Cell(id: "source-\(source.id)", index: solo, rect: FracRect(x: 0, y: 0, w: 1, h: 1), source: source)]
        }
        return LayoutMath.cellRects(layout, ratios, stacked: stacked).enumerated().map { index, rect in
            let source = index < model.slots.count ? model.slots[index] : nil
            let id = source.map { "source-\($0.id)" } ?? "empty-\(index)"
            return Cell(id: id, index: index, rect: rect, source: source)
        }
    }

    @ViewBuilder
    private func cellView(_ cell: Cell, insets: EdgeInsets, touchesTop: Bool) -> some View {
        if let source = cell.source {
            CellView(index: cell.index, source: source, insets: insets, touchesTop: touchesTop)
        } else {
            EmptyCellView(index: cell.index, insets: insets)
        }
    }

    /// 格子在畫面上的位置：格子和格子之間留間隔，貼著畫面邊緣的那一側不留（影片滿版）。
    private static func frame(of rect: FracRect, in size: CGSize) -> CGRect {
        let half = gap / 2
        let left = rect.x * size.width + (rect.x > edgeTolerance ? half : 0)
        let top = rect.y * size.height + (rect.y > edgeTolerance ? half : 0)
        let right = (rect.x + rect.w) * size.width - (rect.x + rect.w < 1 - edgeTolerance ? half : 0)
        let bottom = (rect.y + rect.h) * size.height - (rect.y + rect.h < 1 - edgeTolerance ? half : 0)
        return CGRect(x: left, y: top, width: max(right - left, 0), height: max(bottom - top, 0))
    }

    /// 格子貼著畫面邊緣的那幾側，要避開的範圍（瀏海、圓角、Home 指示條）。
    /// 影片本身畫到邊緣，只有操作列、圖示、輸入框避開。
    private static func insets(of rect: FracRect, safeArea: EdgeInsets) -> EdgeInsets {
        EdgeInsets(
            top: rect.y > edgeTolerance ? 0 : safeArea.top,
            leading: rect.x > edgeTolerance ? 0 : safeArea.leading,
            bottom: rect.y + rect.h < 1 - edgeTolerance ? 0 : safeArea.bottom,
            trailing: rect.x + rect.w < 1 - edgeTolerance ? 0 : safeArea.trailing
        )
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
