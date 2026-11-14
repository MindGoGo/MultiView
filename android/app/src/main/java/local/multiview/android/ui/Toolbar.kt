package local.multiview.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.AppModel
import local.multiview.android.BuildConfig
import local.multiview.core.AppInfo
import local.multiview.core.Brightness
import local.multiview.core.PlaybackRules

/** 畫面上方的工具列（R151）：版型、全部播放／暫停、全部靜音、總亮度、旋轉。畫面太窄時可以左右捲動。 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Toolbar(model: AppModel, insets: PaddingValues) {
    var showsBrightness by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxWidth().background(BarBackground).padding(insets)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 10.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 版型：小螢幕只有 1、2
            for (layout in model.availableLayouts) {
                val selected = model.displayedLayout == layout
                Box(
                    modifier = Modifier
                        .defaultMinSize(minWidth = 44.dp, minHeight = 36.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) Accent.copy(alpha = 0.35f) else Color.Transparent)
                        .clickable(onClickLabel = "版型 ${layout.label}") { model.selectLayout(layout) },
                    contentAlignment = Alignment.Center,
                ) {
                    LayoutIcon(layout, model.gridStacked, if (selected) Color.White else Color.White.copy(alpha = 0.55f))
                }
            }

            Spacer(modifier = Modifier.width(8.dp))

            val pauseAll = model.toggleAllAction == PlaybackRules.ToggleAction.PAUSE
            BarButton(if (pauseAll) AppIcons.Pause else AppIcons.Play, if (pauseAll) "全部暫停" else "全部播放") { model.toggleAll() }
            BarButton(AppIcons.VolumeOff, "全部靜音") { model.muteAll() }
            Box {
                BarButton(AppIcons.Brightness, "總亮度", highlighted = model.masterBrightness != Brightness.DEFAULT) {
                    showsBrightness = true
                }
                if (showsBrightness) {
                    SliderPopup(
                        model = model,
                        title = "總亮度",
                        value = model.masterBrightness,
                        range = Brightness.MIN..Brightness.MAX,
                        step = Brightness.STEP,
                        resetValue = Brightness.DEFAULT,
                        onDismiss = { showsBrightness = false },
                        onChange = model::changeMasterBrightness,
                    )
                }
            }

            // 旋轉：關了自動旋轉也能切換橫向、直向；長按回到跟著裝置旋轉（R149）
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .combinedClickable(
                        onClickLabel = "旋轉畫面",
                        onLongClickLabel = "跟著裝置旋轉",
                        onLongClick = {
                            model.unlockOrientation()
                            model.showToast("跟著裝置旋轉")
                        },
                        onClick = { model.rotate() },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    AppIcons.Rotate,
                    contentDescription = "旋轉畫面",
                    tint = if (model.orientationLocked) Accent else Color.White,
                    modifier = Modifier.size(22.dp),
                )
            }

            BarButton(AppIcons.ExpandLess, "隱藏工具列") { model.hideControls() }

            Text(
                AppInfo.versionLabel(BuildConfig.VERSION_NAME),
                color = Color.White.copy(alpha = 0.35f),
                fontSize = 9.sp,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
    }
}
