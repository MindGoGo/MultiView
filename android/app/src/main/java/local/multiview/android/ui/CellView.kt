package local.multiview.android.ui

import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import local.multiview.android.AppModel
import local.multiview.android.player.CellPlayer
import local.multiview.android.player.SkipNotice
import local.multiview.core.Brightness
import local.multiview.core.SponsorBlockRules
import kotlin.math.abs
import local.multiview.core.CellSource
import local.multiview.core.LayoutId
import local.multiview.core.PlayStatus
import local.multiview.core.ProgressRules

/** 工具列的高度（按鈕 44dp 加上下留白）。 */
private val ToolbarHeight = 52.dp

/** 在影片上往上滑超過這個距離就打開小視窗（R164）。 */
private val SWIPE_UP_DISTANCE = 60.dp

/** 兩指張開、捏合超過這個比例才進入、離開單格全螢幕（R153）。 */
private const val ENTER_SOLO_SCALE = 1.25f
private const val EXIT_SOLO_SCALE = 0.8f

/** 有來源的格子：播放器、亮度遮罩、點擊攔截層、聲音圖示、操作列（R151–R153）。對照 iOS 版的 CellView.swift。 */
@Composable
fun CellView(
    model: AppModel,
    index: Int,
    source: CellSource,
    /** 這一格貼著畫面邊緣時要避開的範圍（瀏海、導覽列）。 */
    insets: PaddingValues,
    /** 這一格在畫面最上面一列：喇叭按鈕要往下移，避開工具列。 */
    touchesTop: Boolean,
    width: Dp,
    height: Dp,
) {
    val player = remember(source.id) { model.playerFor(source) }
    val status = model.statusOf(source)
    val active = model.activeCell == index
    // 整頁模式的網頁：手指操作直接交給網頁
    val interactive = player?.isInteractive ?: false
    var skipHint by remember { mutableStateOf<String?>(null) }
    // 左上、右上角按鈕上方要留的距離：避開瀏海，工具列顯示時再避開工具列
    val topPadding = insets.calculateTopPadding() + if (touchesTop && model.toolbarVisible) ToolbarHeight else 0.dp

    Box(modifier = Modifier.fillMaxSize().clipToBounds().background(Color.Black)) {
        if (player != null) PlayerHost(player)

        // 亮度：蓋一層黑色遮罩，不影響操作列（R153）
        val dim = Brightness.dimOpacity(source.brightness, model.masterBrightness).toFloat()
        if (dim > 0f) Box(modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = dim)))

        if (!interactive) {
            TouchLayer(model, index) { skipHint = it }
        }

        // 浮在影片上的操作按鈕與上下的漸層（R166）。放在中央的播放鈕、左上角的喇叭下面，漸層才不會蓋住它們
        if (active) {
            val barInsets = PaddingValues(
                start = insets.calculateStartPadding(LayoutDirection.Ltr),
                end = insets.calculateEndPadding(LayoutDirection.Ltr),
                bottom = insets.calculateBottomPadding(),
            )
            ControlsBar(model, index, source, player, barInsets, topPadding)
        }

        // 狀態：錯誤訊息、讀取動畫、中央的播放／暫停鈕
        when (status) {
            PlayStatus.ERROR -> Text(
                model.errors[source.id] ?: "無法播放",
                color = Color.White,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(12.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                    .padding(10.dp),
            )
            PlayStatus.LOADING -> if (!interactive) {
                LoadingCritter(player?.isResolving ?: false, width, height, modifier = Modifier.align(Alignment.Center))
            }
            // 暫停時一直顯示播放鈕；整頁模式只在操作列顯示時（R166：操作列不再有播放鈕）
            PlayStatus.PAUSED, PlayStatus.ENDED -> if ((!interactive || active) && model.pipCell == null) {
                CenterButton(AppIcons.Play, "播放", Modifier.align(Alignment.Center)) { model.togglePlay(index) }
            }
            // 播放中：點一下格子、操作列顯示時才出現暫停鈕
            PlayStatus.PLAYING -> if (active) {
                CenterButton(AppIcons.Pause, "暫停", Modifier.align(Alignment.Center)) { model.togglePlay(index) }
            }
        }

        skipHint?.let { hint ->
            LaunchedEffect(hint) {
                delay(700)
                skipHint = null
            }
            Pill(hint.trimEnd('​'), Modifier.align(Alignment.Center), fontSize = 16)
        }

        // 右上角：SponsorBlock 自動跳過的提示，附「取消」（R161）
        if (player != null) player.skipNotice?.let { notice ->
            LaunchedEffect(notice.serial) {
                delay(SponsorBlockRules.NOTICE_MS)
                player.dismissSkipNotice()
            }
            SkipNoticePill(
                notice,
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(
                        end = insets.calculateEndPadding(LayoutDirection.Ltr),
                        // 操作列顯示時在右上角按鈕的下面（R166）
                        top = topPadding + if (active) CHIP_TOUCH_SIZE else 0.dp,
                    )
                    .padding(6.dp),
            ) { player.undoSkip() }
        }

        // 左上角：工具列顯示時是喇叭按鈕（只切換這一格的聲音，用來讓多格同時出聲），旁邊是播放方式的小標示。
        // 操作列顯示時也有（R166：操作列不再有喇叭按鈕，上下排時也沒有工具列）
        val startInset = insets.calculateStartPadding(LayoutDirection.Ltr)
        if (model.toolbarVisible || active) {
            Row(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = startInset, top = topPadding)
                    .padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.55f))
                        .clickable(onClickLabel = if (source.muted) "取消靜音" else "靜音") { model.toggleMute(index) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (source.muted) AppIcons.VolumeOff else AppIcons.VolumeUp,
                        contentDescription = if (source.muted) "取消靜音" else "靜音",
                        tint = if (source.muted) Color.White else Accent,
                        modifier = Modifier.size(20.dp),
                    )
                }
                // 放在喇叭按鈕右邊，不要蓋住喇叭（iOS 0.0.16 的問題）。用 yt-dlp 播放時只顯示一個綠色小圓點（R165）
                model.badgeOf(source)?.let { badge ->
                    Box(
                        modifier = Modifier
                            .padding(start = 4.dp)
                            .size(8.dp)
                            .background(Color(0xFF34C759), CircleShape)
                            .semantics { contentDescription = badge },
                    )
                }
            }
        } else if (source.isAudible && model.pipCell == null && model.solo == null && model.displayedLayout != LayoutId.ONE) {
            // 有聲音的格子一直顯示小喇叭（R7 AC5）。畫面上只有一格（版型 `1`、單格全螢幕）時不顯示（R162）
            Icon(
                AppIcons.VolumeUp,
                contentDescription = "有聲音",
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = startInset + 6.dp, top = insets.calculateTopPadding() + 6.dp)
                    .size(26.dp)
                    .background(Color.Black.copy(alpha = 0.45f), CircleShape)
                    .padding(6.dp),
            )
        }

        // 整頁模式的網頁用小把手叫出操作列
        if (!active && interactive) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = insets.calculateBottomPadding() + 6.dp)
                    .size(width = 44.dp, height = 24.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.55f))
                    .clickable(onClickLabel = "顯示操作列") { model.showControls(index) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(AppIcons.More, contentDescription = "顯示操作列", tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }

        // 拖曳換位中：被拖的格子變暗，手指所在的格子顯示外框（R149）
        if (model.swapFrom == index) {
            Box(modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)))
        }
    }
}

