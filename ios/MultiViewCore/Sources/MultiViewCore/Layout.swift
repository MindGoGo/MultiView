import Foundation

/// 版型定義、格子位置計算（桌面版 R4；iOS 版 R124）與分隔線比例（R5、R125）。由 `src/lib/layout.ts` 改寫。
public enum LayoutID: String, CaseIterable, Sendable {
    case one = "1"
    case two = "2"
    case grid2 = "2x2"
    case grid3 = "3x3"
    case onePlusThree = "1+3"

    public static let `default`: LayoutID = .grid2

    /// 工具列上顯示的名稱。
    public var label: String {
        switch self {
        case .one: return "1"
        case .two: return "2"
        case .grid2: return "2×2"
        case .grid3: return "3×3"
        case .onePlusThree: return "1+3"
        }
    }

    /// 這個版型顯示幾格。
    public var cellCount: Int { shape.cells }

    var shape: (cells: Int, cols: Int, rows: Int) {
        switch self {
        case .one: return (1, 1, 1)
        case .two: return (2, 2, 1)
        case .grid2: return (4, 2, 2)
        case .grid3: return (9, 3, 3)
        case .onePlusThree: return (4, 2, 3)
        }
    }
}

/// 各軌道（欄或列）的寬度比例，總和為 1。`1+3` 的 rows 是右欄內的三列。
public struct Ratios: Equatable, Sendable {
    public var cols: [Double]
    public var rows: [Double]

    public init(cols: [Double], rows: [Double]) {
        self.cols = cols
        self.rows = rows
    }

    public static func defaults(for layout: LayoutID) -> Ratios {
        let shape = layout.shape
        return Ratios(cols: even(shape.cols), rows: even(shape.rows))
    }

    /// 數量對、都是正數、總和是 1。
    public func isValid(for layout: LayoutID) -> Bool {
        let shape = layout.shape
        return Ratios.isValid(cols, count: shape.cols) && Ratios.isValid(rows, count: shape.rows)
    }

    private static func even(_ count: Int) -> [Double] {
        Array(repeating: 1 / Double(count), count: count)
    }

    private static func isValid(_ sizes: [Double], count: Int) -> Bool {
        sizes.count == count
            && sizes.allSatisfy { $0.isFinite && $0 > 0 }
            && abs(sizes.reduce(0, +) - 1) < 1e-6
    }
}

/// 以 0–1 表示的矩形。
public struct FracRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    /// 橫向和直向對調（小螢幕的 `2` 版型上下排列時用，R124）。
    var transposed: FracRect {
        FracRect(x: y, y: x, w: h, h: w)
    }
}

public enum Axis: String, Sendable {
    case cols, rows

    var transposed: Axis { self == .cols ? .rows : .cols }
}

/// 一條分隔線：位於 axis 上第 index 條邊界（第 index 與 index+1 軌道之間）。
public struct DividerDef: Equatable, Sendable {
    /// 這條分隔線調整的是哪一組比例（`Ratios.cols` 或 `Ratios.rows`）。
    public var axis: Axis
    public var index: Int
    /// 分隔線的位置（0–1）。
    public var pos: Double
    /// 分隔線在另一個方向上的起點與終點（0–1）。
    public var from: Double
    public var to: Double
    /// 畫面上是直的（左右拖曳）還是橫的（上下拖曳）。通常和 axis 相同；`2` 版型上下排列時相反。
    public var screenAxis: Axis
}

public enum LayoutMath {
    public static let minCellWidth: Double = 160
    public static let minCellHeight: Double = 90
    public static let minCellFraction: Double = 0.1

    /// 每一格的位置，索引 0 是第 1 格。編號由左到右、由上到下（R4）。
    /// stacked：`2` 版型改成上下排列（小螢幕而且畫面比較高時，R124）；其他版型不受影響。
    public static func cellRects(_ layout: LayoutID, _ ratios: Ratios, stacked: Bool = false) -> [FracRect] {
        let xs = offsets(ratios.cols)
        let ys = offsets(ratios.rows)
        if layout == .onePlusThree {
            let main = FracRect(x: 0, y: 0, w: ratios.cols[0], h: 1)
            let side = ratios.rows.enumerated().map { index, height in
                FracRect(x: xs[1], y: ys[index], w: ratios.cols[1], h: height)
            }
            return [main] + side
        }
        var rects: [FracRect] = []
        for (row, height) in ratios.rows.enumerated() {
            for (col, width) in ratios.cols.enumerated() {
                rects.append(FracRect(x: xs[col], y: ys[row], w: width, h: height))
            }
        }
        return isStacked(layout, stacked) ? rects.map(\.transposed) : rects
    }

