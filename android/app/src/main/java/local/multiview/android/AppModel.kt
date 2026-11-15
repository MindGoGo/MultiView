package local.multiview.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import local.multiview.android.player.CellPlayer
import local.multiview.android.player.NativePlayer
import local.multiview.android.player.PlayerUpdate
import local.multiview.android.player.AdBlocker
import local.multiview.android.player.WebMode
import local.multiview.android.player.WebPagePlayer
import local.multiview.android.player.WebSourcePlayer
import local.multiview.android.player.YouTubeSourcePlayer
import local.multiview.android.ytdlp.YtDlp
import local.multiview.android.ytdlp.YtDlpUpdater
import org.json.JSONObject
import local.multiview.core.AudioOption
import local.multiview.core.AudioRules
import local.multiview.core.CaptionTrack
import local.multiview.core.Brightness
import local.multiview.core.CellSource
import local.multiview.core.Channel
import local.multiview.core.CompanionAction
import local.multiview.core.CompanionRules
import local.multiview.core.CompanionTab
import local.multiview.core.ExternalLink
import local.multiview.core.FileStore
import local.multiview.core.LayoutId
import local.multiview.core.LayoutMath
import local.multiview.core.ListError
import local.multiview.core.ListGroup
import local.multiview.core.ListKind
import local.multiview.core.ListTab
import local.multiview.core.ListsImport
import local.multiview.core.ListRules
import local.multiview.core.Lists
import local.multiview.core.Outcome
import local.multiview.core.ParsedSource
import local.multiview.core.PlayMethod
import local.multiview.core.PlayStatus
import local.multiview.core.PlaybackProgress
import local.multiview.core.PlaybackRules
import local.multiview.core.ProgressRules
import local.multiview.core.Quality
import local.multiview.core.Ratios
import local.multiview.core.ScreenRules
import local.multiview.core.Settings
import local.multiview.core.SettingsBridge
import local.multiview.core.SlotRules
import local.multiview.core.Slots
import local.multiview.core.SourceId
import local.multiview.core.SourceParser
import local.multiview.core.TrackAxis
import local.multiview.core.WebMethod
import local.multiview.core.YouTubeFeed
import local.multiview.core.YouTubeMethods
import local.multiview.core.YtDlpChannel
import java.io.File

/**
 * App 的狀態：版型、格子、聲音、播放器，以及設定檔與清單檔的保存（R149–R155）。對照 iOS 版的 AppModel.swift。
 * 只在主執行緒使用。畫面要跟著更新的屬性用 Compose 的狀態保存。
 */
class AppModel(private val appContext: Context, directory: File = appContext.filesDir) {
    /** 目前的畫面（Activity）：建立播放器的畫面、旋轉螢幕時需要。 */
    interface Host {
        val context: Context
        val isPortrait: Boolean

        /** 固定成橫向或直向；null 是跟著裝置旋轉。 */
        fun lockOrientation(landscape: Boolean?)

        /** 回到主畫面時要不要自動進入子母畫面（只有一格有聲音的原生播放器在播放時，R154）。 */
        fun setAutoPictureInPicture(enabled: Boolean)

        /** 現在就進入子母畫面；不支援或失敗時回傳 false。 */
        fun enterPictureInPicture(): Boolean
    }

    var host: Host? = null

    // 會保存的設定

    /** 設定的版型。小螢幕時實際顯示的版型見 [displayedLayout]。 */
    var layout by mutableStateOf(LayoutId.DEFAULT)
        private set
    var ratios by mutableStateOf<Map<LayoutId, Ratios>>(emptyMap())
        private set
    var slots by mutableStateOf<Slots>(SlotRules.empty())
        private set

    /** 總亮度（R153）。 */
    var masterBrightness by mutableStateOf(Brightness.DEFAULT)
        private set

    /** YouTube 直播、一般影片的播放方式（R156）。 */
    var youtubeMethods by mutableStateOf(YouTubeMethods())
        private set

    /** 其他網站的播放方式（R156；桌面版 R102）：網頁（預設）或 yt-dlp。 */
    var webMethod by mutableStateOf(WebMethod.WEB)
        private set

    /** 最愛、歷史、訂閱頻道（R158）；存在清單檔，和設定檔分開。 */
    var lists by mutableStateOf(Lists())
        private set

    // 畫面狀態（不保存）

    /** App 的畫面是不是大螢幕（規格第 3 節），由畫面回報。 */
    var isLarge by mutableStateOf(true)
        private set

    /** 每個來源的播放狀態、進度、錯誤訊息，以來源的 id 為索引。 */
    val statuses = mutableStateMapOf<Int, PlayStatus>()
    val progress = mutableStateMapOf<Int, PlaybackProgress>()
    val errors = mutableStateMapOf<Int, String>()

    /** 正在顯示操作列的格位（R151）。 */
    var activeCell by mutableStateOf<Int?>(null)
        private set

    /** 單格全螢幕時放大的格位（R153）；不保存。 */
    var solo by mutableStateOf<Int?>(null)
        private set

    /** 拖曳換位中：被拖的格位，以及手指目前所在的格位（R149）。 */
    var swapFrom by mutableStateOf<Int?>(null)
        private set
    var swapOver by mutableStateOf<Int?>(null)
        private set
    var toolbarVisible by mutableStateOf(false)
        private set

    /** 畫面上方的提示文字，幾秒後自動消失。 */
    var toast by mutableStateOf<String?>(null)
        private set

    /** 清單面板上次的那一邊和分頁（R58）。 */
    var listTab by mutableStateOf(ListTab())
        private set

    /** 清單面板、設定畫面是不是開著（R158）。 */
    var listPanelOpen by mutableStateOf(false)
    var settingsOpen by mutableStateOf(false)

    /** YouTube 小視窗（R158）：是不是開著、目前的分頁、連結的格子（最後點過的 YouTube 格子）。 */
    var companionOpen by mutableStateOf(false)
        private set
    var companionTab by mutableStateOf(CompanionTab.SEARCH)
    var companionCell by mutableStateOf<Int?>(null)
        private set

    /** 目前使用的 yt-dlp 版本；還不知道時為 null。 */
    var ytdlpVersion by mutableStateOf<String?>(null)
        private set

    /** 已經下載、重新開啟 App 後生效的 yt-dlp 版本（R156）。 */
    var ytdlpPendingVersion by mutableStateOf<String?>(null)
        private set
    var ytdlpUpdating by mutableStateOf(false)
        private set

    /** yt-dlp 的更新來源（R156）：正式版或最新版。 */
    var ytdlpChannel by mutableStateOf(YtDlpUpdater.channel(appContext))
        private set

    /** 沒有空格：等使用者選擇要取代哪一格（R150）。 */
    var pendingReplaceUrl by mutableStateOf<String?>(null)

    /** 畫面方向被固定了（工具列的旋轉按鈕）；圖示跟著改變。 */
    var orientationLocked by mutableStateOf(false)
        private set