/** 播放器的畫面。播放器跟著來源，換位、切換版型時沿用同一個畫面，不重新載入（R6 AC1）。 */
@Composable
private fun PlayerHost(player: CellPlayer) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context -> FrameLayout(context) },
        update = { container ->
            val view = player.view
            if (view.parent !== container) {
                (view.parent as? ViewGroup)?.removeView(view)
                container.removeAllViews()
                container.addView(
                    view,
                    FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
                )
            }
        },
        onRelease = { container -> container.removeAllViews() },
    )
}

/**
 * 點擊攔截層：點一下只聽這一格並顯示操作列與工具列；雙擊左邊、右邊 1/3 倒轉、快轉 10 秒；
 * 長按影片後拖到另一格放開，兩格互換；兩指張開、捏合進出單格全螢幕。
 */
@Composable
private fun TouchLayer(model: AppModel, index: Int, onSkipHint: (String) -> Unit) {
    var coordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val currentIndex by rememberUpdatedState(index)
    val currentOnSkipHint by rememberUpdatedState(onSkipHint)
    var hintCount by remember { mutableStateOf(0) }

    fun updateSwap(local: Offset) {
        // 格子區域占滿整個視窗，所以視窗裡的位置就是格子區域裡的位置
        val root = coordinates?.takeIf { it.isAttached }?.localToRoot(local) ?: return
        model.updateSwap(root.x, root.y)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .onGloballyPositioned { coordinates = it }
            // 兩指張開、捏合：在其他手勢之前看到事件，兩指時把事件吃掉（不要變成點一下）。
            // 一指往上滑（R164）：手機直向、只有一格、小視窗沒開時打開小視窗；放開的事件吃掉（不要變成點一下）
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    var zoom = 1f
                    var pinched = false
                    do {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        if (event.changes.count { it.pressed } >= 2) {
                            pinched = true
                            zoom *= event.calculateZoom()
                            event.changes.forEach { it.consume() }
                        }
                        if (!pinched && event.changes.none { it.pressed }) {
                            val up = event.changes.firstOrNull { it.id == down.id }
                            if (up != null) {
                                val dx = up.position.x - down.position.x
                                val dy = up.position.y - down.position.y
                                if (dy < -SWIPE_UP_DISTANCE.toPx() && abs(dy) > 2 * abs(dx) && model.swipeUpCell()) up.consume()
                            }
                        }
                    } while (event.changes.any { it.pressed })
                    if (pinched) {
                        if (model.solo == null && zoom > ENTER_SOLO_SCALE) {
                            model.enterSolo(currentIndex)
                        } else if (model.solo == currentIndex && zoom < EXIT_SOLO_SCALE) {
                            model.exitSolo()
                        }
                    }
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { model.tapCell(currentIndex) },
                    onDoubleTap = { offset ->
                        val third = if (size.width > 0) offset.x / size.width else 0.5f
                        val seconds = when {
                            third < 1f / 3 -> -ProgressRules.DOUBLE_TAP_SKIP_SECONDS
                            third > 2f / 3 -> ProgressRules.DOUBLE_TAP_SKIP_SECONDS
                            else -> 0.0
                        }
                        if (seconds == 0.0) {
                            // 中間 1/3 等於點一下
                            model.tapCell(currentIndex)
                        } else if (model.skip(currentIndex, seconds)) {
                            // 直播和沒有進度條的格子不作用。每次的文字都不一樣，連續雙擊時提示才會重新計時
                            hintCount++
                            val text = if (seconds > 0) "+${seconds.toInt()} 秒" else "−${(-seconds).toInt()} 秒"
                            currentOnSkipHint(text + "​".repeat(hintCount % 8))
                        }
                    },
                )
            }
            .pointerInput(Unit) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { offset ->
                        model.beginSwap(currentIndex)
                        updateSwap(offset)
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        updateSwap(change.position)
                    },
                    onDragEnd = { model.endSwap() },
                    onDragCancel = { model.cancelSwap() },
                )
            },
    )
}

/** 「已跳過業配　取消」（R161）：左邊的小色塊是類別在進度條上的顏色。 */
@Composable
private fun SkipNoticePill(notice: SkipNotice, modifier: Modifier, onUndo: () -> Unit) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(Color.Black.copy(alpha = 0.7f))
            .padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(Color(0xFF000000 or notice.segment.category.color), CircleShape),
        )
        Text(
            SponsorBlockRules.skippedLabel(notice.segment.category),
            color = Color.White,
            fontSize = 12.sp,
            modifier = Modifier.padding(start = 6.dp),
        )
        Text(
            "取消",
            color = Accent,
            fontSize = 12.sp,
            modifier = Modifier
                .clickable(onClickLabel = "取消跳過，回到片段開頭", onClick = onUndo)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        )
    }
}

/** 中央的半透明播放／暫停鈕（R30；R165 從 64 縮成 52）。 */
@Composable
private fun CenterButton(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .size(52.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(28.dp))
    }
}
