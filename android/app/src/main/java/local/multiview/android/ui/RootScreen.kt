package local.multiview.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsIgnoringVisibility
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import local.multiview.android.AppModel
import local.multiview.core.LayoutId
import local.multiview.core.ScreenRules

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

        BoxWithConstraints(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            // 手機直向、畫面上只有一格（版型 `1` 或單格全螢幕）時打開小視窗：上面影片、下面小視窗（R162）。
            // 格子區域縮成 16:9 放在上面，小視窗接在下面；同一個格子畫面，不會重新載入
            val portraitPhone = maxHeight > maxWidth && !ScreenRules.isLarge(maxWidth.value.toDouble(), maxHeight.value.toDouble())
            // 打開小視窗的話會上下排（R164：這時在影片上往上滑就打開小視窗）
            val stackAvailable = portraitPhone && model.pipCell == null &&
                (model.solo != null || model.displayedLayout == LayoutId.ONE)
            val companionStacked = model.companionOpen && stackAvailable
            val videoHeight = maxWidth * 9f / 16f
            SideEffect { model.reportStackLayout(stackAvailable, companionStacked) }
            // 開啟 App 時自動打開小視窗（R165）：第一次量到畫面大小、回報過會不會上下排之後判斷一次（AppModel 記得判斷過）
            val measured = maxWidth > 0.dp && maxHeight > 0.dp
            LaunchedEffect(measured) {
                if (measured) model.openCompanionOnLaunchIfNeeded()
            }

            // YouTube 小視窗：第一次打開之後就一直留著，關掉時只是移到畫面外。
            // 裡面的網頁不用每次重新建立、重新載入（0.0.12 實測：每次打開整個畫面先黑一下，搜尋的內容也不見了）
            var companionCreated by remember { mutableStateOf(false) }
            if (model.companionOpen) companionCreated = true
            val shift by animateFloatAsState(if (model.companionOpen) 0f else 1f, tween(COMPANION_SLIDE_MS), label = "companion")
            // 上下排時打開、關掉是上下滑動（R164）：往下收起，影片等小視窗離開後才放大回整個畫面。
            // 其他情況（蓋在右側、占滿寬度）照原本左右滑動
            var slideDown by remember { mutableStateOf(false) }
            if (model.companionOpen) slideDown = companionStacked
            val panelStacked = companionStacked || (slideDown && !model.companionOpen && shift < 1f)

            // 上下排時小視窗的上緣（像素，R163）：接在影片下面；拉到最上面時占滿畫面（蓋住影片，影片照常播放）。
            // 按著小視窗上方的小把手上下拖曳，放開時往拖曳的方向收合或展開；接在影片下面時往下拉就關掉（R164）
            val density = LocalDensity.current
            val stackMin = with(density) { safeArea.top.toPx() }
            val stackMax = with(density) { (safeArea.top + videoHeight).toPx() }
            val stackLimit = with(density) { maxHeight.toPx() }
            val stackRest = if (model.companionExpanded) stackMin else stackMax
            // 小視窗從接在影片下面移到完全離開畫面要移動的距離（R167）
            val stackTravel = (stackLimit - stackMax).coerceAtLeast(1f)
            val stackTop = remember { Animatable(stackRest) }
            var stackDragStart by remember { mutableStateOf<Float?>(null) }
            var stackDragTotal by remember { mutableFloatStateOf(0f) }
            val scope = rememberCoroutineScope()
            LaunchedEffect(stackRest, panelStacked) {
                if (stackDragStart != null) return@LaunchedEffect
                if (panelStacked) stackTop.animateTo(stackRest) else stackTop.snapTo(stackRest)
            }
            val stackDrag = PanelDrag(
                onDrag = { dy ->
                    val start = stackDragStart ?: stackTop.value.also {
                        stackDragStart = it
                        stackDragTotal = 0f
                    }
                    stackDragTotal += dy
                    val next = (start + stackDragTotal).coerceIn(stackMin, stackLimit)
                    scope.launch { stackTop.snapTo(next) }
                },
                onEnd = { velocity ->
                    stackDragStart = null
                    val moved = stackDragTotal
                    // 快速甩動時預估的最終距離（R167）：用放開時的速度換算
                    val predicted = moved + velocity * FLING_PROJECTION_SECONDS
                    val threshold = with(density) { EXPAND_DRAG.toPx() }
                    val flingThreshold = with(density) { EXPAND_FLING.toPx() }
                    val wasExpanded = model.companionExpanded
                    if (!wasExpanded && moved > 0f && (moved > stackTravel * 0.25f || predicted > stackTravel * 0.5f)) {
                        // 接在影片下面時往下拉超過 1/4，或很快往下甩（預估超過一半）：關掉，從手指放開的位置往下收起（R164、R167）
                        model.closeCompanion()
                    } else {
                        // 拉超過 40dp，或很快甩動（預估超過 150dp）就往那個方向收合或展開；不夠的話小視窗和影片一起回到原位
                        val expand = when {
                            moved < -threshold || predicted < -flingThreshold -> true
                            moved > threshold || predicted > flingThreshold -> false
                            else -> wasExpanded
                        }
                        model.changeCompanionExpanded(expand)
                        scope.launch { stackTop.animateTo(if (expand) stackMin else stackMax) }
                    }
                },
            )
            // 上下排時影片往下移的距離（像素，R167）：跟著小視窗實際的上緣移動，小視窗離開畫面時影片在畫面正中間，
            // 就是小視窗關掉後只有一格時影片的位置，所以改回整個畫面時不跳動（16:9 的影片）。
            // 往下拉、往下收起（關掉）、從下往上滑入（打開）都是同一個算法；占滿畫面（往上拉）時影片不動。
            // 只改位置（offset），大小不變，播放器不重新載入
            val videoHeightPx = with(density) { videoHeight.toPx() }
            val videoCenterShift = ((stackLimit - videoHeightPx) / 2f - stackMin).coerceAtLeast(0f)
            val expanded = model.companionExpanded
            fun videoShift(): Int {
                if (!panelStacked || expanded) return 0
                val fraction = ((panelVisibleTop(stackTop.value, stackLimit, shift, slideDown) - stackMax) / stackTravel).coerceIn(0f, 1f)
                return (videoCenterShift * fraction).roundToInt()
            }
            Box(
                modifier = if (panelStacked) {
                    Modifier
                        .fillMaxWidth()
                        .padding(top = safeArea.top)
                        .height(videoHeight)
                        .offset { IntOffset(0, videoShift()) }
                } else {
                    Modifier.fillMaxSize()
                },
            ) {
                GridView(model, if (panelStacked) safeArea.copy(top = 0.dp, bottom = 0.dp) else safeArea)
            }

            AnimatedVisibility(
                visible = model.toolbarVisible,
                modifier = Modifier.align(Alignment.TopCenter),
                enter = slideInVertically { -it } + fadeIn(),
                exit = slideOutVertically { -it } + fadeOut(),
            ) {
                Toolbar(model, PaddingValues(start = safeArea.left, top = safeArea.top, end = safeArea.right))
            }

            // 工具列顯示時，面板從工具列下面開始
            val panelTop = safeArea.top + if (model.toolbarVisible) 52.dp else 0.dp
            val panelInsets = PaddingValues(end = safeArea.right, bottom = safeArea.bottom)
            val panelModifier = Modifier.padding(top = panelTop).then(if (model.isLarge) Modifier.width(360.dp) else Modifier.fillMaxWidth())
            // 上下排時小視窗接在影片下面，不跟著工具列移動
            val companionModifier = if (panelStacked) {
                Modifier.padding(top = with(density) { stackTop.value.toDp() }).fillMaxWidth()
            } else {
                panelModifier
            }

            if (companionCreated) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        // 關掉時整個移到畫面外面（不會擋住點擊）：上下排時往下，其他時候往右
                        .layout { measurable, constraints ->
                            val placeable = measurable.measure(constraints)
                            layout(placeable.width, placeable.height) {
                                val away = if (shift >= 1f) 100_000 else 0
                                if (slideDown) {
                                    // 從目前的上緣移到畫面下緣外面（R167：影片跟著這個位置移動）
                                    val top = panelVisibleTop(stackTop.value, placeable.height.toFloat(), shift, true)
                                    placeable.place(0, (top - stackTop.value).roundToInt() + away)
                                } else {
                                    placeable.place((placeable.width * shift).toInt() + away, 0)
                                }
                            }
                        },
                ) {
                    CompanionPanel(
                        model,
                        panelInsets,
                        companionModifier,
                        open = model.companionOpen,
                        // 收起的動畫中也維持上下排的樣子（標題列不跳動）
                        drag = if (panelStacked) stackDrag else null,
                    )
                }
            }

            // 清單面板：大螢幕在右側（寬 360dp，蓋在影片上方），小螢幕占滿寬度（R158）
            AnimatedVisibility(
                visible = model.listPanelOpen,
                modifier = Modifier.align(Alignment.CenterEnd),
                enter = slideInHorizontally { it } + fadeIn(),
                exit = slideOutHorizontally { it } + fadeOut(),
            ) {
                ListPanel(model, panelInsets, panelModifier)
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

            // 清單、設定開著時，工具列不自動隱藏。
            // 小視窗上下排（沒有蓋住影片）、或在小視窗裡看影片時照常自動隱藏（R162）
            val holdForCompanion = model.companionOpen && !model.companionBrowsing && !companionStacked
            if (model.listPanelOpen || holdForCompanion || model.settingsOpen) HoldControls(model)
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

/** 小視窗打開、關掉的動畫時間（R164）。 */
private const val COMPANION_SLIDE_MS = 250

/** 上下排時，拉超過這個距離就往那個方向收合或展開（R163）。 */
private val EXPAND_DRAG = 40.dp

/** 快速甩動時，預估的最終距離超過這個距離也收合或展開（R167）。 */
private val EXPAND_FLING = 150.dp

/** 用放開時的速度預估最終距離：速度 × 這個時間（R167，對應 iOS 的 predictedEndTranslation）。 */
private const val FLING_PROJECTION_SECONDS = 0.25f

/**
 * 上下排時小視窗實際的上緣（像素）：stackTop 是拖曳、收合後的位置；打開、關掉的動畫中（slide 0 → 1 是往下收起）
 * 再從那裡往畫面下緣（bottom）移動。
 */
private fun panelVisibleTop(stackTop: Float, bottom: Float, slide: Float, slideDown: Boolean): Float =
    if (slideDown) stackTop + (bottom - stackTop).coerceAtLeast(0f) * slide else stackTop
