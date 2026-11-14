package local.multiview.core

import kotlin.math.round
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** 版型與格子編號（R4、R149）、分隔線（R5）。照搬 iOS 版的 LayoutTests.swift。 */
class LayoutTest {
    /** 四捨五入到小數 6 位，避免浮點數誤差。 */
    private fun r6(value: Double) = round(value * 1e6) / 1e6

    private fun r6(rect: FracRect) = FracRect(r6(rect.x), r6(rect.y), r6(rect.w), r6(rect.h))

    private fun cells(layout: LayoutId, stacked: Boolean = false) =
        LayoutMath.cellRects(layout, Ratios.defaults(layout), stacked).map(::r6)

    @Test
    fun cellCounts() {
        assertEquals(listOf("1", "2", "2x2", "3x3", "1+3"), LayoutId.entries.map { it.raw })
        assertEquals(listOf(1, 2, 4, 9, 4), LayoutId.entries.map { it.cellCount })
        assertEquals(LayoutId.GRID2, LayoutId.DEFAULT)
    }

    @Test
    fun rectsCoverTheWholeScreen() {
        for (layout in LayoutId.entries) {
            val rects = LayoutMath.cellRects(layout, Ratios.defaults(layout))
            assertEquals(layout.cellCount, rects.size, layout.raw)
            assertEquals(1.0, rects.sumOf { it.w * it.h }, 1e-9, layout.raw)
        }
    }

    @Test
    fun grid2Order() {
        assertEquals(
            listOf(FracRect(0.0, 0.0, 0.5, 0.5), FracRect(0.5, 0.0, 0.5, 0.5), FracRect(0.0, 0.5, 0.5, 0.5), FracRect(0.5, 0.5, 0.5, 0.5)),
            cells(LayoutId.GRID2),
        )
    }

    @Test
    fun grid3Order() {
        val rects = cells(LayoutId.GRID3)
        val third = r6(1.0 / 3)
        val twoThirds = r6(2.0 / 3)
        assertEquals(FracRect(0.0, third, third, third), rects[3])
        assertEquals(FracRect(twoThirds, twoThirds, third, third), rects[8])
    }

    @Test
    fun onePlusThree() {
        val rects = cells(LayoutId.ONE_PLUS_THREE)
        assertEquals(FracRect(0.0, 0.0, 0.5, 1.0), rects[0])
        assertEquals(listOf(0.5, 0.5, 0.5), rects.drop(1).map { it.x })
        assertEquals(listOf(0.0, r6(1.0 / 3), r6(2.0 / 3)), rects.drop(1).map { it.y })
    }

    @Test
    fun stackedTwo() {
        // 小螢幕直向：2 版型上下排列
        assertEquals(listOf(FracRect(0.0, 0.0, 0.5, 1.0), FracRect(0.5, 0.0, 0.5, 1.0)), cells(LayoutId.TWO))
        assertEquals(listOf(FracRect(0.0, 0.0, 1.0, 0.5), FracRect(0.0, 0.5, 1.0, 0.5)), cells(LayoutId.TWO, stacked = true))
        // 其他版型不受影響
        assertEquals(cells(LayoutId.GRID2), cells(LayoutId.GRID2, stacked = true))
    }

    @Test
    fun dividerCounts() {
        fun count(layout: LayoutId): List<Int> {
            val dividers = LayoutMath.dividers(layout, Ratios.defaults(layout))
            return listOf(dividers.count { it.axis == TrackAxis.COLS }, dividers.count { it.axis == TrackAxis.ROWS })
        }
        assertEquals(listOf(0, 0), count(LayoutId.ONE))
        assertEquals(listOf(1, 0), count(LayoutId.TWO))
        assertEquals(listOf(1, 1), count(LayoutId.GRID2))
        assertEquals(listOf(2, 2), count(LayoutId.GRID3))
        assertEquals(listOf(1, 2), count(LayoutId.ONE_PLUS_THREE))
    }

    @Test
    fun dividersSpanTheScreen() {
        for (layout in listOf(LayoutId.GRID2, LayoutId.GRID3)) {
            for (divider in LayoutMath.dividers(layout, Ratios.defaults(layout))) {
                assertEquals(listOf(0.0, 1.0), listOf(divider.from, divider.to))
                assertEquals(divider.axis, divider.screenAxis)
            }
        }
    }

    @Test
    fun onePlusThreeRowDividersOnlyInRightColumn() {
        val ratios = Ratios(listOf(0.7, 0.3), listOf(1.0 / 3, 1.0 / 3, 1.0 / 3))
        val rows = LayoutMath.dividers(LayoutId.ONE_PLUS_THREE, ratios).filter { it.axis == TrackAxis.ROWS }
        assertEquals(2, rows.size)
        for (divider in rows) {
            assertEquals(listOf(0.7, 1.0), listOf(r6(divider.from), divider.to))
        }
    }

    @Test
    fun stackedTwoDividerIsHorizontalOnScreen() {
        val dividers = LayoutMath.dividers(LayoutId.TWO, Ratios.defaults(LayoutId.TWO), stacked = true)
        assertEquals(1, dividers.size)
        assertEquals(TrackAxis.COLS, dividers[0].axis)
        assertEquals(TrackAxis.ROWS, dividers[0].screenAxis)
    }

