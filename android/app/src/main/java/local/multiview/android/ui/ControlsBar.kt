package local.multiview.android.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import local.multiview.android.AppModel
import local.multiview.android.player.CellPlayer
import local.multiview.android.player.WebMode
import local.multiview.core.Brightness
import local.multiview.core.CellSource
import local.multiview.core.PlaybackProgress
import local.multiview.core.ProgressKind
import local.multiview.core.ProgressRules
import local.multiview.core.SponsorBlockRules
import local.multiview.core.Volume

/** 操作列的彈出視窗：一次只開一個。 */
private enum class Popup { NONE, VOLUME, BRIGHTNESS, QUALITY, AUDIO, CAPTIONS, MORE, EDIT }

/** 浮在影片上的圓形按鈕（R166）：40dp 的半透明黑色圓形，和左上角的喇叭按鈕相同。 */
private val CHIP_SIZE = 40.dp

/** 圓形按鈕加上外圍可以點的範圍（R166）。 */
val CHIP_TOUCH_SIZE = 44.dp

/** 細進度條的高度（可以點、拖曳的範圍，R166）。 */
private val THIN_BAR_HEIGHT = 24.dp

/**
 * 每一格的操作按鈕（R151；R166 改成像 YouTube App 一樣浮在影片上）：
 * 右上角子母畫面與齒輪選單、左下時間、右下移動與全螢幕、貼著影片底部的細進度條（R153）。
 * 左上角的喇叭與中間的播放／暫停鈕由 CellView 畫。
 * 只有按鈕、進度條接收手指；其他地方照常交給下面的影片（點一下收起、雙擊快轉、手勢）或網頁。
 */
