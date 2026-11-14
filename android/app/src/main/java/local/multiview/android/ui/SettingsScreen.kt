package local.multiview.android.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import local.multiview.android.AppModel
import local.multiview.android.BuildConfig
import local.multiview.android.player.AdBlocker
import local.multiview.core.AppInfo
import local.multiview.core.ListsCodec
import local.multiview.core.PlayMethod
import local.multiview.core.Settings
import local.multiview.core.SettingsCodec

/**
 * 設定畫面（桌面版 R96；Android 版 R158）：播放方式、yt-dlp 版本、匯入桌面版資料、清除網站資料、版本號。
 * 對照 iOS 版的 SettingsView.swift。
 */
@Composable
fun SettingsScreen(model: AppModel) {
    val context = LocalContext.current
    // 選了桌面版的設定檔：等使用者確認要不要取代目前的格子
    var pendingSettings by remember { mutableStateOf<Settings?>(null) }
    var importMessage by remember { mutableStateOf<String?>(null) }
    var confirmsClearData by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { model.refreshYtDlpVersion() }

    // 讀取選到的檔案：是設定檔就等使用者確認，是清單檔就直接合併；其中一個錯誤不影響另一個
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val messages = mutableListOf<String>()
        for (uri in uris) {
            val text = readText(context, uri)
            val settings = text?.let(SettingsCodec::parse)
            when {
                text == null -> messages += "無法讀取這個檔案"
                settings != null && !settings.corrupt -> pendingSettings = settings.settings
                ListsCodec.looksLikeLists(text) -> messages += model.importLists(ListsCodec.parse(text).lists).message
                else -> messages += "這個檔案不是 MultiView 的設定檔或清單檔"
            }
        }
        if (messages.isNotEmpty()) importMessage = messages.joinToString("\n")
    }

    Dialog(onDismissRequest = { model.settingsOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier.fillMaxSize().background(Color(0xFF16161A)).safeDrawingPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("設定", color = Color.White, fontSize = 18.sp)
                Spacer(modifier = Modifier.weight(1f))
                TextButton(onClick = { model.settingsOpen = false }) { Text("完成") }
            }
            Column(
                modifier = Modifier.widthIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Section("YouTube 的播放方式")
                Label("直播")
                Segmented(methodOptions, model.youtubeMethods.live) { model.changeYouTubeMethods(model.youtubeMethods.copy(live = it)) }
                Label("一般影片")
                Segmented(methodOptions, model.youtubeMethods.vod) { model.changeYouTubeMethods(model.youtubeMethods.copy(vod = it)) }
                Note("yt-dlp：沒有 YouTube 的按鈕與廣告，可以多格同時出聲。播不了時自動改用內嵌播放器。")

                Section("yt-dlp")
                Label("版本：${model.ytdlpVersion ?: "讀取中…"}")
                model.ytdlpPendingVersion?.let { Note("已下載 $it，重新開啟 App 後使用") }
                TextButton(onClick = { model.checkYtDlpUpdate() }, enabled = !model.ytdlpUpdating) {
                    Text(if (model.ytdlpUpdating) "正在檢查更新…" else "檢查更新")
                }
                Note("每 24 小時自動檢查一次；下載後用官方的雜湊值驗證，下次開啟 App 生效。")

                Section("廣告阻擋")
                Label("規則：${AdBlocker.status}")
                Note("網頁格子的廣告阻擋用 EasyList，在操作列的盾牌按鈕各自開關。")

                Section("從其他 App 分享網址")
                Note("在 YouTube App、Chrome 等 App 按「分享」，選 MultiView，網址會放進第一個空格；沒有空格時會問要取代哪一格。")

                Section("資料")
                TextButton(onClick = { picker.launch(arrayOf("application/json", "text/*", "application/octet-stream")) }) {
                    Text("匯入桌面版資料…")
                }
                Note("選擇桌面版的 settings.json、lists.json（在 Windows 的 %APPDATA%\\MultiView 資料夾）。設定會取代目前的格子，清單會合併。")
                TextButton(onClick = { confirmsClearData = true }) { Text("清除網站資料", color = Color(0xFFFF6B6B)) }

                Note(AppInfo.versionLabel(BuildConfig.VERSION_NAME, model.ytdlpVersion))
            }
        }
    }

    pendingSettings?.let { settings ->
        AlertDialog(
            onDismissRequest = { pendingSettings = null },
            title = { Text("匯入設定會取代目前的格子") },
            confirmButton = {
                TextButton(onClick = {
                    pendingSettings = null
                    model.importSettings(settings)
                    importMessage = listOfNotNull(importMessage, "已匯入設定").joinToString("\n")
                }) { Text("取代目前的格子", color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { pendingSettings = null }) { Text("取消") } },
        )
    }

    val message = importMessage
    if (message != null && pendingSettings == null) {
        AlertDialog(
            onDismissRequest = { importMessage = null },
            title = { Text("匯入結果") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { importMessage = null }) { Text("好") } },
        )
    }

    if (confirmsClearData) {
        AlertDialog(
            onDismissRequest = { confirmsClearData = false },
            title = { Text("清除網站資料？登入狀態會消失。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmsClearData = false
                    model.clearWebsiteData()
                }) { Text("清除", color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { confirmsClearData = false }) { Text("取消") } },
        )
    }
}

private val methodOptions = listOf(PlayMethod.YTDLP to "yt-dlp", PlayMethod.EMBED to "內嵌播放器")

/** 讀取使用者選的檔案（UTF-8）；讀不到、太大時回傳 null。 */
private fun readText(context: Context, uri: Uri): String? = try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
        val bytes = stream.readBytes()
        if (bytes.size > 20 * 1024 * 1024) null else String(bytes, Charsets.UTF_8)
    }
} catch (_: Exception) {
    null
}

@Composable
private fun Section(title: String) {
    Text(title, color = Accent, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp))
}

@Composable
private fun Label(text: String) {
    Text(text, color = Color.White, fontSize = 15.sp)
}

@Composable
private fun Note(text: String) {
    Text(text, color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp)
}