    /** 子母畫面中顯示的格位（R154）；不在子母畫面時為 null。 */
    var pipCell by mutableStateOf<Int?>(null)
        private set

    /** `2` 版型是不是上下排列（小螢幕直向）；版型圖示跟著畫。 */
    var gridStacked by mutableStateOf(false)
        private set

    /** 訂閱頻道的最新影片與直播狀態（R158）。 */
    val subscriptions = SubscriptionStore(appContext)

    // 內部

    private val scope = MainScope()
    private val players = mutableMapOf<Int, CellPlayer>()
    private val titles = mutableStateMapOf<Int, String>()

    /** 重新載入的網頁格子要沿用的顯示方式（以新來源的 id 為索引）。 */
    private val pendingWebModes = mutableMapOf<Int, WebMode>()

    /** 設定檔裡這個版本還沒有畫面可以改的欄位，保存時原樣寫回。 */
    private var baseSettings: Settings
    private val settingsFile = File(directory, FileStore.SETTINGS_FILE_NAME)
    private val listsFile = File(directory, FileStore.LISTS_FILE_NAME)

    /** 開啟 App 之後播放過的來源。還沒播放過的來源保留原本的觀看進度（R55）。 */
    private val everPlayed = mutableSetOf<Int>()
    private var saveJob: Job? = null
    private var hideJob: Job? = null
    private var toastJob: Job? = null

    /** 滑桿、選單等彈出視窗開著的數量；大於 0 時操作列與工具列不自動隱藏。 */
    private var controlsHolds = 0

    /** 進入單格全螢幕時自動轉成了橫向，離開時要轉回原本的方向。 */
    private var rotatedForSolo = false

    /** 旋轉按鈕固定的方向：true 橫向、false 直向、null 沒有固定（跟著裝置旋轉）。 */
    private var lockedLandscape: Boolean? = null

    /** 進入單格全螢幕時因此暫停的來源；離開時恢復播放。 */
    private var soloPaused = setOf<Int>()

    /** 切到背景、或被其他 App 的聲音打斷時因此暫停的來源；回來時恢復播放。 */
    private var backgroundPaused = setOf<Int>()
    private var interruptionPaused = setOf<Int>()
    private var inBackground = false

    /** 從通知或鎖定畫面按了暫停：記下正在播放的格子，按播放時恢復它們。 */
    private var remotePaused = setOf<Int>()

    /** 操作列的子母畫面按鈕指定的格位；自動進入子母畫面時為 null。 */
    private var pipRequested: Int? = null

    /** 格子區域的大小（像素），由畫面回報（拖曳換位時用來找手指在哪一格）。 */
    private var gridWidth = 0f
    private var gridHeight = 0f

    private val audioFocus = AudioFocus(appContext, ::handleFocusLoss, ::handleFocusGain)

    init {
        val settings = FileStore.loadSettings(settingsFile)
        baseSettings = settings
        lists = FileStore.loadLists(listsFile)
        layout = settings.layout
        ratios = settings.ratios
        masterBrightness = settings.brightness
        youtubeMethods = initialMethods(settings.youtubeMethods)
        webMethod = settings.webMethod
        listTab = settings.listTab
        // 還原的來源載入後維持暫停（R10 AC1）
        slots = SettingsBridge.restoreSlots(settings.slots)

        startYtDlpAutoUpdate()
        // 廣告阻擋的規則在背景準備
        AdBlocker.prepare(appContext)

        // 拔掉耳機時全部暫停（R152）
        ContextCompat.registerReceiver(
            appContext,
            object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) = pauseAll()
            },
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    /**
     * Android 版預設用 yt-dlp 播放 YouTube（R156：實測拿得到 720p，而且原生播放器才能多格同時出聲）。
     * 設定檔的預設值是「內嵌播放器」（和桌面版相同的格式），所以第一次開啟時改成 yt-dlp。
     */
    private fun initialMethods(saved: YouTubeMethods): YouTubeMethods {
        val preferences = appContext.getSharedPreferences("app", Context.MODE_PRIVATE)
        if (preferences.getBoolean(KEY_METHODS_DEFAULT, false)) return saved
        preferences.edit().putBoolean(KEY_METHODS_DEFAULT, true).apply()
        return YouTubeMethods(PlayMethod.YTDLP, PlayMethod.YTDLP)
    }

    // 版型

    /** 實際顯示的版型：小螢幕時 `2×2`、`3×3`、`1+3` 暫時用 `2` 顯示。 */
    val displayedLayout: LayoutId get() = ScreenRules.displayedLayout(layout, isLarge)

    val availableLayouts: List<LayoutId> get() = ScreenRules.availableLayouts(isLarge)

    fun ratiosFor(layout: LayoutId): Ratios = ratios[layout] ?: Ratios.defaults(layout)

    /** 畫面回報格子區域的大小（像素）、是不是大螢幕、`2` 版型是不是上下排列。 */
    fun setGrid(width: Float, height: Float, large: Boolean, stacked: Boolean) {
        gridWidth = width
        gridHeight = height
        if (gridStacked != stacked) gridStacked = stacked
        if (isLarge != large) {
            isLarge = large
            pauseHiddenSources()
        }
    }

    fun selectLayout(next: LayoutId) {
        // 單格全螢幕時按版型：先回到分割畫面，再切換版型（R20 AC6）
        exitSolo()
        keepControlsVisible()
        if (layout == next) return
        layout = next
        pauseHiddenSources()
        activeCell?.let { if (!isVisible(it)) activeCell = null }
        val hidden = SlotRules.hiddenCount(slots, displayedLayout)
        if (hidden > 0) showToast("有 $hidden 個來源暫時隱藏")
        scheduleSave()
    }

    fun moveDivider(layout: LayoutId, axis: TrackAxis, index: Int, position: Double, min: Double) {
        val current = ratiosFor(layout)
        val next = if (axis == TrackAxis.COLS) {
            current.copy(cols = LayoutMath.moveDivider(current.cols, index, position, min))
        } else {
            current.copy(rows = LayoutMath.moveDivider(current.rows, index, position, min))
        }
        ratios = ratios + (layout to next)
        scheduleSave()
    }

    fun resetDivider(layout: LayoutId, axis: TrackAxis, index: Int, min: Double) {
        val current = ratiosFor(layout)
        val next = if (axis == TrackAxis.COLS) {
            current.copy(cols = LayoutMath.resetDivider(current.cols, index, min))
        } else {
            current.copy(rows = LayoutMath.resetDivider(current.rows, index, min))
        }
        ratios = ratios + (layout to next)
        scheduleSave()
    }

    fun isVisible(index: Int): Boolean = SlotRules.isVisible(index, displayedLayout, solo)

    // 旋轉（R149）