@Composable
fun BoxScope.ControlsBar(
    model: AppModel,
    index: Int,
    source: CellSource,
    player: CellPlayer?,
    /** 這一格貼著畫面邊緣時，左、右、下方的按鈕要避開的範圍。 */
    insets: PaddingValues,
    /** 右上角按鈕上方要留的距離（避開瀏海與上方的工具列）。 */
    topPadding: Dp,
) {
    var popup by remember { mutableStateOf(Popup.NONE) }
    val supportsVolume = player?.supportsVolume ?: false
    val supportsQuality = model.supportsQuality(source)
    val audioOptions = player?.audioOptions ?: emptyList()
    val captionTracks = player?.captionTracks ?: emptyList()
    val favorite = model.isFavorite(source)
    val supportsPip = model.supportsPictureInPicture(source)
    val webMode = model.webModeOf(source)
    // 上下排時全螢幕按鈕是「進入全螢幕」（R164）
    val isSolo = model.solo == index && !model.companionStacked
    val progress = model.progress[source.id]
    val kind = progress?.let { ProgressRules.view(it).kind }

    // 上下兩層淡淡的漸層，讓白色按鈕在亮的畫面上也看得清楚。不接收手指
    Box(
        modifier = Modifier
            .matchParentSize()
            .background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.45f),
                    0.3f to Color.Transparent,
                    0.6f to Color.Transparent,
                    1f to Color.Black.copy(alpha = 0.55f),
                ),
            ),
    )

    // 右上角：子母畫面、齒輪（和左上角的喇叭按鈕對齊）
    Row(
        modifier = Modifier
            .align(Alignment.TopEnd)
            .padding(top = topPadding + 2.dp, end = insets.calculateEndPadding(LayoutDirection.Ltr) + 2.dp)
            .keepsControlsVisible(model),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (supportsPip) ChipButton(AppIcons.PictureInPicture, "子母畫面") { model.startPictureInPicture(index) }
        // 齒輪：音量、亮度、畫質、語音、字幕、網頁、廣告阻擋、最愛、更換網址、移除（R166）。
        // 用系統的彈出選單；選單開著時操作列不自動收起
        Box {
            ChipButton(AppIcons.Settings, "設定") { popup = Popup.MORE }
            when (popup) {
                Popup.MORE -> DropdownMenu(expanded = true, onDismissRequest = { popup = Popup.NONE }) {
                    HoldControls(model)
                    if (supportsVolume) MenuRow(AppIcons.Tune, "音量") { popup = Popup.VOLUME }
                    MenuRow(AppIcons.Brightness, "亮度") { popup = Popup.BRIGHTNESS }
                    if (supportsQuality) MenuRow(AppIcons.Quality, "畫質：${source.quality.label}") { popup = Popup.QUALITY }
                    if (audioOptions.size > 1) {
                        val current = audioOptions.firstOrNull { it.index == player?.currentAudio }?.label ?: "自動"
                        MenuRow(AppIcons.Voice, "語音：$current") { popup = Popup.AUDIO }
                    }
                    if (captionTracks.isNotEmpty()) {
                        val current = captionTracks.firstOrNull { it.key == player?.currentCaption }?.label ?: "關閉"
                        MenuRow(AppIcons.Captions, "字幕：$current") { popup = Popup.CAPTIONS }
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

    // 下方：左邊時間膠囊、右邊移動與全螢幕，最下面是細進度條
    val showsBar = progress != null && kind != ProgressKind.LIVE
    BoxWithConstraints(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .padding(insets)
            .padding(bottom = if (showsBar) THIN_BAR_HEIGHT else 4.dp),
    ) {
        val buttonCount = if (model.canSwap) 2 else 1
        Row(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 2.dp)
                .keepsControlsVisible(model),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (model.canSwap) MoveHandle(model, index)
            ChipButton(
                if (isSolo) AppIcons.FullscreenExit else AppIcons.Fullscreen,
                if (isSolo) "離開全螢幕" else "全螢幕",
            ) { model.toggleSolo(index) }
        }
        if (progress != null && kind != null) {
            // 格子太窄放不下時間時只留右邊的按鈕
            val text = timeText(progress, kind)
            val style = TextStyle(fontSize = 12.sp, fontFeatureSettings = "tnum")
            val measurer = rememberTextMeasurer()
            val density = LocalDensity.current
            val textWidth = with(density) { measurer.measure(text, style).size.width.toDp() }
            if (maxWidth >= textWidth + 20.dp + 6.dp + CHIP_TOUCH_SIZE * buttonCount + 12.dp) {
                Text(
                    text,
                    color = Color.White,
                    style = style,
                    maxLines = 1,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 6.dp, bottom = 9.dp)
                        .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
    }
    if (showsBar) {
        ProgressBar(
            progress,
            source,
            player,
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(insets)
                .keepsControlsVisible(model),
        ) { model.seek(index, it) }
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

/** 左下角的時間（R166）：「目前 / 長度」；可回放的直播顯示距離最新位置多久，直播只顯示「直播」。 */
private fun timeText(progress: PlaybackProgress, kind: ProgressKind): String = when (kind) {
    ProgressKind.LIVE -> "直播"
    ProgressKind.DVR -> {
        val behind = progress.end - progress.current
        if (behind <= ProgressRules.LIVE_EDGE_SECONDS) "直播" else ProgressRules.formatBehind(behind)
    }
    ProgressKind.VOD -> "${ProgressRules.formatTime(progress.current)} / ${ProgressRules.formatTime(progress.end - progress.start)}"
}

/** 浮在影片上的圓形圖示按鈕（R166）：可以點的範圍 44dp。 */
@Composable
private fun ChipButton(icon: ImageVector, label: String, tint: Color = Color.White, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(CHIP_TOUCH_SIZE)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier.size(CHIP_SIZE).background(Color.Black.copy(alpha = 0.55f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(20.dp))
        }
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
            .size(CHIP_TOUCH_SIZE)
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
        // 和其他浮動按鈕一樣的半透明黑色圓形（R166）
        Box(
            modifier = Modifier.size(CHIP_SIZE).background(Color.Black.copy(alpha = 0.55f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                AppIcons.Move,
                contentDescription = "移動（長按後拖到另一格）",
                tint = if (model.swapFrom == index) Accent else Color.White,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * 進度條：點一下或拖曳跳到那個位置（R153）。拖曳中顯示手指所在的時間，放開後才跳轉。
 * R166 改成浮在影片底部的細進度條：不顯示兩邊的時間（時間在左下角的膠囊），3dp 的線加 12dp 的圓點，拖曳時變 6dp。
 */
@Composable
private fun ProgressBar(
    progress: PlaybackProgress,
    source: CellSource,
    player: CellPlayer?,
    modifier: Modifier = Modifier.fillMaxWidth(),
    onSeek: (Double) -> Unit,
) {
    var dragFraction by remember { mutableStateOf<Double?>(null) }
    val display = ProgressRules.view(progress)
    val fraction = dragFraction ?: display.fraction
    val currentOnSeek by rememberUpdatedState(onSeek)

    val seconds = ProgressRules.seekTarget(progress, fraction)
    // 拖曳時縮圖上方的時間
    val leading = if (display.kind == ProgressKind.DVR) {
        // 可回放的直播：顯示距離直播最新位置多久
        val behind = progress.end - seconds
        if (behind <= ProgressRules.LIVE_EDGE_SECONDS) "直播" else ProgressRules.formatBehind(behind)
    } else {
        ProgressRules.formatTime(seconds)
    }
    val lineHeight by animateDpAsState(if (dragFraction == null) 3.dp else 6.dp, tween(120), label = "progressLine")

    var barWidth by remember { mutableStateOf(0) }
    Box(
        modifier = modifier
            .padding(horizontal = 12.dp)
            .height(THIN_BAR_HEIGHT)
            .onSizeChanged { barWidth = it.width }
            .pointerInput(Unit) {
                detectTapGestures { offset ->
                    if (size.width > 0) currentOnSeek((offset.x / size.width).toDouble().coerceIn(0.0, 1.0))
                }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        if (size.width > 0) dragFraction = (offset.x / size.width).toDouble().coerceIn(0.0, 1.0)
                    },
                    onHorizontalDrag = { change, _ ->
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
        val clamped = fraction.coerceIn(0.0, 1.0).toFloat()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(lineHeight)
                .clip(RoundedCornerShape(50))
                .background(Color.White.copy(alpha = 0.3f)),
        ) {
            Box(modifier = Modifier.fillMaxWidth(clamped).fillMaxHeight().background(Accent))
            // SponsorBlock 片段的色塊（R161），畫在已播放的部分上面
            val marks = if (display.kind == ProgressKind.VOD) {
                SponsorBlockRules.marks(player?.sponsorSegments.orEmpty(), progress.end - progress.start)
            } else {
                emptyList()
            }
            if (marks.isNotEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().drawBehind {
                        val minWidth = 2.dp.toPx()
                        for (mark in marks) {
                            val x = (mark.start * size.width).toFloat()
                            val w = ((mark.end - mark.start) * size.width).toFloat().coerceAtLeast(minWidth)
                            drawRect(Color(0xFF000000 or mark.category.color), Offset(x, 0f), Size(w, size.height))
                        }
                    },
                )
            }
        }
        // 目前位置的圓點
        Box(
            modifier = Modifier
                .offset { IntOffset((clamped * barWidth - 6.dp.toPx()).roundToInt(), 0) }
                .size(12.dp)
                .background(Accent, CircleShape),
        )
        // 拖曳時在手指上方顯示那個位置的縮圖與時間（桌面版 R50）
        dragFraction?.let { ProgressPreview(source, player, progress, display.kind, seconds, leading, it, barWidth) }
    }
}
