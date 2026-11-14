package local.multiview.android.lab

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 每一格上面的狀態文字與聲音控制（靜音、音量 0–100%）。 */
@Composable
fun CellOverlay(
    index: Int,
    status: String,
    muted: Boolean,
    volume: Float,
    onMutedChange: (Boolean) -> Unit,
    onVolumeChange: (Float) -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize()) {
        Text(
            "$index  $status",
            color = Color.White,
            fontSize = 11.sp,
            lineHeight = 13.sp,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(4.dp)
                .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(4.dp))
                .padding(horizontal = 4.dp, vertical = 2.dp),
        )
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (muted) "🔇" else "🔊",
                fontSize = 18.sp,
                modifier = Modifier
                    .clickable { onMutedChange(!muted) }
                    .padding(6.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Slider(
                    value = volume,
                    onValueChange = onVolumeChange,
                    modifier = Modifier.height(28.dp),
                    colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = Color(0xFF3D8BFD)),
                )
            }
            Text(
                "${(volume * 100).toInt()}%",
                color = Color.White,
                fontSize = 11.sp,
                modifier = Modifier.width(34.dp).padding(start = 4.dp),
            )
        }
    }
}