    /**
     * 工具列的旋轉按鈕：轉成另一個方向並固定（關了自動旋轉也可以轉，按鈕變成藍色）；
     * 再按一次取消固定，回到跟著裝置旋轉（0.0.5 實測：按過之後一直是藍色，只有長按才能取消，不直覺）。
     */
    fun rotate() {
        val host = host ?: return
        if (orientationLocked) {
            unlockOrientation()
            return
        }
        rotatedForSolo = false
        val landscape = host.isPortrait
        lockedLandscape = landscape
        host.lockOrientation(landscape)
        orientationLocked = true
        keepControlsVisible()
    }

    /** 解除固定，回到跟著裝置旋轉。 */
    fun unlockOrientation() {
        rotatedForSolo = false
        lockedLandscape = null
        host?.lockOrientation(null)
        orientationLocked = false
        keepControlsVisible()
    }

    // 單格全螢幕（R153）

    /** 這一格占滿畫面，其他顯示中、正在播放的來源暫停。 */
    fun enterSolo(index: Int) {
        if (solo != null || slots.getOrNull(index) == null || !isVisible(index)) return
        // 手機直向時轉成橫向（關了自動旋轉、或用旋轉按鈕固定成直向也一樣），離開時轉回原本的方向
        val host = host
        if (host != null && !isLarge && host.isPortrait) {
            rotatedForSolo = true
            host.lockOrientation(landscape = true)
        }
        val paused = mutableSetOf<Int>()
        slots.forEachIndexed { position, source ->
            if (source != null && position != index && isVisible(position) && statuses[source.id] == PlayStatus.PLAYING) {
                paused += source.id
                players[source.id]?.pause()
            }
        }
        soloPaused = paused
        solo = index
        cancelSwap()
        showControls(index)
    }

    /** 回到分割畫面；只有進入時正在播放的其他來源恢復播放。 */
    fun exitSolo() {
        if (solo == null) return
        solo = null
        if (rotatedForSolo) {
            rotatedForSolo = false
            host?.lockOrientation(lockedLandscape)
        }
        soloPaused.forEach { players[it]?.play() }
        soloPaused = emptySet()
        keepControlsVisible()
    }

    fun toggleSolo(index: Int) {
        if (solo == null) enterSolo(index) else exitSolo()
    }

    // 拖曳換位（R149）

    /** 可不可以換位：`1` 版型、小螢幕的暫時版型、單格全螢幕時不行。 */
    val canSwap: Boolean get() = solo == null && displayedLayout == layout && layout != LayoutId.ONE

    fun beginSwap(from: Int) {
        if (!canSwap || slots.getOrNull(from) == null || swapFrom != null) return
        swapFrom = from
        swapOver = from
        holdControls(true)
    }

    /** x、y：手指在格子區域裡的位置（像素）。 */
    fun updateSwap(x: Float, y: Float) {
        if (swapFrom == null || gridWidth <= 0 || gridHeight <= 0) return
        val fx = x / gridWidth
        val fy = y / gridHeight
        val rects = LayoutMath.cellRects(displayedLayout, ratiosFor(displayedLayout), gridStacked)
        val over = rects.indexOfFirst { fx >= it.x && fx < it.x + it.w && fy >= it.y && fy < it.y + it.h }
        swapOver = over.takeIf { it >= 0 }
    }

    /** 放開：和手指所在的格子互換。放開在原本的格子或格子以外不發生變化（R6 AC3）。 */
    fun endSwap() {
        val from = swapFrom
        val over = swapOver
        cancelSwap()
        if (from == null || over == null || from == over) return
        slots = SlotRules.swap(slots, from, over)
        if (activeCell == from) activeCell = over
        if (companionCell == from) companionCell = over else if (companionCell == over) companionCell = from
        scheduleSave()
    }

    fun cancelSwap() {
        if (swapFrom == null) return
        swapFrom = null
        swapOver = null
        holdControls(false)
    }

    // 來源（R150）

    /**
     * 在格子放入網址。成功回傳 null，失敗回傳要顯示的訊息。
     * 已經有影片的格子是更換網址：保留靜音、音量、亮度（R2 AC8）。
     */
    fun setSource(text: String, index: Int): String? {
        val url = text.trim()
        val parsed = SourceParser.parse(url)
        if (index !in slots.indices || parsed == null) return ListError.UNSUPPORTED.message
        var source = CellSource(url = url, parsed = parsed, autoplay = true, record = true)
        val old = slots[index]
        source = if (old != null) {
            releasePlayer(old.id)
            source.copy(muted = old.muted, volume = old.volume, brightness = old.brightness)
        } else {
            // 已經有顯示中的來源有聲音時，新來源靜音（R7 AC1）
            source.copy(muted = AudioRules.initialMuted(slots, displayedLayout))
        }
        slots = SlotRules.set(slots, index, source)
        scheduleSave()
        return null
    }

    fun removeSource(index: Int) {
        val source = slots.getOrNull(index) ?: return
        // 單格全螢幕時移除：回到分割畫面（R20 AC7）
        if (solo == index) exitSolo()
        releasePlayer(source.id)
        slots = SlotRules.set(slots, index, null)
        if (activeCell == index) activeCell = null
        scheduleSave()
    }

    /**
     * 這個來源的播放器；第一次要用時才建立，之後沿用同一個。
     * 只替目前還在格子裡的來源建立播放器：格子換成別的影片的那一瞬間畫面可能還會畫一次舊的格子，
     * 這時如果建立播放器，舊影片會在背景重新載入、出聲（iOS 0.0.23 的問題）。
     */
    fun playerFor(source: CellSource): CellPlayer? {
        players[source.id]?.let { return it }
        if (slots.none { it?.id == source.id }) return null
        val context = host?.context ?: return null
        val player = makePlayer(context, source)
        val id = source.id
        player.onUpdate = { update -> applyUpdate(update, id) }
        players[id] = player
        return player
    }

    private fun makePlayer(context: Context, source: CellSource): CellPlayer = when (val parsed = source.parsed) {
        is ParsedSource.YouTube -> YouTubeSourcePlayer(context, parsed.videoId, source, youtubeMethods).also { player ->
            player.onFallback = { reason ->
                showToast("yt-dlp 無法播放，已改用內嵌播放器")
                updateYtDlpAfterFailure(reason)
            }
        }
        is ParsedSource.Hls -> NativePlayer(context, parsed.url, source, adaptive = true)
        is ParsedSource.Mp4 -> NativePlayer(context, parsed.url, source, adaptive = false)
        is ParsedSource.Web -> makeWebPlayer(context, parsed.url, source)
    }

