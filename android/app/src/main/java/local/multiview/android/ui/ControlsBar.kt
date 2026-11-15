package local.multiview.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import local.multiview.android.AppModel
import local.multiview.android.player.CellPlayer
import local.multiview.android.player.WebMode
import local.multiview.core.Brightness
import local.multiview.core.CellSource
import local.multiview.core.PlaybackProgress
import local.multiview.core.ProgressKind
import local.multiview.core.ProgressRules
import local.multiview.core.Volume

/** 操作列的彈出視窗：一次只開一個。 */
private enum class Popup { NONE, VOLUME, BRIGHTNESS, QUALITY, AUDIO, CAPTIONS, MORE, EDIT }

/**
 * 每一格下方的操作列（R151）：播放／暫停、喇叭、音量、亮度、畫質、移動、全螢幕、最愛、更換網址、移除，
 * 以及進度條（R153）。格子太窄放不下時，次要的按鈕收進「⋯」選單。
 */
@Composable
fun ControlsBar(model: AppModel, index: Int, source: CellSource, player: CellPlayer?, insets: PaddingValues) {
    var popup by remember { mutableStateOf(Popup.NONE) }
    val supportsVolume = player?.supportsVolume ?: false
    val supportsQuality = model.supportsQuality(source)
    val audioOptions = player?.audioOptions ?: emptyList()
    val captionTracks = player?.captionTracks ?: emptyList()
    val favorite = model.isFavorite(source)
    val supportsPip = model.supportsPictureInPicture(source)
    val webMode = model.webModeOf(source)
    val isSolo = model.solo == index
    val showsPause = model.statusOf(source).showsPause

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(BarBackground)
            .keepsControlsVisible(model)
            // 操作列上的點擊不要傳到下面的影片
            .pointerInput(Unit) { detectTapGestures { model.keepControlsVisible() } }
            .padding(insets)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        val progress = model.progress[source.id]
        if (progress != null && ProgressRules.view(progress).kind != ProgressKind.LIVE) {
            ProgressBar(progress, source) { model.seek(index, it) }
        }

        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            // 全部按鈕需要的寬度（每個 44dp）
            val wideCount = 7 + listOf(supportsVolume, supportsQuality, audioOptions.size > 1, captionTracks.isNotEmpty(), model.canSwap, supportsPip).count { it } +
                if (webMode != null) 2 else 0
            val wide = maxWidth >= (44 * wideCount + 8).dp

            Row(verticalAlignment = Alignment.CenterVertically) {
                BarButton(if (showsPause) AppIcons.Pause else AppIcons.Play, if (showsPause) "暫停" else "播放") {
                    model.togglePlay(index)
                }
                BarButton(
                    if (source.muted) AppIcons.VolumeOff else AppIcons.VolumeUp,
                    if (source.muted) "取消靜音" else "靜音",
                    highlighted = !source.muted,
                ) { model.toggleMute(index) }

                if (wide) {
                    if (supportsVolume) {
                        Box {
                            BarButton(AppIcons.Tune, "音量") { popup = Popup.VOLUME }
                            if (popup == Popup.VOLUME) VolumePopup(model, index, source) { popup = Popup.NONE }
                        }
                    }
                    Box {
                        BarButton(AppIcons.Brightness, "亮度", highlighted = source.brightness != Brightness.DEFAULT) {
                            popup = Popup.BRIGHTNESS
                        }
                        if (popup == Popup.BRIGHTNESS) BrightnessPopup(model, index, source) { popup = Popup.NONE }
                    }
                    if (supportsQuality) {
                        Box {
                            BarButton(AppIcons.Quality, "畫質") { popup = Popup.QUALITY }
                            if (popup == Popup.QUALITY) QualityMenu(model, index, source) { popup = Popup.NONE }
                        }
                    }
                    if (captionTracks.isNotEmpty()) {
                        Box {
                            BarButton(AppIcons.Captions, "字幕", highlighted = player?.currentCaption != null) { popup = Popup.CAPTIONS }
                            if (popup == Popup.CAPTIONS) CaptionMenu(model, index, player) { popup = Popup.NONE }
                        }
                    }
                    if (wide && audioOptions.size > 1) {
                        Box {
                            BarButton(AppIcons.Voice, "語音") { popup = Popup.AUDIO }
                            if (popup == Popup.AUDIO) AudioMenu(model, index, player) { popup = Popup.NONE }
                        }
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                if (model.canSwap) MoveHandle(model, index)
                BarButton(
                    if (isSolo) AppIcons.FullscreenExit else AppIcons.Fullscreen,
                    if (isSolo) "離開全螢幕" else "全螢幕",
                    highlighted = isSolo,
                ) { model.toggleSolo(index) }

                if (wide) {
                    if (supportsPip) BarButton(AppIcons.PictureInPicture, "子母畫面") { model.startPictureInPicture(index) }
                    if (webMode != null) {
                        WebModeButton(model, index, webMode)
                        BarButton(
                            AppIcons.Shield,
                            if (source.adblock) "廣告阻擋：開" else "廣告阻擋：關",
                            highlighted = source.adblock,
                        ) { model.toggleAdblock(index) }
                    }
                    BarButton(
                        if (favorite) AppIcons.Star else AppIcons.StarBorder,
                        if (favorite) "從最愛移除" else "加入最愛",
                        highlighted = favorite,
                    ) { model.toggleFavorite(index) }
                    BarButton(AppIcons.Link, "更換網址") { popup = Popup.EDIT }
                    BarButton(AppIcons.Close, "移除") { model.removeSource(index) }
                } else {
                    // 「⋯」：放不下的按鈕。用系統的彈出選單；選單開著時操作列不自動收起
                    Box {
                        BarButton(AppIcons.More, "更多") { popup = Popup.MORE }
                        when (popup) {
                            Popup.MORE -> DropdownMenu(expanded = true, onDismissRequest = { popup = Popup.NONE }) {
                                HoldControls(model)
                                if (supportsVolume) MenuRow(AppIcons.Tune, "音量") { popup = Popup.VOLUME }
                                MenuRow(AppIcons.Brightness, "亮度") { popup = Popup.BRIGHTNESS }
                                if (supportsQuality) MenuRow(AppIcons.Quality, "畫質：${source.quality.label}") { popup = Popup.QUALITY }
                                if (captionTracks.isNotEmpty()) {
                                    val current = captionTracks.firstOrNull { it.key == player?.currentCaption }?.label ?: "關閉"
                                    MenuRow(AppIcons.Captions, "字幕：$current") { popup = Popup.CAPTIONS }
                                }
                                if (audioOptions.size > 1) {
                                    val current = audioOptions.firstOrNull { it.index == player?.currentAudio }?.label ?: "自動"
                                    MenuRow(AppIcons.Voice, "語音：$current") { popup = Popup.AUDIO }
                                }
                                if (supportsPip) {
                                    MenuRow(AppIcons.PictureInPicture, "子母畫面") {
                                        popup = Popup.NONE
                                        model.startPictureInPicture(index)
                                    }
                                }
                                if (webMode != null) {
                                    MenuRow(
                                        if (webMode == WebMode.PAGE) AppIcons.VideoOnly else AppIcons.WebPage,
                                        if (webMode == WebMode.PAGE) "只顯示影片" else "顯示整個網頁",
                                    ) {
                                        popup = Popup.NONE
                                        model.toggleWebMode(index)
                                    }
                                    MenuRow(AppIcons.Shield, if (source.adblock) "關閉廣告阻擋" else "開啟廣告阻擋") {
                                        popup = Popup.NONE
                                        model.toggleAdblock(index)
                                    }
                                }
                                MenuRow(
                                    if (favorite) AppIcons.Star else AppIcons.StarBorder,
                                    if (favorite) "從最愛移除" else "加入最愛",
                                ) {
                                    popup = Popup.NONE
                                    model.toggleFavorite(index)
                                }
                                MenuRow(AppIcons.Link, "更換網址") { popup = Popup.EDIT }
                                MenuRow(AppIcons.Close, "移除", color = Color(0xFFFF6B6B)) {
                                    popup = Popup.NONE
                                    model.removeSource(index)
                                }
                            }
                            Popup.VOLUME -> VolumePopup(model, index, source) { popup = Popup.NONE }
                            Popup.BRIGHTNESS -> BrightnessPopup(model, index, source) { popup = Popup.NONE }
                            Popup.QUALITY -> QualityMenu(model, index, source) { popup = Popup.NONE }
                            Popup.AUDIO -> AudioMenu(model, index, player) { popup = Popup.NONE }
                            Popup.CAPTIONS -> CaptionMenu(model, index, player) { popup = Popup.NONE }
                            else -> {}
                        }
                    }
                }
            }
        }
    }

    if (popup == Popup.EDIT) {
        HoldControls(model)
        UrlDialog(
            title = "更換第 ${index + 1} 格的網址",
            initial = source.url,
            confirmLabel = "更換",
            onDismiss = { popup = Popup.NONE },
            onSubmit = { model.setSource(it, index) },
        )
    }
}