    @Test
    fun moveDivider() {
        assertEquals(listOf(0.7, 0.3), LayoutMath.moveDivider(listOf(0.5, 0.5), 0, 0.7, 0.1).map(::r6))
        val third = 1.0 / 3
        assertEquals(
            listOf(r6(third), r6(0.8 - third), r6(0.2)),
            LayoutMath.moveDivider(listOf(third, third, third), 1, 0.8, 0.1).map(::r6),
        )
    }

    @Test
    fun moveDividerStopsAtMinimum() {
        assertEquals(listOf(0.8, 0.2), LayoutMath.moveDivider(listOf(0.5, 0.5), 0, 0.99, 0.2).map(::r6))
        assertEquals(listOf(0.2, 0.8), LayoutMath.moveDivider(listOf(0.5, 0.5), 0, -1.0, 0.2).map(::r6))
    }

    @Test
    fun minFraction() {
        assertEquals(0.16, LayoutMath.minFraction(TrackAxis.COLS, 1000.0), 1e-9)
        assertEquals(0.1, LayoutMath.minFraction(TrackAxis.COLS, 3000.0), 1e-9)
        assertEquals(0.15, LayoutMath.minFraction(TrackAxis.ROWS, 600.0), 1e-9)
        assertEquals(0.1, LayoutMath.minFraction(TrackAxis.ROWS, 2000.0), 1e-9)
    }

    @Test
    fun moveDividerKeepsSizesWhenNoRoom() {
        val sizes = listOf(0.3, 0.3, 0.4)
        assertEquals(sizes, LayoutMath.moveDivider(sizes, 0, 0.5, 0.35))
        // 不存在的分隔線
        assertEquals(sizes, LayoutMath.moveDivider(sizes, 2, 0.5, 0.1))
    }

    @Test
    fun resetDivider() {
        assertEquals(
            listOf(r6(1.0 / 3), r6(0.7 - 1.0 / 3), 0.3),
            LayoutMath.resetDivider(listOf(0.2, 0.5, 0.3), 0, 0.1).map(::r6),
        )
        // 第 2 條邊界在 0.6；第 1 條要回到 1/3，但右側最少要留 0.3
        assertEquals(listOf(0.3, 0.3, 0.4), LayoutMath.resetDivider(listOf(0.1, 0.5, 0.4), 0, 0.3).map(::r6))
    }

    @Test
    fun ratiosValidation() {
        assertTrue(Ratios(listOf(0.6, 0.4), listOf(0.5, 0.5)).isValid(LayoutId.GRID2))
        assertFalse(Ratios(listOf(0.6, 0.4), listOf(0.5)).isValid(LayoutId.GRID2))
        assertFalse(Ratios(listOf(0.6, 0.6), listOf(1.0)).isValid(LayoutId.TWO))
        assertFalse(Ratios(listOf(1.2, -0.2), listOf(1.0)).isValid(LayoutId.TWO))
    }

    // 大螢幕與小螢幕

    @Test
    fun screenSize() {
        assertTrue(ScreenRules.isLarge(1024.0, 768.0))
        assertTrue(ScreenRules.isLarge(600.0, 600.0))
        assertFalse(ScreenRules.isLarge(393.0, 852.0)) // 手機直向
        assertFalse(ScreenRules.isLarge(852.0, 393.0)) // 手機橫向
        assertFalse(ScreenRules.isLarge(320.0, 1024.0)) // 平板分割畫面的 1/3
    }

    @Test
    fun availableLayouts() {
        assertEquals(LayoutId.entries.toList(), ScreenRules.availableLayouts(isLarge = true))
        assertEquals(listOf(LayoutId.ONE, LayoutId.TWO), ScreenRules.availableLayouts(isLarge = false))
    }

    @Test
    fun displayedLayout() {
        for (layout in LayoutId.entries) {
            assertEquals(layout, ScreenRules.displayedLayout(layout, isLarge = true))
        }
        assertEquals(LayoutId.ONE, ScreenRules.displayedLayout(LayoutId.ONE, isLarge = false))
        assertEquals(LayoutId.TWO, ScreenRules.displayedLayout(LayoutId.TWO, isLarge = false))
        assertEquals(LayoutId.TWO, ScreenRules.displayedLayout(LayoutId.GRID2, isLarge = false))
        assertEquals(LayoutId.TWO, ScreenRules.displayedLayout(LayoutId.GRID3, isLarge = false))
        assertEquals(LayoutId.TWO, ScreenRules.displayedLayout(LayoutId.ONE_PLUS_THREE, isLarge = false))
    }

    @Test
    fun stackedOnlyOnTallSmallScreens() {
        assertTrue(ScreenRules.isStacked(393.0, 852.0))
        assertFalse(ScreenRules.isStacked(852.0, 393.0))
        assertFalse(ScreenRules.isStacked(834.0, 1194.0)) // 平板直向是大螢幕
    }
}