    /** 網頁格子（R157）。YouTube 網站頁面以整頁模式顯示，點了影片就把這一格換成那部影片（R57）。 */
    private fun makeWebPlayer(context: Context, url: String, source: CellSource): CellPlayer {
        val youtubeSite = SourceParser.isYouTubeSite(source.url)
        // 切換廣告阻擋而重新載入時，沿用切換前的顯示方式
        val mode = pendingWebModes.remove(source.id) ?: if (youtubeSite) WebMode.PAGE else WebMode.VIDEO
        val id = source.id
        return WebSourcePlayer(context, url, source, mode, interceptYouTube = youtubeSite, method = webMethod).also { player ->
            player.onNotice = ::showToast
            player.onFallback = { showToast("yt-dlp 無法播放這個網站，已改用網頁播放") }
            player.onYouTubeVideo = { href ->
                val index = slots.indexOfFirst { it?.id == id }
                if (index >= 0) setSource(href, index)?.let(::showToast)
            }
        }
    }

    // 網頁格子（R157）

    /** 這個來源現在顯示的網頁；用 yt-dlp 播放、解析中、不是網頁來源時為 null。 */
    private fun webPageOf(id: Int?): WebPagePlayer? = (players[id] as? WebSourcePlayer)?.webPage

    /** 這一格現在顯示的是網頁時，回傳它的顯示方式（用 yt-dlp 播放時沒有網頁的按鈕，R103）。 */
    fun webModeOf(source: CellSource): WebMode? = webPageOf(source.id)?.mode

    /** 「顯示整個網頁」／「只顯示影片」（R14）。 */
    fun toggleWebMode(index: Int) {
        val page = webPageOf(slots.getOrNull(index)?.id) ?: return
        if (page.mode == WebMode.PAGE) page.requestVideoMode() else page.changeModeByUser(WebMode.PAGE)
        keepControlsVisible()
    }

    /** 廣告阻擋的開關（R17）：只影響這一格，網頁重新載入，保留原本的顯示方式。 */
    fun toggleAdblock(index: Int) {
        val old = slots.getOrNull(index) ?: return
        if (old.parsed !is ParsedSource.Web) return
        val next = old.copy(
            id = SourceId.next(),
            adblock = !old.adblock,
            autoplay = statuses[old.id]?.showsPause ?: old.autoplay,
            record = false,
        )
        webModeOf(old)?.let { pendingWebModes[next.id] = it }
        releasePlayer(old.id)
        slots = SlotRules.set(slots, index, next)
        showToast(if (next.adblock) "廣告阻擋：開" else "廣告阻擋：關")
        scheduleSave()
    }

    /**
     * 系統的返回鍵：先關清單面板；整頁模式的網頁回上一頁；單格全螢幕回到分割畫面。
     * 都沒有的時候回傳 false（由系統處理：離開 App）。
     */
    fun handleBack(): Boolean {
        if (listPanelOpen || companionOpen) {
            listPanelOpen = false
            companionOpen = false
            return true
        }
        val index = activeCell ?: solo ?: visibleSlotIndices.singleOrNull { webPageOf(slots[it]?.id)?.mode == WebMode.PAGE }
        val page = webPageOf(slots.getOrNull(index ?: -1)?.id)
        if (page != null && page.mode == WebMode.PAGE && page.canGoBack) {
            page.goBack()
            return true
        }
        if (solo != null) {
            exitSolo()
            return true
        }
        return false
    }

    private fun releasePlayer(id: Int) {
        players.remove(id)?.shutdown()
        statuses.remove(id)
        progress.remove(id)
        errors.remove(id)
        titles.remove(id)
        everPlayed.remove(id)
        updateAudioFocus()
        updateBackgroundPlayback()
    }

    /**
     * 畫面（Activity）要結束了：播放器的畫面屬於這個 Activity，全部釋放。
     * 格子留著，下次開啟時從目前的位置、暫停的狀態重新載入。
     */
    fun releaseAllPlayers() {
        saveNow()
        exitSolo()
        slots = slots.map { source ->
            if (source == null || !players.containsKey(source.id)) {
                source
            } else {
                val position = if (everPlayed.contains(source.id)) {
                    ProgressRules.resumePosition(progress[source.id], statuses[source.id] == PlayStatus.ENDED)
                } else {
                    source.resume
                }
                // 換一個 id：畫面下次會替它建立新的播放器
                source.copy(id = SourceId.next(), autoplay = false, resume = position, record = false)
            }
        }
        players.keys.toList().forEach(::releasePlayer)
        activeCell = null
        toolbarVisible = false
        audioFocus.abandon()
    }

    private fun applyUpdate(update: PlayerUpdate, id: Int) {
        if (!players.containsKey(id)) return
        val statusChanged = statuses[id] != update.status
        if (statusChanged) {
            statuses[id] = update.status
            updateAudioFocus()
        }
        val nextProgress = update.progress
        if (nextProgress == null) progress.remove(id) else if (progress[id] != nextProgress) progress[id] = nextProgress
        val nextError = update.errorMessage
        if (nextError == null) errors.remove(id) else if (errors[id] != nextError) errors[id] = nextError
        update.title?.let { titles[id] = it }
        if (update.status == PlayStatus.PLAYING) everPlayed += id
        if (update.status == PlayStatus.PLAYING || update.status == PlayStatus.PAUSED) recordHistoryIfNeeded(id)
        if (statusChanged) updateBackgroundPlayback()
    }

    /** 使用者放入的來源，第一次成功載入時記錄到歷史（R23）。 */
    private fun recordHistoryIfNeeded(id: Int) {
        val index = slots.indexOfFirst { it?.id == id }
        val source = slots.getOrNull(index) ?: return
        if (!source.record) return
        slots = SlotRules.set(slots, index, source.copy(record = false))
        lists = ListRules.recordHistory(lists, source.url, titles[id], now())
        saveLists()
    }

    // 清單（R158；清單面板在之後的版本，這裡先有歷史與最愛的資料）

    private fun saveLists() {
        try {
            FileStore.saveLists(lists, listsFile)
        } catch (_: Exception) {
        }
    }

    fun isFavorite(source: CellSource): Boolean = ListRules.isFavorite(lists, source.url)

    /** 操作列的星號：加入或移出最愛（R22）。名稱用影片的標題。 */
    fun toggleFavorite(index: Int) {
        val source = slots.getOrNull(index) ?: return
        if (ListRules.isFavorite(lists, source.url)) {
            lists = ListRules.removeFavorite(lists, source.url)
            showToast("已從最愛移除")
        } else {
            val name = ListRules.defaultName(source.url, titles[source.id])
            when (val result = ListRules.addFavorite(lists, source.url, name, now())) {
                is Outcome.Ok -> {
                    lists = result.value
                    showToast("已加入最愛")
                }
                is Outcome.Err -> showToast(result.error.message)
            }
        }
        saveLists()
        keepControlsVisible()
    }

    /**
     * 從其他 App 送進來的文字（R150）：`multiview://open?url=…`，或分享選單送來的文字（取第一個網址）。
     * 放進第一個顯示中的空格；沒有空格時讓使用者選擇要取代哪一格。
     */
    fun openExternal(text: String) {
        val target = ExternalLink.target(text) ?: ExternalLink.firstUrl(text)
        if (target == null || SourceParser.parse(target) == null) {
            showToast(ListError.UNSUPPORTED.message)
            return
        }
        exitSolo()
        val index = SlotRules.firstEmptyVisible(slots, displayedLayout, solo)
        if (index == null) {
            pendingReplaceUrl = target
        } else {
            showToast(setSource(target, index) ?: "已放進第 ${index + 1} 格")
        }
    }