@Composable
private fun VolumePopup(model: AppModel, index: Int, source: CellSource, onDismiss: () -> Unit) {
    SliderPopup(model, "音量", source.volume, 0..Volume.MAX, 1, null, onDismiss) { model.setVolume(index, it.toDouble()) }
}

@Composable
private fun BrightnessPopup(model: AppModel, index: Int, source: CellSource, onDismiss: () -> Unit) {
    SliderPopup(
        model, "亮度", source.brightness, Brightness.MIN..Brightness.MAX, Brightness.STEP, Brightness.DEFAULT, onDismiss,
    ) { model.setBrightness(index, it) }
}

/** 「顯示整個網頁」／「只顯示影片」（R14）。 */
@Composable
private fun WebModeButton(model: AppModel, index: Int, mode: WebMode) {
    BarButton(
        if (mode == WebMode.PAGE) AppIcons.VideoOnly else AppIcons.WebPage,
        if (mode == WebMode.PAGE) "只顯示影片" else "顯示整個網頁",
        highlighted = mode == WebMode.PAGE,
    ) { model.toggleWebMode(index) }
}

/** 字幕選單（R156）：「關閉」和 yt-dlp 讀到的字幕。 */
@Composable
private fun CaptionMenu(model: AppModel, index: Int, player: CellPlayer?, onDismiss: () -> Unit) {
    val current = player?.currentCaption
    DropdownMenu(expanded = true, onDismissRequest = onDismiss) {
        HoldControls(model)
        DropdownMenuItem(
            text = { Text("關閉" + if (current == null) "  ✓" else "") },
            onClick = {
                onDismiss()
                model.setCaption(index, null)
            },
        )
        for (track in player?.captionTracks ?: emptyList()) {
            DropdownMenuItem(
                text = { Text(track.label + if (track.key == current) "  ✓" else "") },
                onClick = {
                    onDismiss()
                    model.setCaption(index, track)
                },
            )
        }
    }
}

