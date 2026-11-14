package local.multiview.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * 讀取動畫（桌面版 R99）：原創的小生物「麻糬」在格子中央彈跳，下方是「解析中…」或「載入中…」。
 * 圖案和動畫由 iOS 版的 LoadingCritter.swift 改寫（座標相同）；不攔截點擊。
 */
@Composable
fun LoadingCritter(
    /** yt-dlp 解析中：立即顯示。載入中、緩衝中：超過 0.5 秒才顯示，避免閃爍。 */
    resolving: Boolean,
    /** 格子的大小：小生物的大小跟著格子，格子太小時不顯示文字。 */
    containerWidth: Dp,
    containerHeight: Dp,
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(resolving) {
        if (!resolving) delay(500)
        visible = true
    }
    if (!visible) return

    var time by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val start = withFrameNanos { it }
        while (true) {
            withFrameNanos { time = it - start }
        }
    }

    // 小生物的邊長：格子短邊的 14%，限制在 24–52dp
    val side = (minOf(containerWidth, containerHeight) * 0.14f).coerceIn(24.dp, 52.dp)
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Canvas(modifier = Modifier.size(side)) {
            drawCritter(time / 1_000_000_000.0)
        }
        if (containerWidth > 180.dp && containerHeight > 110.dp) {
            Text(
                if (resolving) "解析中…" else "載入中…",
                color = Color(0xFFD9F5EB),
                fontSize = 12.sp,
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.55f), CircleShape)
                    .padding(horizontal = 8.dp, vertical = 1.dp),
            )
        }
    }
}

private val bodyFill = Color(0xFF9FE7CB)
private val bodyStroke = Color(0xFF6FCFA9)
private val ink = Color(0xFF21302B)
private val cheek = Color(0xFFFF9FB3)

private const val HOP_PERIOD = 0.9
private const val BLINK_PERIOD = 3.2
private const val BODY_BOTTOM_X = 50f
private const val BODY_BOTTOM_Y = 89f
private const val BODY_HEIGHT = 51f

/** 彈跳的關鍵影格：時間（0–1）、往上的位移（身體高度的比例）、橫向與縱向的縮放。落地壓扁、彈起拉長。 */
private val hopFrames = listOf(
    doubleArrayOf(0.0, 0.0, 1.14, 0.84),
    doubleArrayOf(0.15, 0.06, 0.92, 1.1),
    doubleArrayOf(0.5, 0.34, 1.0, 1.0),
    doubleArrayOf(0.85, 0.06, 0.95, 1.06),
    doubleArrayOf(1.0, 0.0, 1.14, 0.84),
)

/** 兩個關鍵影格之間平滑地變化；回傳 [位移, 橫向縮放, 縱向縮放]。 */
private fun interpolate(phase: Double): DoubleArray {
    for (index in 1 until hopFrames.size) {
        val to = hopFrames[index]
        if (phase <= to[0]) {
            val from = hopFrames[index - 1]
            val linear = (phase - from[0]) / (to[0] - from[0])
            val eased = linear * linear * (3 - 2 * linear)
            return doubleArrayOf(
                from[1] + (to[1] - from[1]) * eased,
                from[2] + (to[2] - from[2]) * eased,
                from[3] + (to[3] - from[3]) * eased,
            )
        }
    }
    return doubleArrayOf(0.0, 1.14, 0.84)
}

/** 眨眼：週期的 90%–100% 之間閉一下眼。 */
private fun blinkScale(phase: Double): Float {
    if (phase <= 0.9) return 1f
    val closing = if (phase < 0.93) (phase - 0.9) / 0.03 else 1 - (phase - 0.93) / 0.07
    return (1 - 0.9 * closing.coerceIn(0.0, 1.0)).toFloat()
}

private fun DrawScope.oval(cx: Float, cy: Float, rx: Float, ry: Float, color: Color) {
    drawOval(color, topLeft = Offset(cx - rx, cy - ry), size = Size(rx * 2, ry * 2))
}

/** 畫小生物。座標和桌面版的 SVG 相同（viewBox 是 10 18 80 80）。 */
private fun DrawScope.drawCritter(time: Double) {
    val unit = minOf(size.width, size.height) / 80f
    val hop = interpolate((time % HOP_PERIOD) / HOP_PERIOD)
    val lift = hop[0].toFloat()
    val height = lift / 0.34f

    scale(unit, unit, pivot = Offset.Zero) {
        translate(-10f, -18f) {
            // 影子：跳得越高越小、越淡
            val shadow = 1.1f - 0.5f * height
            oval(50f, 93f, 22f * shadow, 4.5f * shadow, bodyFill.copy(alpha = 0.22f * (1 - 0.5f * height)))

            // 身體：以底部中央為原點縮放，再往上移
            translate(0f, -lift * BODY_HEIGHT) {
                scale(hop[1].toFloat(), hop[2].toFloat(), pivot = Offset(BODY_BOTTOM_X, BODY_BOTTOM_Y)) {
                    val outline = Path().apply {
                        moveTo(50f, 38f)
                        cubicTo(69f, 38f, 82f, 51f, 82f, 67f)
                        cubicTo(82f, 81f, 70f, 89f, 50f, 89f)
                        cubicTo(30f, 89f, 18f, 81f, 18f, 67f)
                        cubicTo(18f, 51f, 31f, 38f, 50f, 38f)
                        close()
                    }
                    drawPath(outline, bodyFill)
                    drawPath(outline, bodyStroke, style = Stroke(width = 1.5f))

                    // 左上的光澤
                    rotate(-25f, pivot = Offset(37f, 50f)) {
                        oval(37f, 50f, 8f, 4.5f, Color.White.copy(alpha = 0.55f))
                    }

                    // 眼睛：每 3.2 秒眨一次
                    scale(1f, blinkScale((time % BLINK_PERIOD) / BLINK_PERIOD), pivot = Offset(50f, 62f)) {
                        for (x in floatArrayOf(41f, 59f)) {
                            oval(x, 62f, 3.4f, 3.4f, ink)
                            oval(x + 1.2f, 60.8f, 1f, 1f, Color.White)
                        }
                    }

                    // 腮紅
                    for (x in floatArrayOf(33f, 67f)) {
                        oval(x, 69f, 4.6f, 2.8f, cheek.copy(alpha = 0.75f))
                    }

                    // 嘴巴
                    val mouth = Path().apply {
                        moveTo(47f, 68.5f)
                        quadraticTo(50f, 71.1f, 53f, 68.5f)
                    }
                    drawPath(mouth, ink, style = Stroke(width = 1.6f, cap = StrokeCap.Round))

                    // 肚子上的播放符號
                    val play = Path().apply {
                        moveTo(46.5f, 75.5f)
                        lineTo(46.5f, 83.5f)
                        lineTo(53.5f, 79.5f)
                        close()
                    }
                    drawPath(play, Color.White.copy(alpha = 0.9f))
                    drawPath(play, Color.White.copy(alpha = 0.9f), style = Stroke(width = 1.5f, join = StrokeJoin.Round))
                }
            }
        }
    }
}