    public static func dividers(_ layout: LayoutID, _ ratios: Ratios, stacked: Bool = false) -> [DividerDef] {
        let xs = offsets(ratios.cols)
        let ys = offsets(ratios.rows)
        let flip = isStacked(layout, stacked)
        var out: [DividerDef] = []
        if ratios.cols.count > 1 {
            for index in 0..<(ratios.cols.count - 1) {
                out.append(DividerDef(
                    axis: .cols, index: index, pos: xs[index + 1], from: 0, to: 1,
                    screenAxis: flip ? .rows : .cols
                ))
            }
        }
        // 1+3 的橫線只在右欄
        let rowFrom = layout == .onePlusThree ? xs[1] : 0
        if ratios.rows.count > 1 {
            for index in 0..<(ratios.rows.count - 1) {
                out.append(DividerDef(
                    axis: .rows, index: index, pos: ys[index + 1], from: rowFrom, to: 1,
                    screenAxis: flip ? .cols : .rows
                ))
            }
        }
        return out
    }

    /// 一格在指定方向上的最小比例（R5 AC2）：max(160pt 或 90pt, 10%)。
    /// axis 是畫面上的方向；containerLength 是格子所在方向的可用長度。
    public static func minFraction(_ axis: Axis, containerLength: Double) -> Double {
        let length = axis == .cols ? minCellWidth : minCellHeight
        return max(length / max(containerLength, 1), minCellFraction)
    }

    /// 把第 index 條邊界移到 pos，兩側的軌道都不能小於 min。
    public static func moveDivider(_ sizes: [Double], index: Int, to pos: Double, min: Double) -> [Double] {
        guard index >= 0, index + 1 < sizes.count else { return sizes }
        let edges = offsets(sizes)
        let low = edges[index] + min
        let high = edges[index + 2] - min
        // 空間本來就不夠時維持原狀
        if low > high { return sizes }
        let clamped = Swift.min(Swift.max(pos, low), high)
        var next = sizes
        next[index] = clamped - edges[index]
        next[index + 1] = edges[index + 2] - clamped
        return next
    }

    /// 雙擊分隔線：只把這條邊界移回均分的位置（R5 AC3）。
    public static func resetDivider(_ sizes: [Double], index: Int, min: Double) -> [Double] {
        moveDivider(sizes, index: index, to: Double(index + 1) / Double(sizes.count), min: min)
    }

    private static func isStacked(_ layout: LayoutID, _ stacked: Bool) -> Bool {
        stacked && layout == .two
    }

    private static func offsets(_ sizes: [Double]) -> [Double] {
        var out: [Double] = [0]
        for size in sizes {
            out.append(out[out.count - 1] + size)
        }
        return out
    }
}

/// 大螢幕與小螢幕的版型規則（R124）。
public enum ScreenRules {
    /// 寬度和高度都至少這麼多才算大螢幕（規格第 3 節）。
    public static let largeMinLength: Double = 600

    public static func isLarge(width: Double, height: Double) -> Bool {
        width >= largeMinLength && height >= largeMinLength
    }

    /// 工具列可以選的版型：小螢幕只有 `1`、`2`。
    public static func availableLayouts(isLarge: Bool) -> [LayoutID] {
        isLarge ? LayoutID.allCases : [.one, .two]
    }

    /// 實際顯示的版型：小螢幕時，`2×2`、`3×3`、`1+3` 暫時用 `2` 顯示（不改變設定的版型）。
    public static func displayedLayout(_ setting: LayoutID, isLarge: Bool) -> LayoutID {
        if isLarge || setting == .one || setting == .two { return setting }
        return .two
    }

    /// 小螢幕的 `2` 版型：畫面比較高時上下排列，比較寬時左右排列。大螢幕一律左右排列。
    public static func isStacked(width: Double, height: Double) -> Bool {
        !isLarge(width: width, height: height) && height > width
    }
}