/** 語音選單（桌面版 R95）：yt-dlp 播放的 HLS 有兩條以上的聲音軌時，在「⋯」裡。 */
@Composable
private fun AudioMenu(model: AppModel, index: Int, player: CellPlayer?, onDismiss: () -> Unit) {
    DropdownMenu(expanded = true, onDismissRequest = onDismiss) {
        HoldControls(model)
        for (option in player?.audioOptions ?: emptyList()) {
            DropdownMenuItem(
                text = { Text(option.label + if (option.index == player?.currentAudio) "  ✓" else "") },
                onClick = {
                    onDismiss()
                    model.setAudioTrack(index, option)
                },
            )
        }
    }
}

/** 畫質選單（R153）。 */
@Composable
private fun QualityMenu(model: AppModel, index: Int, source: CellSource, onDismiss: () -> Unit) {
    DropdownMenu(expanded = true, onDismissRequest = onDismiss) {
        HoldControls(model)
        for (quality in AppModel.qualityOptions) {
            DropdownMenuItem(
                text = { Text(quality.label + if (quality == source.quality) "  ✓" else "") },
                onClick = {
                    onDismiss()
                    model.setQuality(index, quality)
                },
            )
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, color: Color = Color.White, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = color) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp)) },
        onClick = onClick,
    )
}

