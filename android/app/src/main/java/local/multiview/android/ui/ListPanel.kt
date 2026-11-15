package local.multiview.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.AppModel
import local.multiview.core.ListGroup
import local.multiview.core.ListItem
import local.multiview.core.ListKind
import local.multiview.core.ListRules
import local.multiview.core.ListTab

/** 清單中的一筆，連同它在整份清單裡的位置（編輯、刪除時用）。 */
private class ListRow(val index: Int, val item: ListItem)

/**
 * 清單面板：最愛與歷史，分成 YouTube 和其他網站兩邊（桌面版 R21–R23、R58；Android 版 R158）。對照 iOS 版的 ListPanel.swift。
 * 點一筆放進空格；每一筆右邊的「⋯」可以編輯、刪除。訂閱分頁在之後的版本加入。
 */
@Composable
fun ListPanel(model: AppModel, insets: PaddingValues, modifier: Modifier = Modifier) {
    val group = model.listTab.group
    // 訂閱只在 YouTube 那一邊（R59）
    val tab = if (model.listTab.tab == ListTab.Tab.SUBSCRIPTIONS && group != ListGroup.YOUTUBE) ListTab.Tab.FAVORITES else model.listTab.tab
    val kind = if (tab == ListTab.Tab.HISTORY) ListKind.HISTORY else ListKind.FAVORITES
    val items = if (kind == ListKind.FAVORITES) model.lists.favorites else model.lists.history
    val rows = items.mapIndexed(::ListRow).filter { ListRules.groupOf(it.item.url) == group }
    var editing by remember { mutableStateOf<ListRow?>(null) }
    var confirmsClear by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .background(Color(0xF216161A))
            // 面板上的點擊不要傳到下面的影片
            .pointerInput(Unit) { detectTapGestures { } }
            .padding(insets),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("清單", color = Color.White, fontSize = 17.sp)
                Spacer(modifier = Modifier.weight(1f))
                if (tab == ListTab.Tab.HISTORY && rows.isNotEmpty()) {
                    TextButton(onClick = { confirmsClear = true }) { Text("清除") }
                }
                BarButton(AppIcons.Close, "關閉清單") { model.listPanelOpen = false }
            }
            Segmented(
                options = listOf(ListGroup.YOUTUBE to "YouTube", ListGroup.OTHER to "其他網站"),
                selected = group,
            ) { model.changeListTab(ListTab(it, if (it == ListGroup.YOUTUBE || tab != ListTab.Tab.SUBSCRIPTIONS) tab else ListTab.Tab.FAVORITES)) }
            Segmented(
                options = listOfNotNull(
                    (ListTab.Tab.SUBSCRIPTIONS to "訂閱").takeIf { group == ListGroup.YOUTUBE },
                    ListTab.Tab.FAVORITES to "最愛",
                    ListTab.Tab.HISTORY to "歷史",
                ),
                selected = tab,
            ) { model.changeListTab(ListTab(group, it)) }
        }

        if (tab == ListTab.Tab.SUBSCRIPTIONS) {
            SubscriptionList(model)
        } else if (rows.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                Text(
                    if (kind == ListKind.FAVORITES) "還沒有最愛。\n播放影片時按操作列的星號加入。" else "還沒有歷史紀錄。",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(rows, key = { it.item.url }) { row ->
                    ListRowView(
                        row = row,
                        showsTime = kind == ListKind.HISTORY,
                        onOpen = { model.openFromList(row.item.url) },
                        onEdit = { editing = row },
                        onDelete = { model.deleteListItem(kind, row.index) },
                    )
                }
            }
        }
    }

    editing?.let { row ->
        EditListItemDialog(row.item, onDismiss = { editing = null }) { url, name ->
            model.editListItem(kind, row.index, url, name)
        }
    }

    if (confirmsClear) {
        AlertDialog(
            onDismissRequest = { confirmsClear = false },
            title = { Text("清除這一邊的歷史紀錄？") },
            confirmButton = {
                TextButton(onClick = {
                    confirmsClear = false
                    model.clearHistory(group)
                }) { Text("清除", color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { confirmsClear = false }) { Text("取消") } },
        )
    }
}

/** 兩個或三個選項的切換鈕。 */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(36.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = 0.1f)),
    ) {
        for ((value, label) in options) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .padding(2.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (value == selected) Accent else Color.Transparent)
                    .clickable { onSelect(value) },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = Color.White, fontSize = 14.sp)
            }
        }
    }
}

@Composable
private fun ListRowView(row: ListRow, showsTime: Boolean, onOpen: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.item.name, color = Color.White, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(row.item.url, color = Color.White.copy(alpha = 0.55f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (showsTime) {
                Text(ListRules.formatTime(row.item.time), color = Color.White.copy(alpha = 0.4f), fontSize = 11.sp)
            }
        }
        Box {
            BarButton(AppIcons.More, "編輯或刪除") { menuOpen = true }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(text = { Text("編輯") }, onClick = {
                    menuOpen = false
                    onEdit()
                })
                DropdownMenuItem(text = { Text("刪除", color = Color(0xFFFF6B6B)) }, onClick = {
                    menuOpen = false
                    onDelete()
                })
            }
        }
    }
}

/** 編輯清單的一筆：名稱和網址（R21）。 */
@Composable
private fun EditListItemDialog(item: ListItem, onDismiss: () -> Unit, onSave: (url: String, name: String) -> String?) {
    var name by remember { mutableStateOf(item.name) }
    var url by remember { mutableStateOf(item.url) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("編輯") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("名稱") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    url,
                    {
                        url = it
                        error = null
                    },
                    label = { Text("網址") },
                    singleLine = true,
                    isError = error != null,
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Text(it, color = Color(0xFFFF6B6B), fontSize = 13.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val message = onSave(url, name)
                if (message == null) onDismiss() else error = message
            }) { Text("儲存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
