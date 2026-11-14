package local.multiview.core

import kotlin.math.abs

/** 版型定義、格子位置計算（桌面版 R4；Android 版 R149）與分隔線比例（R5）。由 iOS 版的 Layout.swift 改寫。 */
enum class LayoutId(val raw: String, val label: String, val cellCount: Int, internal val cols: Int, internal val rows: Int) {
    ONE("1", "1", 1, 1, 1),
    TWO("2", "2", 2, 2, 1),
    GRID2("2x2", "2×2", 4, 2, 2),
    GRID3("3x3", "3×3", 9, 3, 3),
    ONE_PLUS_THREE("1+3", "1+3", 4, 2, 3);

    companion object {
        val DEFAULT = GRID2

        fun fromRaw(raw: String?): LayoutId? = entries.firstOrNull { it.raw == raw }
    }
}

/** 各軌道（欄或列）的寬度比例，總和為 1。`1+3` 的 rows 是右欄內的三列。 */
data class Ratios(val cols: List<Double>, val rows: List<Double>) {
    /** 數量對、都是正數、總和是 1。 */
    fun isValid(layout: LayoutId): Boolean = isValid(cols, layout.cols) && isValid(rows, layout.rows)

    companion object {
        fun defaults(layout: LayoutId) = Ratios(even(layout.cols), even(layout.rows))

        private fun even(count: Int) = List(count) { 1.0 / count }

        private fun isValid(sizes: List<Double>, count: Int) =
            sizes.size == count && sizes.all { it.isFinite() && it > 0 } && abs(sizes.sum() - 1) < 1e-6
    }
}

/** 以 0–1 表示的矩形。 */
data class FracRect(val x: Double, val y: Double, val w: Double, val h: Double) {
    /** 橫向和直向對調（小螢幕的 `2` 版型上下排列時用）。 */
    internal val transposed: FracRect get() = FracRect(y, x, h, w)
}

enum class TrackAxis {
    COLS, ROWS;

    internal val transposed: TrackAxis get() = if (this == COLS) ROWS else COLS
}

/** 一條分隔線：位於 axis 上第 index 條邊界（第 index 與 index+1 軌道之間）。 */
data class DividerDef(
    /** 這條分隔線調整的是哪一組比例（cols 或 rows）。 */
    val axis: TrackAxis,
    val index: Int,
    /** 分隔線的位置（0–1）。 */
    val pos: Double,
    /** 分隔線在另一個方向上的起點與終點（0–1）。 */
    val from: Double,
    val to: Double,
    /** 畫面上是直的（左右拖曳）還是橫的（上下拖曳）。通常和 axis 相同；`2` 版型上下排列時相反。 */
    val screenAxis: TrackAxis,
)

object LayoutMath {
    const val MIN_CELL_WIDTH = 160.0
    const val MIN_CELL_HEIGHT = 90.0
    const val MIN_CELL_FRACTION = 0.1

    /**
     * 每一格的位置，索引 0 是第 1 格。編號由左到右、由上到下（R4）。
     * stacked：`2` 版型改成上下排列（小螢幕而且畫面比較高時）；其他版型不受影響。
     */
    fun cellRects(layout: LayoutId, ratios: Ratios, stacked: Boolean = false): List<FracRect> {
        val xs = offsets(ratios.cols)
        val ys = offsets(ratios.rows)
        if (layout == LayoutId.ONE_PLUS_THREE) {
            val main = FracRect(0.0, 0.0, ratios.cols[0], 1.0)
            return listOf(main) + ratios.rows.mapIndexed { index, height -> FracRect(xs[1], ys[index], ratios.cols[1], height) }
        }
        val rects = ratios.rows.flatMapIndexed { row, height ->
            ratios.cols.mapIndexed { col, width -> FracRect(xs[col], ys[row], width, height) }
        }
        return if (isStacked(layout, stacked)) rects.map { it.transposed } else rects
    }