/** 「移動」：長按後拖到另一格放開，兩格互換（R149）。 */
@Composable
private fun MoveHandle(model: AppModel, index: Int) {
    var coordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val currentIndex by rememberUpdatedState(index)

    fun update(local: Offset) {
        // 格子區域占滿整個視窗，所以視窗裡的位置就是格子區域裡的位置
        val root = coordinates?.takeIf { it.isAttached }?.localToRoot(local) ?: return
        model.updateSwap(root.x, root.y)
    }

    Box(
        modifier = Modifier
            .size(44.dp)
            .onGloballyPositioned { coordinates = it }
            .pointerInput(Unit) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { offset ->
                        model.beginSwap(currentIndex)
                        update(offset)
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        update(change.position)
                    },
                    onDragEnd = { model.endSwap() },
                    onDragCancel = { model.cancelSwap() },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            AppIcons.Move,
            contentDescription = "移動（長按後拖到另一格）",
            tint = if (model.swapFrom == index) Accent else Color.White,
            modifier = Modifier.size(22.dp),
        )
    }
}

/** 進度條：點一下或拖曳跳到那個位置（R153）。拖曳中顯示手指所在的時間，放開後才跳轉。 */
@Composable
private fun ProgressBar(progress: PlaybackProgress, source: CellSource, onSeek: (Double) -> Unit) {
    var dragFraction by remember { mutableStateOf<Double?>(null) }
    val display = ProgressRules.view(progress)
    val fraction = dragFraction ?: display.fraction
    val currentOnSeek by rememberUpdatedState(onSeek)

    val seconds = ProgressRules.seekTarget(progress, fraction)
    val leading = if (display.kind == ProgressKind.DVR) {
        // 可回放的直播：顯示距離直播最新位置多久
        val behind = progress.end - seconds
        if (behind <= ProgressRules.LIVE_EDGE_SECONDS) "直播" else ProgressRules.formatBehind(behind)
    } else {
        ProgressRules.formatTime(seconds)
    }
    val trailing = if (display.kind == ProgressKind.DVR) "直播" else ProgressRules.formatTime(progress.end - progress.start)

    var barWidth by remember { mutableStateOf(0) }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(leading, color = Color.White, fontSize = 11.sp)
        Box(
            modifier = Modifier
                .weight(1f)
                .height(28.dp)
                .onSizeChanged { barWidth = it.width }
                .pointerInput(Unit) {
                    detectTapGestures { offset ->
                        if (size.width > 0) currentOnSeek((offset.x / size.width).toDouble().coerceIn(0.0, 1.0))
                    }
                }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            if (size.width > 0) dragFraction = (offset.x / size.width).toDouble().coerceIn(0.0, 1.0)
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            if (size.width > 0) dragFraction = (change.position.x / size.width).toDouble().coerceIn(0.0, 1.0)
                        },
                        onDragEnd = {
                            dragFraction?.let { currentOnSeek(it) }
                            dragFraction = null
                        },
                        onDragCancel = { dragFraction = null },
                    )
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(modifier = Modifier.fillMaxWidth().height(4.dp).background(Color.White.copy(alpha = 0.25f), RoundedCornerShape(2.dp)))
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction.coerceIn(0.0, 1.0).toFloat())
                    .height(4.dp)
                    .background(Accent, RoundedCornerShape(2.dp)),
            )
            // 拖曳時在手指上方顯示那個位置的縮圖與時間（桌面版 R50）
            dragFraction?.let { ProgressPreview(source, progress, display.kind, seconds, leading, it, barWidth) }
        }
        Text(trailing, color = Color.White, fontSize = 11.sp)
    }
}
