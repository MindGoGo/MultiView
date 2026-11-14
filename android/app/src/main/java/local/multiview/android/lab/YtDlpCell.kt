package local.multiview.android.lab

import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.ytdlp.YtDlp
import local.multiview.core.ResolveResult
import local.multiview.core.YtDlpRules
import local.multiview.core.YtStream

/** 用 yt-dlp 解析網址，再用原生播放器播放的一格（R148）。 */
@Composable
fun YtDlpCell(url: String, index: Int, controller: LabController) {
    val context = LocalContext.current
    var stream by remember { mutableStateOf<YtStream?>(null) }
    var note by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("yt-dlp 解析中…") }

    LaunchedEffect(url) {
        val started = SystemClock.elapsedRealtime()
        val result = try {
            YtDlpRules.streamFromResolveOutput(YtDlp.resolve(context, url.trim()), System.currentTimeMillis().toDouble())
        } catch (error: Exception) {
            ResolveResult.Failure("Python 錯誤：${error.message}")
        }
        val seconds = (SystemClock.elapsedRealtime() - started) / 1000.0
        when (result) {
            is ResolveResult.Success -> {
                val kind = if (result.stream.kind == YtStream.Kind.HLS) "HLS" else "MP4"
                note = "yt-dlp ${"%.1f".format(seconds)} 秒 $kind\n"
                stream = result.stream
            }
            is ResolveResult.Failure -> status = "yt-dlp 失敗（${"%.1f".format(seconds)} 秒）：${result.message}"
        }
    }

    val current = stream
    if (current != null) {
        NativeCell(current.url, index, controller, headers = current.headers, note = note)
    } else {
        Box(modifier = Modifier.fillMaxSize()) {
            Text(
                "$index  $status",
                color = androidx.compose.ui.graphics.Color.White,
                fontSize = 11.sp,
                lineHeight = 13.sp,
                modifier = Modifier.verticalScroll(rememberScrollState()),
            )
        }
    }
}

/** Python、yt-dlp 的版本、JS 執行環境、Python 啟動時間（R148 AC2）。 */
@Composable
fun YtDlpInfoDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("讀取中…") }
    LaunchedEffect(Unit) {
        text = try {
            YtDlp.versions(context)
        } catch (error: Exception) {
            "Python 啟動失敗：$error"
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("yt-dlp 資訊") },
        text = {
            Text(
                text,
                fontSize = 12.sp,
                modifier = Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()),
            )
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("關閉") } },
    )
}
