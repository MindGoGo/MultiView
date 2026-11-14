package local.multiview.android.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.AppModel

/** 強調色（和 App 圖示的藍色格子相同）。 */
val Accent = Color(0xFF3D8BFD)

/** 操作列、工具列的半透明底色。 */
val BarBackground = Color(0xCC16161A)

/** 剪貼簿裡的文字；沒有文字時回傳 null。 */
fun clipboardText(context: Context): String? {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    val clip = manager.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(context)?.toString()?.trim()?.ifEmpty { null }
}

/** 操作列與工具列的圖示按鈕，最小 44dp（R151）。 */
@Composable
fun BarButton(
    icon: ImageVector,
    label: String,
    highlighted: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = if (highlighted) Accent else Color.White, modifier = Modifier.size(22.dp))
    }
}

/** 彈出視窗（滑桿、選單、對話框）開著的期間，操作列與工具列不自動隱藏。 */
@Composable
fun HoldControls(model: AppModel) {
    DisposableEffect(Unit) {
        model.holdControls(true)
        onDispose { model.holdControls(false) }
    }
}

/** 按鈕下方彈出的滑桿（音量、亮度）。放在按鈕的 Box 裡。 */
@Composable
fun SliderPopup(
    model: AppModel,
    title: String,
    value: Int,
    range: IntRange,
    step: Int,
    resetValue: Int?,
    onDismiss: () -> Unit,
    onChange: (Int) -> Unit,
) {
    DropdownMenu(expanded = true, onDismissRequest = onDismiss) {
        HoldControls(model)
        Column(modifier = Modifier.width(240.dp).padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text("$title $value%", color = Color.White, fontSize = 14.sp)
            Slider(
                value = value.toFloat(),
                onValueChange = { raw ->
                    val stepped = (Math.round(raw / step) * step).coerceIn(range.first, range.last)
                    if (stepped != value) onChange(stepped)
                },
                valueRange = range.first.toFloat()..range.last.toFloat(),
            )
            if (resetValue != null) {
                TextButton(onClick = { onChange(resetValue) }, enabled = value != resetValue) { Text("重設") }
            }
        }
    }
}

/** 輸入或更換網址的小視窗（R150）：有清除、貼上。送出失敗時顯示訊息並留在視窗裡。 */
@Composable
fun UrlDialog(
    title: String,
    initial: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    /** 成功回傳 null，失敗回傳要顯示的訊息。 */
    onSubmit: (String) -> String?,
) {
    val context = LocalContext.current
    var text by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit(value: String) {
        if (value.isBlank()) return
        val message = onSubmit(value)
        if (message == null) onDismiss() else error = message
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = {
                        text = it
                        error = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("https://…") },
                    trailingIcon = {
                        if (text.isNotEmpty()) {
                            Icon(
                                AppIcons.Close,
                                contentDescription = "清除",
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(18.dp))
                                    .clickable { text = "" }
                                    .padding(8.dp),
                            )
                        }
                    },
                    isError = error != null,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        clipboardText(context)?.let {
                            text = it
                            submit(it)
                        } ?: run { error = "剪貼簿裡沒有文字" }
                    }) {
                        Icon(AppIcons.Paste, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(" 貼上")
                    }
                    error?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp)) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { submit(text) }, enabled = text.isNotBlank()) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/** 黑底圓角的小標籤（狀態文字、提示）。 */
@Composable
fun Pill(text: String, modifier: Modifier = Modifier, fontSize: Int = 12) {
    Text(
        text,
        color = Color.White,
        fontSize = fontSize.sp,
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}
