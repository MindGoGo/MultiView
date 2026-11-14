import XCTest
@testable import MultiViewCore

/// 版型與格子編號（R4、R124）、分隔線（R5、R125）。測試案例沿用桌面版 tests/unit/layout.test.ts。
final class LayoutTests: XCTestCase {
    /// 四捨五入到小數 6 位，避免浮點數誤差。
    private func r6(_ value: Double) -> Double {
        (value * 1e6).rounded() / 1e6
    }

    private func r6(rect: FracRect) -> FracRect {
        FracRect(x: r6(rect.x), y: r6(rect.y), w: r6(rect.w), h: r6(rect.h))
    }

    private func cells(_ layout: LayoutID, stacked: Bool = false) -> [FracRect] {
        LayoutMath.cellRects(layout, Ratios.defaults(for: layout), stacked: stacked).map { r6(rect: $0) }
    }

    func testCellCounts() {
        XCTAssertEqual(LayoutID.allCases.map(\.rawValue), ["1", "2", "2x2", "3x3", "1+3"])
        XCTAssertEqual(LayoutID.allCases.map(\.cellCount), [1, 2, 4, 9, 4])
        XCTAssertEqual(LayoutID.default, .grid2)
    }

    func testRectsCoverTheWholeScreen() {
        for layout in LayoutID.allCases {
            let rects = LayoutMath.cellRects(layout, Ratios.defaults(for: layout))
            XCTAssertEqual(rects.count, layout.cellCount, layout.rawValue)
            XCTAssertEqual(rects.reduce(0) { $0 + $1.w * $1.h }, 1, accuracy: 1e-9, layout.rawValue)
        }
    }

    func testGrid2Order() {
        XCTAssertEqual(cells(.grid2), [
            FracRect(x: 0, y: 0, w: 0.5, h: 0.5),
            FracRect(x: 0.5, y: 0, w: 0.5, h: 0.5),
            FracRect(x: 0, y: 0.5, w: 0.5, h: 0.5),
            FracRect(x: 0.5, y: 0.5, w: 0.5, h: 0.5)
        ])
    }

    func testGrid3Order() {
        let rects = cells(.grid3)
        let third = r6(1.0 / 3)
        let twoThirds = r6(2.0 / 3)
        XCTAssertEqual(rects[3], FracRect(x: 0, y: third, w: third, h: third))
        XCTAssertEqual(rects[8], FracRect(x: twoThirds, y: twoThirds, w: third, h: third))
    }

    func testOnePlusThree() {
        let rects = cells(.onePlusThree)
        XCTAssertEqual(rects[0], FracRect(x: 0, y: 0, w: 0.5, h: 1))
        XCTAssertEqual(rects.dropFirst().map(\.x), [0.5, 0.5, 0.5])
        XCTAssertEqual(rects.dropFirst().map(\.y), [0, r6(1.0 / 3), r6(2.0 / 3)])
    }

    func testStackedTwo() {
        // 小螢幕直向：2 版型上下排列（R124 AC2）
        XCTAssertEqual(cells(.two), [FracRect(x: 0, y: 0, w: 0.5, h: 1), FracRect(x: 0.5, y: 0, w: 0.5, h: 1)])
        XCTAssertEqual(cells(.two, stacked: true), [FracRect(x: 0, y: 0, w: 1, h: 0.5), FracRect(x: 0, y: 0.5, w: 1, h: 0.5)])
        // 其他版型不受影響
        XCTAssertEqual(cells(.grid2, stacked: true), cells(.grid2))
    }

    func testDividerCounts() {
        func count(_ layout: LayoutID) -> [Int] {
            let dividers = LayoutMath.dividers(layout, Ratios.defaults(for: layout))
            return [dividers.filter { $0.axis == .cols }.count, dividers.filter { $0.axis == .rows }.count]
        }
        XCTAssertEqual(count(.one), [0, 0])
        XCTAssertEqual(count(.two), [1, 0])
        XCTAssertEqual(count(.grid2), [1, 1])
        XCTAssertEqual(count(.grid3), [2, 2])
        XCTAssertEqual(count(.onePlusThree), [1, 2])
    }

    func testDividersSpanTheScreen() {
        for layout in [LayoutID.grid2, .grid3] {
            for divider in LayoutMath.dividers(layout, Ratios.defaults(for: layout)) {
                XCTAssertEqual([divider.from, divider.to], [0, 1])
                XCTAssertEqual(divider.screenAxis, divider.axis)
            }
        }
    }

    func testOnePlusThreeRowDividersOnlyInRightColumn() {
        let ratios = Ratios(cols: [0.7, 0.3], rows: [1.0 / 3, 1.0 / 3, 1.0 / 3])
        let rows = LayoutMath.dividers(.onePlusThree, ratios).filter { $0.axis == .rows }
        XCTAssertEqual(rows.count, 2)
        for divider in rows {
            XCTAssertEqual([r6(divider.from), divider.to], [0.7, 1])
        }
    }