    // YouTube 小視窗（R158）

    /** 清單面板和 YouTube 小視窗用同一個位置，一次只開一個。 */
    fun toggleListPanel() {
        listPanelOpen = !listPanelOpen
        if (listPanelOpen) companionOpen = false
        keepControlsVisible()
    }

    fun toggleCompanion() {
        if (companionOpen) {
            companionOpen = false
        } else {
            listPanelOpen = false
            if (companionSource() == null) {
                // 還沒點過 YouTube 的格子：先連結第一個顯示中的 YouTube 格子
                companionCell = slots.indices.firstOrNull { isVisible(it) && slots[it]?.parsed is ParsedSource.YouTube }
            }
            companionOpen = true
        }
        keepControlsVisible()
    }

    fun closeCompanion() {
        companionOpen = false
    }

    /** 連結的格子裡的 YouTube 來源；格子被移除或換成別種來源時為 null。 */
    private fun companionSource(): CellSource? =
        slots.getOrNull(companionCell ?: -1)?.takeIf { it.parsed is ParsedSource.YouTube }

    val companionVideoId: String? get() = (companionSource()?.parsed as? ParsedSource.YouTube)?.videoId

    val companionTitle: String? get() = companionSource()?.let { titles[it.id] }

    /**
     * 在小視窗裡點了影片連結（R79、R80、R82）。
     * replaceLinkedCell：推薦、留言分頁是換掉連結的格子；搜尋分頁是放進空格（沒有空格時詢問）。
     */
    fun companionOpenVideo(href: String, replaceLinkedCell: Boolean) {
        val action = CompanionRules.linkAction(href, if (replaceLinkedCell) companionVideoId else null) ?: return
        when (action) {
            is CompanionAction.Seek -> companionSource()?.let { players[it.id]?.seekTo(action.seconds) }
            is CompanionAction.Play -> {
                val cell = companionCell
                val empty = SlotRules.firstEmptyVisible(slots, displayedLayout, solo)
                when {
                    replaceLinkedCell && cell != null && companionSource() != null -> setSource(action.url, cell)?.let(::showToast)
                    empty != null -> {
                        val message = setSource(action.url, empty)
                        if (message != null) showToast(message) else companionCell = empty
                    }
                    else -> pendingReplaceUrl = action.url
                }
            }
        }
    }

    fun changeListTab(tab: ListTab) {
        if (listTab == tab) return
        listTab = tab
        scheduleSave()
    }

    /** 點清單的一筆：放進第一個顯示中的空格；沒有空格時讓使用者選擇要取代哪一格（R21、R64）。 */
    fun openFromList(url: String) {
        val index = SlotRules.firstEmptyVisible(slots, displayedLayout, solo)
        if (index == null) {
            pendingReplaceUrl = url
            return
        }
        val message = setSource(url, index)
        if (message != null) showToast(message) else listPanelOpen = false
    }

    /** 編輯清單的一筆；失敗時回傳要顯示的訊息（R21）。 */
    fun editListItem(kind: ListKind, index: Int, url: String, name: String): String? =
        when (val result = ListRules.editItem(lists, kind, index, url, name)) {
            is Outcome.Ok -> {
                lists = result.value
                saveLists()
                null
            }
            is Outcome.Err -> result.error.message
        }

    fun deleteListItem(kind: ListKind, index: Int) {
        lists = ListRules.deleteItem(lists, kind, index)
        saveLists()
    }

    fun clearHistory(group: ListGroup) {
        lists = ListRules.clearHistory(lists, group)
        saveLists()
    }

    // 訂閱頻道（R158）

    /** 加入頻道：貼上頻道網址或影片網址（加入那部影片的頻道）。成功回傳 null，失敗回傳要顯示的訊息（R59）。 */
    suspend fun addChannel(input: String): String? {
        val notFound = "找不到這個頻道"
        val lookup = YouTubeFeed.channelLookup(input) ?: return notFound
        val html = subscriptions.fetchText(lookup.page) ?: return notFound
        val info = YouTubeFeed.extractChannelInfo(html, lookup.kind) ?: return notFound
        return when (val result = ListRules.addChannel(lists, info.id, info.name, Channel.pageUrl(info.id), now())) {
            is Outcome.Ok -> {
                lists = result.value
                saveLists()
                null
            }
            is Outcome.Err -> result.error.message
        }
    }

    fun removeChannel(id: String) {
        lists = ListRules.removeChannel(lists, id)
        subscriptions.forget(id)
        saveLists()
    }

    /** 匯入 Google Takeout 的訂閱檔（subscriptions.csv），回傳要顯示的結果（R61）。 */
    fun importTakeout(text: String): String {
        val channels = YouTubeFeed.parseTakeoutCsv(text) ?: return "這個檔案不是 YouTube 訂閱清單"
        val result = ListRules.addChannels(lists, channels, now())
        lists = result.lists
        saveLists()
        return "已匯入 ${result.added} 個頻道（略過 ${result.skipped} 個已訂閱）"
    }

    // 設定（R158）

    /** 改變 YouTube 的播放方式（R88）：YouTube 格子從目前的位置重新載入。 */
    fun changeYouTubeMethods(methods: YouTubeMethods) {
        if (methods == youtubeMethods) return
        youtubeMethods = methods
        slots = slots.map { source ->
            if (source == null || source.parsed !is ParsedSource.YouTube || !players.containsKey(source.id)) {
                source
            } else {
                val playing = statuses[source.id]?.showsPause ?: false
                val position = ProgressRules.resumePosition(progress[source.id]) ?: source.resume
                releasePlayer(source.id)
                // 換一個 id：畫面會替它建立新的播放器
                source.copy(id = SourceId.next(), autoplay = playing, resume = position, record = false)
            }
        }
        activeCell = null
        scheduleSave()
    }

    /**
     * 改變其他網站的播放方式（桌面版 R102）：其他網站的格子從目前的位置重新載入。
     * YouTube 的格子、YouTube 網站頁面（一律用網頁，R57）不受影響。
     */
    fun changeWebMethod(method: WebMethod) {
        if (method == webMethod) return
        webMethod = method
        var reloaded = false
        slots = slots.map { source ->
            if (source == null || source.parsed !is ParsedSource.Web || SourceParser.isYouTubeSite(source.url) ||
                !players.containsKey(source.id)
            ) {
                source
            } else {
                val playing = statuses[source.id]?.showsPause ?: false
                val position = ProgressRules.resumePosition(progress[source.id]) ?: source.resume
                releasePlayer(source.id)
                reloaded = true
                // 換一個 id：畫面會替它建立新的播放器
                source.copy(id = SourceId.next(), autoplay = playing, resume = position, record = false)
            }
        }
        if (reloaded) activeCell = null
        scheduleSave()
    }

