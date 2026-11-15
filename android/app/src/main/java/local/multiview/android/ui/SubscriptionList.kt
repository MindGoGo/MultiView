package local.multiview.android.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import local.multiview.android.AppModel
import local.multiview.android.SubscriptionStore
import local.multiview.core.Channel
import local.multiview.core.SourceParser
import local.multiview.core.YouTubeFeed

/**
 * 訂閱分頁（桌面版 R59–R61；Android 版 R158）：訂閱的頻道、最新影片、正在直播的標示、從 Google Takeout 匯入。
 * 對照 iOS 版的 SubscriptionList.swift。
 */
@Composable
fun SubscriptionList(model: AppModel) {
    val context = LocalContext.current
    val store = model.subscriptions
    val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(setOf<String>()) }
    var adding by remember { mutableStateOf(false) }
    var addBusy by remember { mutableStateOf(false) }

    // 正在直播的排在最上面，其他依名稱排序（R60）
    val channels = model.lists.channels.sortedWith(
        compareByDescending<Channel> { store.feeds[it.id]?.live != null }.thenBy { it.name.lowercase() },
    )
    val ids = model.lists.channels.map { it.id }

    // 開啟訂閱分頁時讀取，之後每 15 分鐘自動更新一次（面板開著時，R59）
    LaunchedEffect(ids) {
        while (true) {
            store.load(ids, force = false)
            delay(YouTubeFeed.REFRESH_INTERVAL.toLong())
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val text = readTextFile(context, uri)
            model.showToast(if (text == null) "無法讀取這個檔案" else model.importTakeout(text))
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { adding = true }) { Text("＋ 加入頻道") }
            TextButton(onClick = { picker.launch(arrayOf("text/*", "application/octet-stream", "*/*")) }) { Text("匯入…") }
            Spacer(modifier = Modifier.weight(1f))
            if (store.anyLoading || addBusy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            TextButton(onClick = { store.load(ids, force = true) }) { Text("重新整理") }
        }

        if (channels.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                Text(
                    "還沒有訂閱的頻道。\n\n按「加入頻道」貼上頻道或影片的網址；或到 Google Takeout（takeout.google.com）只勾選" +
                        "「YouTube 和 YouTube Music」裡的「訂閱內容」匯出，把壓縮檔裡的 subscriptions.csv 存到手機後按「匯入…」。",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 13.sp,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(channels, key = { it.id }) { channel ->
                    ChannelRow(
                        model = model,
                        channel = channel,
                        feed = store.feeds[channel.id],
                        open = channel.id in expanded,
                        onToggle = {
                            if (channel.id in expanded) {
                                expanded = expanded - channel.id
                            } else {
                                expanded = expanded + channel.id
                                store.prioritize(channel.id)
                            }
                        },
                    )
                }
            }
        }
    }

    if (adding) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("加入頻道") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("貼上頻道網址（例如 youtube.com/@帳號）或影片網址。", fontSize = 13.sp)
                    OutlinedTextField(text, { text = it }, singleLine = true, placeholder = { Text("https://…") }, modifier = Modifier.fillMaxWidth())
                    TextButton(onClick = { clipboardText(context)?.let { text = it } }) { Text("貼上") }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = text.isNotBlank(),
                    onClick = {
                        val input = text
                        adding = false
                        addBusy = true
                        scope.launch {
                            val message = model.addChannel(input)
                            addBusy = false
                            model.showToast(message ?: "已加入頻道")
                        }
                    },
                ) { Text("加入") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun ChannelRow(model: AppModel, channel: Channel, feed: SubscriptionStore.Feed?, open: Boolean, onToggle: () -> Unit) {
    val videos = feed?.videos.orEmpty()
    val now = System.currentTimeMillis().toDouble()
    val fresh = YouTubeFeed.countNew(videos, now)
    var menuOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (open) "▾" else "▸", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
            Text(
                channel.name,
                color = Color.White,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false).padding(horizontal = 6.dp),
            )
            if (fresh > 0) {
                // 24 小時內發布的新影片數量
                Text(
                    "$fresh",
                    color = Color.White,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.background(Accent.copy(alpha = 0.35f), RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            feed?.live?.let { live ->
                // 正在直播：按下播放那場直播（R60）
                TextButton(onClick = { model.openFromList(SourceParser.watchPageUrl(live)) }) {
                    Text("● 直播中", color = Color(0xFFFF5252), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Box {
                BarButton(AppIcons.More, "移除頻道") { menuOpen = true }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("移除", color = Color(0xFFFF6B6B)) }, onClick = {
                        menuOpen = false
                        model.removeChannel(channel.id)
                    })
                }
            }
        }

        if (open) {
            if (videos.isEmpty()) {
                val text = when {
                    feed == null || feed.loading || feed.videosLoading -> "讀取中…"
                    // 失敗時帶上原因，方便回報問題
                    feed.failed -> "無法取得最新影片" + (feed.failure?.let { "（$it）" } ?: "")
                    else -> "沒有影片"
                }
                Text(text, color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp, modifier = Modifier.padding(start = 30.dp, bottom = 8.dp))
            }
            for (video in videos.take(15)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { model.openFromList(SourceParser.watchPageUrl(video.videoId)) }
                        .padding(start = 30.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
                ) {
                    Text(video.title, color = Color.White, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val ago = YouTubeFeed.formatAgo(video.published, now)
                    if (ago.isNotEmpty()) Text(ago, color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
                }
            }
        }
    }
}

/** 讀取使用者選的檔案（UTF-8）；讀不到、太大時回傳 null。 */
internal fun readTextFile(context: Context, uri: Uri): String? = try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
        val bytes = stream.readBytes()
        if (bytes.size > 20 * 1024 * 1024) null else String(bytes, Charsets.UTF_8)
    }
} catch (_: Exception) {
    null
}
