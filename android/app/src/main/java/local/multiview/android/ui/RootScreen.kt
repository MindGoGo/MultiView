package local.multiview.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsIgnoringVisibility
import androidx.compose.foundation.layout.union
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import local.multiview.android.AppModel

/** 主畫面：只有格子；工具列和提示蓋在上面（R149、R151）。對照 iOS 版的 RootView.swift。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RootScreen(model: AppModel) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Accent)) {
        // 格子畫到螢幕邊緣（滿版）；操作列等自己避開瀏海和導覽列。
        // 要避開的範圍在根畫面量再傳給格子。狀態列、導覽列隱藏時也照它們顯示時的大小避開，
        // 下方的按鈕才不會落在系統手勢的範圍裡（iOS 0.0.16 的問題）
        val padding = WindowInsets.displayCutout.union(WindowInsets.systemBarsIgnoringVisibility).asPaddingValues()
        val safeArea = EdgeInsets(
            left = padding.calculateStartPadding(LayoutDirection.Ltr),
            top = padding.calculateTopPadding(),
            right = padding.calculateEndPadding(LayoutDirection.Ltr),
            bottom = padding.calculateBottomPadding(),
        )

        Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            GridView(model, safeArea)

            AnimatedVisibility(
                visible = model.toolbarVisible,
                modifier = Modifier.align(Alignment.TopCenter),
                enter = slideInVertically { -it } + fadeIn(),
                exit = slideOutVertically { -it } + fadeOut(),
            ) {
                Toolbar(model, PaddingValues(start = safeArea.left, top = safeArea.top, end = safeArea.right))
            }

            // 清單面板：大螢幕在右側（寬 360dp，蓋在影片上方），小螢幕占滿寬度（R158）
            AnimatedVisibility(
                visible = model.listPanelOpen || model.companionOpen,
                modifier = Modifier.align(Alignment.CenterEnd),
                enter = slideInHorizontally { it } + fadeIn(),
                exit = slideOutHorizontally { it } + fadeOut(),
            ) {
                // 工具列顯示時從工具列下面開始
                val top = safeArea.top + if (model.toolbarVisible) 52.dp else 0.dp
                val panelInsets = PaddingValues(end = safeArea.right, bottom = safeArea.bottom)
                val panelModifier = Modifier.padding(top = top).then(if (model.isLarge) Modifier.width(360.dp) else Modifier.fillMaxWidth())
                if (model.companionOpen) {
                    CompanionPanel(model, panelInsets, panelModifier)
                } else {
                    ListPanel(model, panelInsets, panelModifier)
                }
            }

            AnimatedVisibility(
                visible = model.toast != null,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = safeArea.top + if (model.toolbarVisible) 64.dp else 12.dp),
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Pill(model.toast.orEmpty(), fontSize = 14)
            }
        }

        // 沒有空格時選擇要取代的格子（R150）
        model.pendingReplaceUrl?.let { url ->
            AlertDialog(
                onDismissRequest = { model.pendingReplaceUrl = null },
                title = { Text("沒有空格，要取代哪一格？") },
                text = {
                    Column {
                        for (index in model.visibleSlotIndices) {
                            TextButton(onClick = {
                                model.pendingReplaceUrl = null
                                model.replaceSlot(index, url)
                            }) { Text("第 ${index + 1} 格") }
                        }
                    }
                },
                confirmButton = {},
                dismissButton = { TextButton(onClick = { model.pendingReplaceUrl = null }) { Text("取消") } },
            )
        }

        if (model.settingsOpen) SettingsScreen(model)

        // 清單、設定開著時，工具列不自動隱藏
        if (model.listPanelOpen || model.companionOpen || model.settingsOpen) HoldControls(model)

        KeepScreenOn(model)
    }
}

/** 播放中不自動關螢幕（R149）。 */
@Composable
private fun KeepScreenOn(model: AppModel) {
    val view = LocalView.current
    val playing = model.anyPlaying
    SideEffect { view.keepScreenOn = playing }
}
