package local.multiview.android.lab

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.BuildConfig
import local.multiview.core.AppInfo

/** 測試的種類：原生播放器（R146）或 YouTube 內嵌播放器（R147）。 */
enum class LabMode(val label: String, val prefKey: String, val defaults: List<String>) {
    NATIVE(
        "原生播放器",
        "native_urls",
        listOf(
            "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
            "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
            "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
        ),
    ),
    YOUTUBE(
        "YouTube 內嵌",
        "youtube_urls",
        listOf(
            "https://www.youtube.com/watch?v=jfKfPfyJRdk",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=9bZkp7q19f0",
            "https://www.youtube.com/watch?v=OPf0YbXqDm0",
        ),
    ),
}

private const val PREFS = "lab"

private fun loadUrls(context: Context, mode: LabMode): List<String> {
    val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(mode.prefKey, null)
    val lines = saved?.lines()?.map(String::trim)?.filter(String::isNotEmpty).orEmpty()
    return lines.ifEmpty { mode.defaults }
}

private fun saveUrls(context: Context, mode: LabMode, urls: List<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(mode.prefKey, urls.joinToString("\n"))
        .apply()
}

@Composable
fun LabScreen(controller: LabController) {
    MaterialTheme(colorScheme = darkColorScheme()) {
        val context = LocalContext.current
        var mode by remember { mutableStateOf(LabMode.NATIVE) }
        var columns by remember { mutableIntStateOf(2) }
        var urls by remember(mode) { mutableStateOf(loadUrls(context, mode)) }
        // 重新載入時換一個值，讓所有格子重建播放器
        var generation by remember { mutableIntStateOf(0) }
        var editing by remember { mutableStateOf(false) }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .safeDrawingPadding(),
        ) {
            Toolbar(
                mode = mode,
                columns = columns,
                onMode = { mode = it },
                onColumns = { columns = it },
                onEdit = { editing = true },
                onReload = { generation++ },
                onPlayAll = controller::playAll,
                onPauseAll = controller::pauseAll,
            )
            LabGrid(
                modifier = Modifier.weight(1f),
                mode = mode,
                columns = columns,
                urls = urls,
                generation = generation,
                controller = controller,
            )
        }

        if (editing) {
            UrlDialog(
                mode = mode,
                urls = urls,
                onDismiss = { editing = false },
                onSave = { lines ->
                    val cleaned = lines.ifEmpty { mode.defaults }
                    saveUrls(context, mode, cleaned)
                    urls = cleaned
                    generation++
                    editing = false
                },
            )
        }
    }
}

@Composable
private fun Toolbar(
    mode: LabMode,
    columns: Int,
    onMode: (LabMode) -> Unit,
    onColumns: (Int) -> Unit,
    onEdit: () -> Unit,
    onReload: () -> Unit,
    onPlayAll: () -> Unit,
    onPauseAll: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            AppInfo.versionLabel(BuildConfig.VERSION_NAME),
            color = Color.White.copy(alpha = 0.6f),
            fontSize = 12.sp,
        )
        LabMode.entries.forEach { ToolButton(it.label, selected = it == mode) { onMode(it) } }
        ToolButton("2×2", selected = columns == 2) { onColumns(2) }
        ToolButton("3×3", selected = columns == 3) { onColumns(3) }
        ToolButton("全部播放", onClick = onPlayAll)
        ToolButton("全部暫停", onClick = onPauseAll)
        ToolButton("重新載入", onClick = onReload)
        ToolButton("網址", onClick = onEdit)
    }
}

@Composable
private fun ToolButton(label: String, selected: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
        modifier = Modifier.heightIn(min = 32.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) Color(0xFF3D8BFD) else Color(0xFF2A2A30),
            contentColor = Color.White,
        ),
    ) {
        Text(label, fontSize = 13.sp)
    }
}

@Composable
private fun LabGrid(
    modifier: Modifier,
    mode: LabMode,
    columns: Int,
    urls: List<String>,
    generation: Int,
    controller: LabController,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (row in 0 until columns) {
            Row(modifier = Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (column in 0 until columns) {
                    val index = row * columns + column
                    val url = urls[index % urls.size]
                    Box(modifier = Modifier.weight(1f).fillMaxSize()) {
                        // 模式、網址、重新載入改變時重建這一格的播放器
                        key(mode, url, generation, index) {
                            when (mode) {
                                LabMode.NATIVE -> NativeCell(url, index + 1, controller)
                                LabMode.YOUTUBE -> YouTubeCell(url, index + 1, controller)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UrlDialog(
    mode: LabMode,
    urls: List<String>,
    onDismiss: () -> Unit,
    onSave: (List<String>) -> Unit,
) {
    var text by remember { mutableStateOf(urls.joinToString("\n")) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${mode.label}的網址") },
        text = {
            Column {
                Text(
                    "一行一個，依序放進格子；格子比網址多時從頭重複。" +
                        if (mode == LabMode.YOUTUBE) "可以貼 YouTube 網址或影片代碼。" else "可以貼 m3u8 或 mp4 網址。",
                    fontSize = 13.sp,
                )
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 160.dp),
                    textStyle = MaterialTheme.typography.bodySmall,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(text.lines().map(String::trim).filter(String::isNotEmpty)) }) { Text("儲存") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { text = mode.defaults.joinToString("\n") }) { Text("預設值") }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}
