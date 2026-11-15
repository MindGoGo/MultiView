package local.multiview.android.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.player.CellPlayer
import local.multiview.android.player.PreviewThumbnails
import local.multiview.core.CellSource
import local.multiview.core.ParsedSource
import local.multiview.core.PlaybackProgress
import local.multiview.core.ProgressKind

/** 縮圖的寬度（桌面版 R50 是 160px）。 */
private val PreviewWidth = 160.dp

/**
 * 拖曳進度條時手指上方的提示（桌面版 R50）：YouTube、mp4 的一般影片有預覽縮圖，其他只顯示時間。
 * 提示限制在進度條的範圍內；進度條比縮圖窄時只顯示時間。
 */
@Composable
fun ProgressPreview(
    source: CellSource,
    player: CellPlayer?,
    progress: PlaybackProgress,
    kind: ProgressKind,
    seconds: Double,
    time: String,
    fraction: Double,
    barWidth: Int,
) {
    val density = LocalDensity.current
    val previewPx = with(density) { PreviewWidth.roundToPx() }
    val canShowImage = kind == ProgressKind.VOD && barWidth >= previewPx
    val duration = progress.end - progress.start
    // 每 2 秒換一張，拖曳時不要每一點都讀取
    val bucket = (seconds / 2).toLong()
    var image by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(source.id, bucket, canShowImage, player?.storyboard) {
        if (!canShowImage) return@LaunchedEffect
        // 用 yt-dlp 播放時用 yt-dlp 解析出來的縮圖；內嵌播放器才另外讀 YouTube 的網頁
        val storyboard = player?.storyboard
        val next = storyboard?.let { PreviewThumbnails.sheet(it, seconds, duration) } ?: when (val parsed = source.parsed) {
            is ParsedSource.YouTube -> PreviewThumbnails.youtube(parsed.videoId, seconds, duration)
            is ParsedSource.Mp4 -> PreviewThumbnails.mp4(parsed.url, seconds)
            else -> null
        }
        if (next != null) image = next
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            // 不占進度條的空間，畫在進度條上方
            .layout { measurable, _ ->
                val placeable = measurable.measure(Constraints())
                val x = (fraction * barWidth - placeable.width / 2.0).toInt()
                    .coerceIn(0, (barWidth - placeable.width).coerceAtLeast(0))
                layout(0, 0) { placeable.place(x, -placeable.height - 8.dp.roundToPx()) }
            }
            .wrapContentSize(),
    ) {
        val bitmap = image
        if (canShowImage && bitmap != null) {
            Image(
                bitmap.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.width(PreviewWidth).background(Color.Black, RoundedCornerShape(4.dp)),
            )
        }
        Text(
            time,
            color = Color.White,
            fontSize = 12.sp,
            modifier = Modifier
                .offset(y = 2.dp)
                .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
