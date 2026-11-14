package local.multiview.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
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
import local.multiview.android.player.SimpleWebPlayer
import local.multiview.android.player.YouTubeSourcePlayer
import local.multiview.core.AudioRules
import local.multiview.core.Brightness
import local.multiview.core.CellSource
import local.multiview.core.ExternalLink
import local.multiview.core.FileStore
import local.multiview.core.LayoutId
import local.multiview.core.LayoutMath
import local.multiview.core.ListError
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
import local.multiview.core.YouTubeMethods
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

    /** 沒有空格：等使用者選擇要取代哪一格（R150）。 */
    var pendingReplaceUrl by mutableStateOf<String?>(null)

    /** 畫面方向被固定了（工具列的旋轉按鈕）；圖示跟著改變。 */
    var orientationLocked by mutableStateOf(false)
        private set

    /** `2` 版型是不是上下排列（小螢幕直向）；版型圖示跟著畫。 */
    var gridStacked by mutableStateOf(false)
        private set

    // 內部

    private val scope = MainScope()
    private val players = mutableMapOf<Int, CellPlayer>()
    private val titles = mutableMapOf<Int, String>()

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
        // 還原的來源載入後維持暫停（R10 AC1）
        slots = SettingsBridge.restoreSlots(settings.slots)

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

    /** 工具列的旋轉按鈕：轉成另一個方向並固定（關了自動旋轉也可以轉）；再按一次轉回來。 */
    fun rotate() {
        val host = host ?: return
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
            player.onFallback = { showToast("yt-dlp 無法播放，已改用內嵌播放器") }
        }
        is ParsedSource.Hls -> NativePlayer(context, parsed.url, source, adaptive = true)
        is ParsedSource.Mp4 -> NativePlayer(context, parsed.url, source, adaptive = false)
        is ParsedSource.Web -> SimpleWebPlayer(context, parsed.url, source)
    }

    private fun releasePlayer(id: Int) {
        players.remove(id)?.shutdown()
        statuses.remove(id)
        progress.remove(id)
        errors.remove(id)
        titles.remove(id)
        everPlayed.remove(id)
        updateAudioFocus()
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
        if (statuses[id] != update.status) {
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

    /** 目前顯示中、可以被取代的格位。 */
    val visibleSlotIndices: List<Int> get() = slots.indices.filter(::isVisible)

    fun replaceSlot(index: Int, url: String) {
        setSource(url, index)?.let(::showToast)
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

    // 切到背景（背景播放是 R154，之後的版本；目前切到背景時全部暫停，回來時恢復）

    fun didEnterBackground() {
        if (inBackground) return
        inBackground = true
        saveNow()
        backgroundPaused = playingSourceIds()
        pauseAll()
    }

    fun willEnterForeground() {
        if (!inBackground) return
        inBackground = false
        backgroundPaused.forEach { players[it]?.play() }
        backgroundPaused = emptySet()
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