    func testStackedTwoDividerIsHorizontalOnScreen() {
        let dividers = LayoutMath.dividers(.two, Ratios.defaults(for: .two), stacked: true)
        XCTAssertEqual(dividers.count, 1)
        XCTAssertEqual(dividers[0].axis, .cols)
        XCTAssertEqual(dividers[0].screenAxis, .rows)
    }

    func testMoveDivider() {
        XCTAssertEqual(LayoutMath.moveDivider([0.5, 0.5], index: 0, to: 0.7, min: 0.1).map { r6($0) }, [0.7, 0.3])
        let third = 1.0 / 3
        XCTAssertEqual(
            LayoutMath.moveDivider([third, third, third], index: 1, to: 0.8, min: 0.1).map { r6($0) },
            [r6(third), r6(0.8 - third), r6(0.2)]
        )
    }

    func testMoveDividerStopsAtMinimum() {
        XCTAssertEqual(LayoutMath.moveDivider([0.5, 0.5], index: 0, to: 0.99, min: 0.2).map { r6($0) }, [0.8, 0.2])
        XCTAssertEqual(LayoutMath.moveDivider([0.5, 0.5], index: 0, to: -1, min: 0.2).map { r6($0) }, [0.2, 0.8])
    }

    func testMinFraction() {
        XCTAssertEqual(LayoutMath.minFraction(.cols, containerLength: 1000), 0.16, accuracy: 1e-9)
        XCTAssertEqual(LayoutMath.minFraction(.cols, containerLength: 3000), 0.1, accuracy: 1e-9)
        XCTAssertEqual(LayoutMath.minFraction(.rows, containerLength: 600), 0.15, accuracy: 1e-9)
        XCTAssertEqual(LayoutMath.minFraction(.rows, containerLength: 2000), 0.1, accuracy: 1e-9)
    }

    func testMoveDividerKeepsSizesWhenNoRoom() {
        let sizes = [0.3, 0.3, 0.4]
        XCTAssertEqual(LayoutMath.moveDivider(sizes, index: 0, to: 0.5, min: 0.35), sizes)
        // 不存在的分隔線
        XCTAssertEqual(LayoutMath.moveDivider(sizes, index: 2, to: 0.5, min: 0.1), sizes)
    }

    func testResetDivider() {
        XCTAssertEqual(
            LayoutMath.resetDivider([0.2, 0.5, 0.3], index: 0, min: 0.1).map { r6($0) },
            [r6(1.0 / 3), r6(0.7 - 1.0 / 3), 0.3]
        )
        // 第 2 條邊界在 0.6；第 1 條要回到 1/3，但右側最少要留 0.3
        XCTAssertEqual(LayoutMath.resetDivider([0.1, 0.5, 0.4], index: 0, min: 0.3).map { r6($0) }, [0.3, 0.3, 0.4])
    }

    func testRatiosValidation() {
        XCTAssertTrue(Ratios(cols: [0.6, 0.4], rows: [0.5, 0.5]).isValid(for: .grid2))
        XCTAssertFalse(Ratios(cols: [0.6, 0.4], rows: [0.5]).isValid(for: .grid2))
        XCTAssertFalse(Ratios(cols: [0.6, 0.6], rows: [1]).isValid(for: .two))
        XCTAssertFalse(Ratios(cols: [1.2, -0.2], rows: [1]).isValid(for: .two))
    }

    // MARK: 大螢幕與小螢幕（R124）

    func testScreenSize() {
        XCTAssertTrue(ScreenRules.isLarge(width: 1024, height: 768))
        XCTAssertTrue(ScreenRules.isLarge(width: 600, height: 600))
        XCTAssertFalse(ScreenRules.isLarge(width: 393, height: 852)) // iPhone 直向
        XCTAssertFalse(ScreenRules.isLarge(width: 852, height: 393)) // iPhone 橫向
        XCTAssertFalse(ScreenRules.isLarge(width: 320, height: 1024)) // iPad 分割畫面的 1/3
    }

    func testAvailableLayouts() {
        XCTAssertEqual(ScreenRules.availableLayouts(isLarge: true), LayoutID.allCases)
        XCTAssertEqual(ScreenRules.availableLayouts(isLarge: false), [.one, .two])
    }

    func testDisplayedLayout() {
        for layout in LayoutID.allCases {
            XCTAssertEqual(ScreenRules.displayedLayout(layout, isLarge: true), layout)
        }
        XCTAssertEqual(ScreenRules.displayedLayout(.one, isLarge: false), .one)
        XCTAssertEqual(ScreenRules.displayedLayout(.two, isLarge: false), .two)
        XCTAssertEqual(ScreenRules.displayedLayout(.grid2, isLarge: false), .two)
        XCTAssertEqual(ScreenRules.displayedLayout(.grid3, isLarge: false), .two)
        XCTAssertEqual(ScreenRules.displayedLayout(.onePlusThree, isLarge: false), .two)
    }

    func testStackedOnlyOnTallSmallScreens() {
        XCTAssertTrue(ScreenRules.isStacked(width: 393, height: 852))
        XCTAssertFalse(ScreenRules.isStacked(width: 852, height: 393))
        XCTAssertFalse(ScreenRules.isStacked(width: 834, height: 1194)) // iPad 直向是大螢幕
    }
}
