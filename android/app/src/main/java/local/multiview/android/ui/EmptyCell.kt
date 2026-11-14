package local.multiview.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.AppModel

/**
 * 空白格：網址輸入框與「貼上」按鈕（R150）。
 * 點輸入框會開一個小視窗輸入：直接在格子裡打字時，鍵盤會蓋住下方的格子。
 */
@Composable
fun EmptyCell(model: AppModel, index: Int, insets: PaddingValues) {
    val context = LocalContext.current
    var editing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black).padding(insets), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.widthIn(max = 420.dp).padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "貼上 YouTube、mp4、m3u8 或影片網頁的網址",
                color = Color.White.copy(alpha = 0.6f),
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                        .clickable { editing = true }
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text("輸入網址…", color = Color.White.copy(alpha = 0.45f), fontSize = 14.sp)
                }
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Accent)
                        .clickable {
                            val pasted = clipboardText(context)
                            error = if (pasted == null) "剪貼簿裡沒有文字" else model.setSource(pasted, index)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(AppIcons.Paste, contentDescription = "貼上", tint = Color.White, modifier = Modifier.size(22.dp))
                }
            }
            error?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 13.sp) }
        }
    }

    if (editing) {
        UrlDialog(
            title = "第 ${index + 1} 格的網址",
            initial = "",
            confirmLabel = "播放",
            onDismiss = { editing = false },
            onSubmit = { model.setSource(it, index) },
        )
    }
}