    /** 用匯入的設定取代目前的版型、格子、聲音、亮度、播放方式。匯入後所有格子維持暫停。 */
    fun importSettings(settings: Settings) {
        exitSolo()
        players.keys.toList().forEach(::releasePlayer)
        activeCell = null
        layout = settings.layout
        ratios = settings.ratios
        masterBrightness = settings.brightness
        youtubeMethods = settings.youtubeMethods
        webMethod = settings.webMethod
        listTab = settings.listTab
        slots = SettingsBridge.restoreSlots(settings.slots)
        baseSettings = settings.copy(slots = SettingsBridge.saveSlots(slots))
        saveNow()
    }

    /** 把匯入的清單合併進目前的清單，回傳新增了幾筆。 */
    fun importLists(imported: Lists): ListsImport.Summary {
        val result = ListsImport.merge(lists, imported)
        lists = result.lists
        saveLists()
        return result.summary
    }

    /** 清除網站資料（Cookie、登入狀態）。 */
    fun clearWebsiteData() {
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        showToast("已清除網站資料")
    }

    // yt-dlp 的更新（R156）

    /** 開啟 App 後在背景檢查更新（距離上次檢查超過 24 小時才檢查），不顯示訊息。 */
    private fun startYtDlpAutoUpdate() {
        scope.launch {
            // 先讓畫面和影片載入
            delay(5000)
            try {
                noteYtDlpUpdate(YtDlpUpdater.autoUpdateIfNeeded(appContext))
            } catch (_: Exception) {
            }
        }
    }

    /** 改變 yt-dlp 的更新來源：馬上檢查並下載那個來源的版本，重新開啟 App 後生效。 */
    fun changeYtDlpChannel(channel: YtDlpChannel) {
        if (channel == ytdlpChannel) return
        ytdlpChannel = channel
        YtDlpUpdater.setChannel(appContext, channel)
        checkYtDlpUpdate()
    }

    /** 設定畫面的「檢查更新」。 */
    fun checkYtDlpUpdate() {
        if (ytdlpUpdating) return
        ytdlpUpdating = true
        scope.launch {
            val outcome = try {
                YtDlpUpdater.update(appContext)
            } catch (error: Exception) {
                YtDlpUpdater.Outcome.Failed(error.message ?: "未知的錯誤")
            }
            ytdlpUpdating = false
            noteYtDlpUpdate(outcome)
            showToast(outcome.message)
        }
    }

    /** 解析失敗、看起來是 yt-dlp 太舊：在背景更新，下次開啟 App 生效。 */
    private fun updateYtDlpAfterFailure(reason: String) {
        scope.launch {
            val outcome = try {
                YtDlpUpdater.updateAfterFailure(appContext, reason)
            } catch (_: Exception) {
                null
            }
            if (outcome is YtDlpUpdater.Outcome.Updated) {
                noteYtDlpUpdate(outcome)
                showToast(outcome.message)
            }
        }
    }

    private fun noteYtDlpUpdate(outcome: YtDlpUpdater.Outcome?) {
        if (outcome is YtDlpUpdater.Outcome.Updated) ytdlpPendingVersion = outcome.version
    }

    /** 讀取目前使用的 yt-dlp 版本（要啟動 Python，設定畫面打開時才讀）。 */
    fun refreshYtDlpVersion() {
        if (ytdlpVersion != null) return
        scope.launch {
            try {
                ytdlpVersion = JSONObject(YtDlp.versions(appContext)).optString("yt_dlp").ifEmpty { null }
            } catch (_: Exception) {
            }
        }
    }

    /** 目前顯示中、可以被取代的格位。 */
    val visibleSlotIndices: List<Int> get() = slots.indices.filter(::isVisible)

    fun replaceSlot(index: Int, url: String) {
        val message = setSource(url, index)
        if (message != null) showToast(message) else listPanelOpen = false
    }

    // 聲音（R152）

    /**
     * 點一下有影片的格子：只有這一格有聲音，並顯示操作列與工具列（R151、R152）。
     * 這一格的操作列已經顯示時，再點一下就收起來；聲音已經在這一格，不用再切換。
     */
    fun tapCell(index: Int) {
        if (slots.getOrNull(index) == null) return
        if (activeCell == index && toolbarVisible) {
            hideControls()
            return
        }
        // YouTube 小視窗跟著最後點過的 YouTube 格子
        if (slots[index]?.parsed is ParsedSource.YouTube) companionCell = index
        val wasPlaying = playingSourceIds()
        slots = AudioRules.focus(slots, index)
        syncAudio()
        resumeIfInterrupted(wasPlaying)
        showControls(index)
        scheduleSave()
    }

    /** 喇叭：只切換這一格，不影響其他格子（多格聲音）。 */
    fun toggleMute(index: Int) {
        if (AudioRules.unmutingSilencesOthers(slots, index, ::usesWebAudio)) {
            showToast("內嵌播放器和網頁的格子同一時間只能有一格有聲音")
        }
        val wasPlaying = playingSourceIds()
        slots = AudioRules.toggleMute(slots, index, ::usesWebAudio)
        syncAudio()
        resumeIfInterrupted(wasPlaying)
        keepControlsVisible()
        scheduleSave()
    }

    /** 這個來源現在是不是用網頁播放聲音。YouTube 用 yt-dlp 播放時是原生播放器，不算。 */
    private fun usesWebAudio(source: CellSource): Boolean = players[source.id]?.usesWebAudio ?: source.usesWebAudio

    private fun playingSourceIds(): Set<Int> = statuses.filterValues { it == PlayStatus.PLAYING }.keys.toSet()

    /** 切換聲音時，系統可能把另一個網頁播放的格子暫停（R147 實測）。那一格已經靜音，過一下再讓它繼續播。 */
    private fun resumeIfInterrupted(wasPlaying: Set<Int>) {
        val candidates = slots.filterNotNull().filter { usesWebAudio(it) && it.muted && it.id in wasPlaying }.map { it.id }
        if (candidates.isEmpty()) return
        scope.launch {
            delay(900)
            for (id in candidates) {
                if (statuses[id] != PlayStatus.PAUSED) continue
                // 這段時間內被使用者取消靜音的就不管
                if (slots.firstOrNull { it?.id == id }?.muted != true) continue
                players[id]?.play()
            }
        }
    }

    fun setVolume(index: Int, volume: Double) {
        slots = AudioRules.setVolume(slots, index, volume)
        syncAudio()
        scheduleSave()
    }

    fun muteAll() {
        slots = AudioRules.muteAll(slots)
        syncAudio()
        keepControlsVisible()
        scheduleSave()
    }

    private fun syncAudio() {
        for (source in slots.filterNotNull()) {
            val player = players[source.id] ?: continue
            player.setMuted(source.muted)
            player.setVolume(source.volume)
        }
        updateAudioFocus()
        updateBackgroundPlayback()
    }

