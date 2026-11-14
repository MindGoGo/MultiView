package local.multiview.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import local.multiview.android.AppModel
import local.multiview.core.CellSource
import local.multiview.core.DividerDef
import local.multiview.core.FracRect
import local.multiview.core.LayoutId
import local.multiview.core.LayoutMath
import local.multiview.core.ParsedSource
import local.multiview.core.ScreenRules
import local.multiview.core.TrackAxis

/** 螢幕邊緣要避開的範圍（瀏海、導覽列）。格子畫到邊緣，貼著邊緣的操作列、按鈕要避開。 */
data class EdgeInsets(val left: Dp = 0.dp, val top: Dp = 0.dp, val right: Dp = 0.dp, val bottom: Dp = 0.dp)

/** 格子之間的間隔（分隔線看起來的寬度）。只在格子和格子之間，畫面邊緣沒有。 */
private val Gap = 2.dp

/** 分隔線手指可以按的範圍。 */
private val DividerHitWidth = 24.dp

/** 判斷格子有沒有貼到畫面邊緣時容許的誤差。 */
private const val EDGE_TOLERANCE = 1e-6

/** 畫面上的一格。有來源的格子以來源的 id 識別，換位時沿用同一個畫面，不重新載入（R6 AC1）。 */
private class GridCell(val key: String, val index: Int, val rect: FracRect, val source: CellSource?)

/** 依版型排列格子與分隔線（R149）。對照 iOS 版的 GridView.swift。 */
@Composable
fun GridView(model: AppModel, safeArea: EdgeInsets) {
    BoxWithConstraints(modifier = Modifier.fillMaxSize().background(Color(0xFF292929))) {
        val density = LocalDensity.current
        val widthPx = constraints.maxWidth.toFloat()
        val heightPx = constraints.maxHeight.toFloat()
        val isLarge = ScreenRules.isLarge(maxWidth.value.toDouble(), maxHeight.value.toDouble())
        val stacked = ScreenRules.isStacked(maxWidth.value.toDouble(), maxHeight.value.toDouble())
        val layout = ScreenRules.displayedLayout(model.layout, isLarge)
        val ratios = model.ratiosFor(layout)
        val solo = model.solo
        val slots = model.slots

        SideEffect { model.setGrid(widthPx, heightPx, isLarge, stacked) }

        // 單格全螢幕：只有放大的那一格，占滿畫面。識別方式不變，所以不會重新載入（R20）
        val soloSource = solo?.let(slots::getOrNull)
        val cells = if (solo != null && soloSource != null) {
            listOf(GridCell("source-${soloSource.id}", solo, FracRect(0.0, 0.0, 1.0, 1.0), soloSource))
        } else {
            LayoutMath.cellRects(layout, ratios, stacked).mapIndexed { index, rect ->
                val source = slots.getOrNull(index)
                GridCell(source?.let { "source-${it.id}" } ?: "empty-$index", index, rect, source)
            }
        }

        val halfGap = with(density) { Gap.toPx() } / 2
        for (cell in cells) {
            key(cell.key) {
                val rect = cell.rect
                val touchesLeft = rect.x <= EDGE_TOLERANCE
                val touchesTop = rect.y <= EDGE_TOLERANCE
                val touchesRight = rect.x + rect.w >= 1 - EDGE_TOLERANCE
                val touchesBottom = rect.y + rect.h >= 1 - EDGE_TOLERANCE
                // 格子和格子之間留間隔，貼著畫面邊緣的那一側不留（影片滿版）
                val left = (rect.x * widthPx).toFloat() + if (touchesLeft) 0f else halfGap
                val top = (rect.y * heightPx).toFloat() + if (touchesTop) 0f else halfGap
                val right = ((rect.x + rect.w) * widthPx).toFloat() - if (touchesRight) 0f else halfGap
                val bottom = ((rect.y + rect.h) * heightPx).toFloat() - if (touchesBottom) 0f else halfGap
                val cellWidth = with(density) { maxOf(right - left, 0f).toDp() }
                val cellHeight = with(density) { maxOf(bottom - top, 0f).toDp() }
                // 貼著畫面邊緣的那幾側要避開瀏海、導覽列；影片本身畫到邊緣
                val insets = PaddingValues(
                    start = if (touchesLeft) safeArea.left else 0.dp,
                    top = if (touchesTop) safeArea.top else 0.dp,
                    end = if (touchesRight) safeArea.right else 0.dp,
                    bottom = if (touchesBottom) safeArea.bottom else 0.dp,
                )

                Box(
                    modifier = Modifier
                        .offset { IntOffset(left.toInt(), top.toInt()) }
                        .size(cellWidth, cellHeight),
                ) {
                    val source = cell.source
                    if (source != null) {
                        CellView(model, cell.index, source, insets, touchesTop, cellWidth, cellHeight)
                    } else {
                        EmptyCell(model, cell.index, insets)
                    }
                    // 拖曳換位中：手指所在的格子顯示外框
                    if (model.swapFrom != null && model.swapOver == cell.index && model.swapFrom != cell.index) {
                        Box(modifier = Modifier.fillMaxSize().border(4.dp, Accent))
                    }
                }
            }
        }

        // 單格全螢幕時不顯示分隔線（R20）
        if (solo == null) {
            for (divider in LayoutMath.dividers(layout, ratios, stacked)) {
                key(layout, divider.axis, divider.index) {
                    DividerHandle(model, layout, divider, widthPx, heightPx)
                }
            }
        }

        // 沒有任何「點一下就會叫出工具列」的格子時（全部是空白格或網頁），用上方的小把手叫出工具列
        val needsHandle = slots.take(layout.cellCount).none { it != null && it.parsed.kind != ParsedSource.Kind.WEB }
        if (!model.toolbarVisible && needsHandle) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = safeArea.top)
                    .clickable(onClickLabel = "顯示工具列") { model.showControls(null) }
                    .padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                Box(modifier = Modifier.size(width = 44.dp, height = 5.dp).background(Color.White.copy(alpha = 0.35f), CircleShape))
            }
        }
    }
}