    fun dividers(layout: LayoutId, ratios: Ratios, stacked: Boolean = false): List<DividerDef> {
        val xs = offsets(ratios.cols)
        val ys = offsets(ratios.rows)
        val flip = isStacked(layout, stacked)
        val out = mutableListOf<DividerDef>()
        for (index in 0 until ratios.cols.size - 1) {
            out += DividerDef(TrackAxis.COLS, index, xs[index + 1], 0.0, 1.0, if (flip) TrackAxis.ROWS else TrackAxis.COLS)
        }
        // 1+3 的橫線只在右欄
        val rowFrom = if (layout == LayoutId.ONE_PLUS_THREE) xs[1] else 0.0
        for (index in 0 until ratios.rows.size - 1) {
            out += DividerDef(TrackAxis.ROWS, index, ys[index + 1], rowFrom, 1.0, if (flip) TrackAxis.COLS else TrackAxis.ROWS)
        }
        return out
    }

    /**
     * 一格在指定方向上的最小比例（R5 AC2）：max(160dp 或 90dp, 10%)。
     * axis 是畫面上的方向；containerLength 是格子所在方向的可用長度。
     */
    fun minFraction(axis: TrackAxis, containerLength: Double): Double {
        val length = if (axis == TrackAxis.COLS) MIN_CELL_WIDTH else MIN_CELL_HEIGHT
        return maxOf(length / maxOf(containerLength, 1.0), MIN_CELL_FRACTION)
    }

    /** 把第 index 條邊界移到 pos，兩側的軌道都不能小於 min。 */
    fun moveDivider(sizes: List<Double>, index: Int, to: Double, min: Double): List<Double> {
        if (index < 0 || index + 1 >= sizes.size) return sizes
        val edges = offsets(sizes)
        val low = edges[index] + min
        val high = edges[index + 2] - min
        // 空間本來就不夠時維持原狀
        if (low > high) return sizes
        val clamped = to.coerceIn(low, high)
        return sizes.toMutableList().also {
            it[index] = clamped - edges[index]
            it[index + 1] = edges[index + 2] - clamped
        }
    }

    /** 雙擊分隔線：只把這條邊界移回均分的位置（R5 AC3）。 */
    fun resetDivider(sizes: List<Double>, index: Int, min: Double): List<Double> =
        moveDivider(sizes, index, (index + 1).toDouble() / sizes.size, min)

    private fun isStacked(layout: LayoutId, stacked: Boolean) = stacked && layout == LayoutId.TWO

    private fun offsets(sizes: List<Double>): List<Double> = sizes.runningFold(0.0) { sum, size -> sum + size }
}

/** 大螢幕與小螢幕的版型規則（R149）。 */
object ScreenRules {
    /** 寬度和高度都至少這麼多（dp）才算大螢幕（規格第 3 節）。 */
    const val LARGE_MIN_LENGTH = 600.0

    fun isLarge(width: Double, height: Double) = width >= LARGE_MIN_LENGTH && height >= LARGE_MIN_LENGTH

    /** 工具列可以選的版型：小螢幕只有 `1`、`2`。 */
    fun availableLayouts(isLarge: Boolean): List<LayoutId> =
        if (isLarge) LayoutId.entries else listOf(LayoutId.ONE, LayoutId.TWO)

    /** 實際顯示的版型：小螢幕時，`2×2`、`3×3`、`1+3` 暫時用 `2` 顯示（不改變設定的版型）。 */
    fun displayedLayout(setting: LayoutId, isLarge: Boolean): LayoutId =
        if (isLarge || setting == LayoutId.ONE || setting == LayoutId.TWO) setting else LayoutId.TWO

    /** 小螢幕的 `2` 版型：畫面比較高時上下排列，比較寬時左右排列。大螢幕一律左右排列。 */
    fun isStacked(width: Double, height: Double) = !isLarge(width, height) && height > width
}