    // 音訊焦點：被其他 App 的聲音打斷（R152）

    /** App 自己有聲音的網頁格子（WebView 會自己要音訊焦點）。 */
    private fun hasAudibleWebCell(): Boolean = slots.filterNotNull().any {
        usesWebAudio(it) && it.isAudible && statuses[it.id].let { status -> status == PlayStatus.PLAYING || status == PlayStatus.LOADING }
    }

    /**
     * 有原生播放器在播放時替 App 要音訊焦點。有聲音的網頁格子在播放時不要：
     * WebView 會自己要焦點，App 再要一次會讓那個網頁被暫停。
     */
    private fun updateAudioFocus() {
        if (interruptionPaused.isNotEmpty()) return
        val nativePlaying = slots.filterNotNull().any { !usesWebAudio(it) && statuses[it.id] == PlayStatus.PLAYING }
        when {
            hasAudibleWebCell() -> audioFocus.abandon()
            nativePlaying -> audioFocus.request()
            statuses.values.none { it == PlayStatus.PLAYING || it == PlayStatus.LOADING } -> audioFocus.abandon()
        }
    }

    /** 其他 App 開始播放聲音（例如來電）時全部暫停；暫時的打斷結束後，恢復原本在播的格子。 */
    private fun handleFocusLoss(transient: Boolean) {
        // 焦點是被 App 自己的網頁格子拿走的：不算被打斷
        if (hasAudibleWebCell()) {
            audioFocus.abandon()
            return
        }
        // 先記下來再暫停：暫停時狀態會改變，不能因此把焦點放掉（要等焦點還回來）
        interruptionPaused = if (transient) playingSourceIds() else emptySet()
        pauseAll()
    }

    private fun handleFocusGain() {
        val paused = interruptionPaused
        interruptionPaused = emptySet()
        if (!inBackground) paused.forEach { players[it]?.play() }
    }

    private fun pauseAll() {
        players.values.forEach { it.pause() }
    }

    // 畫質、亮度（R153）

    fun supportsQuality(source: CellSource): Boolean = players[source.id]?.supportsQuality ?: false

    fun setQuality(index: Int, quality: Quality) {
        val source = slots.getOrNull(index) ?: return
        slots = SlotRules.set(slots, index, source.copy(quality = quality))
        players[source.id]?.setQuality(quality)
        showToast("畫質：${quality.label}")
        keepControlsVisible()
        scheduleSave()
    }

    /** 字幕選單（R156；規則同桌面版 R31）：track 為 null 是關閉。選的字幕跟著來源保存。 */
    fun setCaption(index: Int, track: CaptionTrack?) {
        val source = slots.getOrNull(index) ?: return
        slots = SlotRules.set(slots, index, source.copy(captions = track?.key))
        players[source.id]?.setCaption(track?.key)
        showToast("字幕：${track?.label ?: "關閉"}")
        keepControlsVisible()
        scheduleSave()
    }

    /** 語音選單（桌面版 R95）：改用這一條聲音軌，並記住它的語言（跟著來源保存）。 */
    fun setAudioTrack(index: Int, option: AudioOption) {
        val source = slots.getOrNull(index) ?: return
        slots = SlotRules.set(slots, index, source.copy(audioLang = option.lang.ifEmpty { null }))
        players[source.id]?.setAudioTrack(option.index)
        showToast("語音：${option.label}")
        keepControlsVisible()
        scheduleSave()
    }

    fun setBrightness(index: Int, value: Int) {
        val source = slots.getOrNull(index) ?: return
        slots = SlotRules.set(slots, index, source.copy(brightness = value.coerceIn(Brightness.MIN, Brightness.MAX)))
        scheduleSave()
    }

    fun changeMasterBrightness(value: Int) {
        masterBrightness = value.coerceIn(Brightness.MIN, Brightness.MAX)
        scheduleSave()
    }

    // 播放（R153）

    fun statusOf(source: CellSource): PlayStatus = statuses[source.id] ?: PlayStatus.LOADING

    fun badgeOf(source: CellSource): String? = players[source.id]?.badge

    fun togglePlay(index: Int) {
        val source = slots.getOrNull(index) ?: return
        val player = players[source.id] ?: return
        if (statusOf(source).showsPause) player.pause() else player.play()
        keepControlsVisible()
    }

    /** 工具列的全部播放／暫停：只要有任何一格在播放就全部暫停，否則全部播放（R8、R9）。 */
    val toggleAllAction: PlaybackRules.ToggleAction
        get() = PlaybackRules.toggleAllAction(slots, displayedLayout, statuses, solo)

    fun toggleAll() {
        val action = toggleAllAction
        for (index in PlaybackRules.controllableIndices(slots, displayedLayout, statuses, solo)) {
            val player = players[slots[index]?.id] ?: continue
            if (action == PlaybackRules.ToggleAction.PLAY) player.play() else player.pause()
        }
        keepControlsVisible()
    }

    fun seek(index: Int, fraction: Double) {
        val source = slots.getOrNull(index) ?: return
        val current = progress[source.id] ?: return
        players[source.id]?.seekTo(ProgressRules.seekTarget(current, fraction))
        keepControlsVisible()
    }

    /** 快轉（正數）或倒轉（負數）。直播和沒有進度條的格子不作用，回傳 false。 */
    fun skip(index: Int, seconds: Double): Boolean {
        val source = slots.getOrNull(index) ?: return false
        val current = progress[source.id] ?: return false
        val target = ProgressRules.skipTarget(current, seconds) ?: return false
        players[source.id]?.seekTo(target)
        return true
    }

    /** 不在目前版型裡的來源暫停（R4 AC3）。回到版型裡時維持暫停。 */
    private fun pauseHiddenSources() {
        slots.forEachIndexed { index, source ->
            if (source != null && !isVisible(index)) players[source.id]?.pause()
        }
    }

    /** 有任何一格在播放：畫面用來決定要不要保持螢幕開啟（R149）。 */
    val anyPlaying: Boolean get() = statuses.values.any { it == PlayStatus.PLAYING }

    // 背景播放、子母畫面（R154）

    /** 顯示中、有聲音、正在播放、可以在背景繼續播的來源（原生播放器）。 */
    private fun backgroundSources(): List<CellSource> = slots.filterIndexed { index, source ->
        source != null && isVisible(index) && source.isAudible && statuses[source.id] == PlayStatus.PLAYING &&
            players[source.id]?.supportsBackground == true
    }.filterNotNull()

    /** 回到主畫面時自動進入子母畫面的格位：只有一格有聲音、而且是原生播放器在播放。 */
    private fun pipCandidate(): Int? {
        val sources = backgroundSources()
        if (sources.size != 1) return null
        // 還有其他有聲音的格子在播放（網頁）時不自動進入
        val audiblePlaying = slots.filterNotNull().count { it.isAudible && statuses[it.id] == PlayStatus.PLAYING }
        return if (audiblePlaying == 1) slots.indexOfFirst { it?.id == sources[0].id } else null
    }

