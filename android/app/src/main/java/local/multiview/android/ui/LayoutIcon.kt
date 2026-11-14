package local.multiview.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import local.multiview.core.LayoutId
import local.multiview.core.LayoutMath
import local.multiview.core.Ratios

/** 版型的圖示（R149）：依版型實際的格子位置畫出小方框，`2` 版型上下排列時也跟著畫成上下。 */
@Composable
fun LayoutIcon(layout: LayoutId, stacked: Boolean, color: Color, modifier: Modifier = Modifier) {
    val tall = stacked && layout == LayoutId.TWO
    Canvas(modifier = modifier.size(width = if (tall) 16.dp else 26.dp, height = if (tall) 22.dp else 17.dp)) {
        val gap = 2.dp.toPx()
        val corner = CornerRadius(2.dp.toPx())
        for (rect in LayoutMath.cellRects(layout, Ratios.defaults(layout), stacked)) {
            drawRoundRect(
                color = color,
                topLeft = Offset((rect.x * size.width).toFloat() + gap / 2, (rect.y * size.height).toFloat() + gap / 2),
                size = Size(
                    maxOf((rect.w * size.width).toFloat() - gap, 1f),
                    maxOf((rect.h * size.height).toFloat() - gap, 1f),
                ),
                cornerRadius = corner,
            )
        }
    }
}