/** 分隔線：看起來是格子之間 2dp 的間隔，手指可以按的範圍是 24dp；拖曳調整比例，雙擊回到平均分配（R149）。 */
@Composable
private fun DividerHandle(model: AppModel, layout: LayoutId, divider: DividerDef, widthPx: Float, heightPx: Float) {
    val density = LocalDensity.current
    // 畫面上是直的分隔線（左右拖曳）
    val vertical = divider.screenAxis == TrackAxis.COLS
    // 分隔線移動方向上的畫面長度
    val length = if (vertical) widthPx else heightPx
    val lengthDp = with(density) { length.toDp() }
    val min = LayoutMath.minFraction(divider.screenAxis, lengthDp.value.toDouble())
    val hit = with(density) { DividerHitWidth.toPx() }
    val span = (divider.to - divider.from).toFloat()

    val current by rememberUpdatedState(divider)
    val currentLength by rememberUpdatedState(length)
    val currentMin by rememberUpdatedState(min)
    var coordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }

    val x = if (vertical) (divider.pos * widthPx).toFloat() - hit / 2 else (divider.from * widthPx).toFloat()
    val y = if (vertical) (divider.from * heightPx).toFloat() else (divider.pos * heightPx).toFloat() - hit / 2
    val boxWidth = if (vertical) hit else span * widthPx
    val boxHeight = if (vertical) span * heightPx else hit

    Box(
        modifier = Modifier
            .offset { IntOffset(x.toInt(), y.toInt()) }
            .size(with(density) { boxWidth.toDp() }, with(density) { boxHeight.toDp() })
            .onGloballyPositioned { coordinates = it }
            .pointerInput(layout) {
                detectTapGestures(
                    onDoubleTap = { model.resetDivider(layout, current.axis, current.index, currentMin) },
                )
            }
            .pointerInput(layout) {
                detectDragGestures { change, _ ->
                    change.consume()
                    // 格子區域占滿整個視窗，所以視窗裡的位置就是格子區域裡的位置
                    val root = coordinates?.takeIf { it.isAttached }?.localToRoot(change.position) ?: return@detectDragGestures
                    if (currentLength <= 0) return@detectDragGestures
                    val position = (if (current.screenAxis == TrackAxis.COLS) root.x else root.y) / currentLength
                    model.moveDivider(layout, current.axis, current.index, position.toDouble(), currentMin)
                }
            },
    )
}