    /** 回到主畫面或關螢幕：原生播放器中有聲音、正在播放的格子繼續播聲音，其他暫停。 */
    fun didEnterBackground() {
        if (inBackground) return
        inBackground = true
        saveNow()
        val keep = backgroundSources().map { it.id }.toSet()
        val paused = mutableSetOf<Int>()
        for (id in playingSourceIds()) {
            if (id in keep) continue
            paused += id
            players[id]?.pause()
        }
        backgroundPaused = paused
        hideControls()
        updateBackgroundPlayback()
    }

    /** 回到 App：因為切到背景而暫停的格子恢復播放。 */
    fun willEnterForeground() {
        if (!inBackground) return
        inBackground = false
        backgroundPaused.forEach { players[it]?.play() }
        backgroundPaused = emptySet()
        remotePaused = emptySet()
        updateBackgroundPlayback()
    }

    /** 操作列的子母畫面按鈕：這一格用子母畫面繼續播。 */
    fun startPictureInPicture(index: Int) {
        val source = slots.getOrNull(index) ?: return
        if (players[source.id]?.supportsBackground != true) return
        pipRequested = index
        if (host?.enterPictureInPicture() != true) {
            pipRequested = null
            showToast("這支裝置不能用子母畫面")
        }
    }

    fun supportsPictureInPicture(source: CellSource): Boolean = players[source.id]?.supportsBackground == true

    /** 進入子母畫面：畫面只顯示那一格，其他格子照切到背景的規則處理。 */
    fun enterPip() {
        val cell = pipRequested ?: pipCandidate() ?: solo ?: slots.indices.firstOrNull { isVisible(it) && slots[it] != null }
        pipRequested = null
        pipCell = cell
        cancelSwap()
        didEnterBackground()
    }

    /**
     * 離開子母畫面。resumed：回到完整的畫面（true），或子母畫面被關掉（false）。
     * 被關掉時全部暫停；下次回到 App 時恢復。
     */
    fun leavePip(resumed: Boolean) {
        pipCell = null
        if (resumed) {
            willEnterForeground()
        } else {
            backgroundPaused = backgroundPaused + playingSourceIds()
            pauseAll()
            updateBackgroundPlayback()
        }
    }

    /** 從通知或鎖定畫面按暫停：記下正在播放的格子，按播放時恢復它們。 */
    fun remotePause() {
        val playing = playingSourceIds()
        if (playing.isNotEmpty()) remotePaused = playing
        pauseAll()
        updateBackgroundPlayback()
    }

    fun remotePlay() {
        val targets = remotePaused.ifEmpty {
            slots.filterIndexed { index, source -> source != null && isVisible(index) && source.isAudible }.mapNotNull { it?.id }.toSet()
        }
        remotePaused = emptySet()
        targets.forEach { players[it]?.play() }
    }

    /** 依目前的播放狀態更新背景播放的服務（通知、鎖定畫面）與自動子母畫面。 */
    private fun updateBackgroundPlayback() {
        val sources = backgroundSources()
        val wanted = sources.isNotEmpty() || (inBackground && remotePaused.isNotEmpty())
        val title = sources.singleOrNull()?.let { titles[it.id] ?: ListRules.defaultName(it.url) } ?: "MultiView"
        PlaybackService.sync(appContext, wanted, title, playing = sources.isNotEmpty())
        host?.setAutoPictureInPicture(!inBackground && pipCandidate() != null)
    }

    // 操作列與工具列（R151）

    fun showControls(index: Int?) {
        activeCell = index
        toolbarVisible = true
        restartHideTimer()
    }

    fun hideControls() {
        hideJob?.cancel()
        activeCell = null
        toolbarVisible = false
    }

    /** 使用者還在操作：重新計算自動隱藏的時間。 */
    fun keepControlsVisible() {
        if (toolbarVisible || activeCell != null) restartHideTimer()
    }

    /** 滑桿、選單等彈出視窗開啟（true）或關閉（false）時呼叫；開著的時候不自動隱藏。 */
    fun holdControls(hold: Boolean) {
        controlsHolds = (controlsHolds + if (hold) 1 else -1).coerceAtLeast(0)
        if (controlsHolds > 0) hideJob?.cancel() else keepControlsVisible()
    }

    private fun restartHideTimer() {
        hideJob?.cancel()
        if (controlsHolds > 0) return
        hideJob = scope.launch {
            delay(CONTROLS_TIMEOUT_MS)
            activeCell = null
            toolbarVisible = false
        }
    }

    fun showToast(message: String) {
        toast = message
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(TOAST_TIMEOUT_MS)
            toast = null
        }
    }

    // 保存（R155）

    private fun scheduleSave() {
        if (saveJob != null) return
        saveJob = scope.launch {
            delay(SAVE_DELAY_MS)
            saveJob = null
            saveNow()
        }
    }

    /** 立刻寫入設定檔。切到背景時也會呼叫（Android 沒有可靠的「關閉程式」時機）。 */
    fun saveNow() {
        saveJob?.cancel()
        saveJob = null

        // 觀看進度：直播、播完、太接近開頭或結尾的不保存（R55）
        val positions = mutableMapOf<Int, Double>()
        slots.forEachIndexed { index, source ->
            if (source == null) return@forEachIndexed
            if (!everPlayed.contains(source.id)) {
                // 開啟 App 之後還沒播放過的來源：保留原本的進度（播放前播放器回報的位置是 0）
                source.resume?.let { positions[index] = it }
            } else {
                ProgressRules.resumePosition(progress[source.id], statuses[source.id] == PlayStatus.ENDED)
                    ?.let { positions[index] = it }
            }
        }

        val settings = baseSettings.copy(
            layout = layout,
            ratios = ratios,
            brightness = masterBrightness,
            youtubeMethods = youtubeMethods,
            webMethod = webMethod,
            listTab = listTab,
            slots = SettingsBridge.saveSlots(slots, positions),
        )
        baseSettings = settings
        try {
            FileStore.saveSettings(settings, settingsFile)
        } catch (_: Exception) {
        }
    }

    private fun now(): Double = System.currentTimeMillis().toDouble()

    companion object {
        /** 操作列與工具列在手指離開後多久隱藏（R151）。 */
        private const val CONTROLS_TIMEOUT_MS = 3000L
        private const val TOAST_TIMEOUT_MS = 3000L

        /** 變更後多久寫入設定檔（R155）。 */
        private const val SAVE_DELAY_MS = 300L
        private const val KEY_METHODS_DEFAULT = "youtubeMethodsDefaultApplied"

        /** 畫質選單的選項（R153）。 */
        val qualityOptions: List<Quality> =
            listOf(Quality.Auto, Quality.Height(1080), Quality.Height(720), Quality.Height(480), Quality.Height(360))
    }
}
