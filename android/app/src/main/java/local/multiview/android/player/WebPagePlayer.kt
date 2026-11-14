package local.multiview.android.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import local.multiview.core.AdBlockEngine
import local.multiview.core.CellSource
import local.multiview.core.ParsedSource
import local.multiview.core.PlayStatus
import local.multiview.core.PlaybackProgress
import local.multiview.core.SourceParser
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** 網頁格子的兩種顯示方式（桌面版 R13、R14）。 */
enum class WebMode(val raw: String) {
    /** 只顯示網頁中的影片：影片填滿格子，點擊由格子攔下。 */
    VIDEO("video"),

    /** 顯示整個網頁：可以點擊、捲動、輸入。 */
    PAGE("page"),
}

/**
 * 網頁格子（桌面版 R12–R17、R57、R113；Android 版 R157）。對照 iOS 版的 WebPagePlayer.swift。
 * 網頁的每一個框架都注入桌面版的偵測程式（android/web/inject.ts），由它找主要影片、只顯示影片、回報播放狀態。
 */
@SuppressLint("SetJavaScriptEnabled")
class WebPagePlayer(
    private val context: Context,
    private val pageUrl: String,
    source: CellSource,
    mode: WebMode,
    private val adblock: Boolean,
    private val interceptYouTube: Boolean,
) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null

    /** 顯示方式改變（找不到影片時自動換成整頁、按「只顯示影片」找到影片時換回來）。 */
    var onModeChange: ((WebMode) -> Unit)? = null

    /** 要顯示給使用者的提示（例如「找不到影片」）。 */
    var onNotice: ((String) -> Unit)? = null

    /** YouTube 網站頁面裡點了影片（桌面版 R57）：這一格換成那部影片。 */
    var onYouTubeVideo: ((String) -> Unit)? = null

    override val supportsVolume = true
    override val usesWebAudio = true

    /** 顯示方式。畫面要跟著更新，所以用 Compose 的狀態保存。 */
    var mode by mutableStateOf(mode)
        private set
    override val isInteractive get() = mode == WebMode.PAGE

    private val handler = Handler(Looper.getMainLooper())
    private val container = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }

    /** 影片模式還沒找到影片時，用黑色蓋住網頁（網頁照常載入、播放，只是看不到）。 */
    private val cover = View(context).apply {
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
    }
    private var webView: WebView = createWebView()
    override val view: View get() = container

    // 送給網頁的狀態（桌面版 WebState）
    private var version = 0
    private var intent = if (source.autoplay) "play" else "pause"
    private var kick = 0
    private var pauseOnStart = false

    // 注入的程式在網頁的執行緒直接讀這些值
    @Volatile
    private var muted = source.muted

    @Volatile
    private var volume = source.volume

    /** 找影片的期間用比較寬的版面排版（R157 的坑 1、2）。 */
    @Volatile
    private var wide = false

    /** 最上層網頁的網域（廣告阻擋比對用；在網路的執行緒讀）。 */
    @Volatile
    private var pageHost: String? = AdBlockEngine.hostOf(pageUrl)

    // 網頁回報的結果
    private var loaded = false

    /** 網頁至少開始顯示過一次。之後網站自己發起的跳轉失敗，原本的網頁還在，不算載入失敗。 */
    private var hasLoaded = false
    private var found = false
    private var failed = false

    /** 目前的錯誤是載入失敗（不是 DRM）：之後網頁回報找到影片，表示網頁其實正常，取消錯誤。 */
    private var loadFailure = false

    /** 網頁程序被系統結束後，已經自動重新載入過一次。 */
    private var reloadedAfterTermination = false
    private var lastProgress: PlaybackProgress? = null
    private var lastStatus: PlayStatus? = null
    private var title: String? = null
    private var closed = false

    /** 上次的觀看進度（R55）：等影片長度大於這個位置才跳過去；30 秒內等不到就放棄。 */
    private var pendingStart: Double? = source.resume
    private var pendingSince = 0L

    private var autoKickDone = false
    private val loadTimeout = Runnable { if (!loaded && !hasLoaded) fail("無法載入網頁（逾時）") }
    private var noVideoPending = false
    private val noVideoTimeout = Runnable {
        noVideoPending = false
        changeMode(WebMode.PAGE)
        onNotice?.invoke("找不到影片，可以在網頁中操作後按「只顯示影片」")
    }
    private var autoKickPending = false
    private val autoKick = Runnable {
        autoKickPending = false
        autoKickDone = true
        if (!found && this.mode == WebMode.VIDEO) updateState { kick++ }
    }
    private var waitingForVideo = false
    private val waitVideoTimeout = Runnable {
        waitingForVideo = false
        if (found) changeMode(WebMode.VIDEO) else onNotice?.invoke("找不到影片")
    }

    init {
        container.addView(cover, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        applyModeToView()
        report(PlayStatus.LOADING)
        startLoadTimer()
        webView.loadUrl(pageUrl)
    }

    // 建立網頁

    private fun createWebView(): WebView {
        val view = WebView(context)
        view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // 網站可以指定版面的寬度（找影片的期間由注入的程式改成 1280），整個網頁縮到剛好放進格子
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            // 網頁要開新視窗一律不開（和桌面版相同）：由 onCreateWindow 拒絕
            setSupportMultipleWindows(true)
            // WebView 預設的 User-Agent 帶有「; wv」，Google 等網站會拒絕登入；改成和 Chrome 相同的寫法
            userAgentString = userAgentString.replace("; wv", "").replace(Regex("""Version/\d+\.\d+ """), "")
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.addJavascriptInterface(Bridge(), BRIDGE)
        // 每一個框架、在網頁自己的程式之前執行
        val script = AdBlocker.injectedScript
        if (script != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?) = false

            override fun onReceivedTitle(view: WebView?, title: String?) {
                this@WebPagePlayer.title = title?.takeIf { it.isNotBlank() }
            }
        }
        view.webViewClient = Client()
        container.addView(view, 0)
        return view
    }

    /** 注入的程式呼叫的介面。這些函式在網頁的執行緒執行，不能碰畫面。 */
    private inner class Bridge {
        @JavascriptInterface
        fun post(message: String) {
            handler.post { handleMessage(message) }
        }

        /** 這個網域要隱藏的元素（元素隱藏規則）。 */
        @JavascriptInterface
        fun cosmetics(host: String): String {
            if (!adblock) return ""
            return try {
                AdBlocker.engine?.cosmeticCss(host).orEmpty()
            } catch (_: Exception) {
                ""
            }
        }

        @JavascriptInterface
        fun muted(): Boolean = muted

        @JavascriptInterface
        fun wide(): Boolean = wide
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            // 只開 http(s) 的網頁；導向其他 App 的連結（intent://、market:// 等）不處理
            val scheme = request?.url?.scheme?.lowercase()
            return scheme != "http" && scheme != "https"
        }

        // 廣告阻擋（R157）：在網路的執行緒執行
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
            if (!adblock || request == null || request.isForMainFrame) return null
            val engine = AdBlocker.engine ?: return null
            val url = request.url?.toString() ?: return null
            if (!url.startsWith("http")) return null
            val page = pageHost
            // 其他網站裡內嵌的 YouTube 播放器發出的請求不擋（桌面版 R17 AC4）
            val referer = request.requestHeaders?.entries?.firstOrNull { it.key.equals("Referer", ignoreCase = true) }?.value
            val refererHost = referer?.let(AdBlockEngine::hostOf)
            if (refererHost != null && isYouTubeEmbedHost(refererHost) && (page == null || !isYouTubeEmbedHost(page))) return null
            val accept = request.requestHeaders?.entries?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }?.value
            val blocked = try {
                engine.shouldBlock(url, page, AdBlockEngine.guessType(url, accept))
            } catch (_: Exception) {
                false
            }
            return if (blocked) WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0))) else null
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            if (closed) return
            url?.let(AdBlockEngine::hostOf)?.let { pageHost = it }
            loaded = false
            handler.removeCallbacks(autoKick)
            autoKickPending = false
            autoKickDone = false
            checkNoVideo()
            startLoadTimer()
        }

        /**
         * 網頁開始顯示就算載入成功。新聞網站常常一直在載入廣告、推薦內容，等不到「載入完成」，
         * 不能用它判斷成功（iOS 0.0.21，news.tvbs.com.tw）。
         */
        override fun onPageCommitVisible(view: WebView?, url: String?) {
            if (closed) return
            handler.removeCallbacks(loadTimeout)
            hasLoaded = true
            loaded = true
            sendState()
            checkNoVideo()
            if (failed) {
                // 換成新的網頁了：之前的錯誤不再適用，重新找影片
                failed = false
                loadFailure = false
                found = false
                updateCover()
                report(PlayStatus.LOADING)
            } else if (!found && lastStatus == PlayStatus.LOADING) {
                report(if (mode == WebMode.PAGE) PlayStatus.PAUSED else PlayStatus.LOADING)
            }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            if (closed) return
            title = view?.title?.takeIf { it.isNotBlank() } ?: title
            sendState()
        }

        override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, response: WebResourceResponse?) {
            // 主文件的 HTTP 狀態碼 400 以上算載入失敗（桌面版 R16 AC2）
            if (closed || hasLoaded || request?.isForMainFrame != true) return
            val code = response?.statusCode ?: return
            if (code >= 400) fail("無法載入網頁（HTTP $code）")
        }

        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
            if (closed || request?.isForMainFrame != true) return
            // 已經顯示過網頁：網站之後的跳轉失敗不影響目前的網頁
            if (hasLoaded) {
                loaded = true
                return
            }
            fail("無法載入網頁：${error?.description ?: "未知的錯誤"}")
        }

        /** 網頁程序被系統結束（通常是記憶體不足）：這個 WebView 不能再用，換一個新的重新載入一次；還是不行才顯示錯誤。 */
        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            if (closed) return true
            val current = webView
            container.removeView(current)
            current.destroy()
            webView = createWebView()
            applyModeToView()
            if (reloadedAfterTermination) {
                fail("網頁停止運作")
            } else {
                reloadedAfterTermination = true
                found = false
                updateCover()
                report(PlayStatus.LOADING)
                startLoadTimer()
                webView.loadUrl(pageUrl)
            }
            return true
        }
    }

    // CellPlayer

    override fun play() = updateState { intent = "play" }

    override fun pause() = updateState { intent = "pause" }

    override fun setMuted(muted: Boolean) {
        if (this.muted == muted) return
        updateState { this.muted = muted }
        // 馬上套用，不等注入的程式下一次定時檢查
        evaluate("document.dispatchEvent(new Event('play'))")
    }

    override fun setVolume(volume: Int) {
        if (this.volume == volume) return
        updateState { this.volume = volume }
    }

    override fun seekTo(seconds: Double) {
        if (seconds.isFinite()) send("mv:seek", seconds)
    }

    override fun shutdown() {
        if (closed) return
        closed = true
        handler.removeCallbacksAndMessages(null)
        onUpdate = null
        onModeChange = null
        onNotice = null
        onYouTubeVideo = null
        webView.stopLoading()
        webView.removeJavascriptInterface(BRIDGE)
        container.removeAllViews()
        webView.destroy()
    }

    // 顯示方式（R13、R14）

    /** 由 App 切換顯示方式。 */
    fun changeModeByUser(next: WebMode) {
        if (mode == next) return
        mode = next
        applyModeToView()
        updateState { }
        checkNoVideo()
    }

    /** 「只顯示影片」：找得到影片就切換；找不到時先按一次網站的播放鈕，等一下再找（桌面版 R14 AC2、R113）。 */
    fun requestVideoMode() {
        if (found) {
            changeMode(WebMode.VIDEO)
            return
        }
        onNotice?.invoke("正在找影片…")
        updateState { kick++ }
        handler.removeCallbacks(waitVideoTimeout)
        waitingForVideo = true
        handler.postDelayed(waitVideoTimeout, KICK_WAIT_MS)
    }

    val canGoBack: Boolean get() = !closed && webView.canGoBack()

    fun goBack() {
        if (canGoBack) webView.goBack()
    }

    private fun changeMode(next: WebMode) {
        if (mode == next) return
        changeModeByUser(next)
        onModeChange?.invoke(next)
    }

    /**
     * 影片模式還沒找到影片時，用黑色蓋住網頁，不會先看到縮小的整個網頁（iOS 0.0.20）。
     * 寬版面只在找影片的期間使用：找到影片後恢復原本的大小，否則影片只露出一半（iOS 0.0.22）。
     */
    private fun updateCover() {
        val searching = mode == WebMode.VIDEO && !found && !failed
        cover.visibility = if (searching) View.VISIBLE else View.GONE
        if (wide != searching) {
            wide = searching
            evaluate("window.__multiViewViewport && window.__multiViewViewport($searching)")
        }
    }

    private fun applyModeToView() {
        updateCover()
        // 整頁模式：網頁照原本的樣子，可以捲動、縮放；影片模式：點擊由格子攔下
        val page = mode == WebMode.PAGE
        webView.setBackgroundColor(if (page) Color.WHITE else Color.BLACK)
        webView.isVerticalScrollBarEnabled = page
        webView.isHorizontalScrollBarEnabled = page
    }

    // 和網頁之間的狀態

    private fun updateState(change: () -> Unit) {
        if (closed) return
        change()
        version++
        sendState()
    }

    private fun sendState() {
        val state = JSONObject()
            .put("v", version)
            .put("mode", mode.raw)
            .put("intent", intent)
            .put("volume", volume)
            .put("muted", muted)
            .put("interceptYouTube", interceptYouTube)
            .put("kick", kick)
            .put("pauseOnStart", pauseOnStart)
        send("mv:state", state)
    }

    private fun send(channel: String, value: Any) {
        val json = JSONArray().put(value).toString()
        evaluate("window.__multiViewReceive && window.__multiViewReceive('$channel', $json[0])")
    }

    private fun evaluate(script: String) {
        if (!closed) webView.evaluateJavascript("$script; void 0", null)
    }

    private fun handleMessage(message: String) {
        if (closed) return
        val body = try {
            JSONObject(message)
        } catch (_: Exception) {
            return
        }
        val args = body.optJSONArray("args")
        when (body.optString("channel")) {
            "mv:hello" -> {
                sendState()
                // 新的網頁：還在找影片時繼續用寬版面
                if (wide) evaluate("window.__multiViewViewport && window.__multiViewViewport(true)")
            }
            "mv:startPaused" -> updateState {
                pauseOnStart = false
                intent = "pause"
            }
            "mv:report" -> args?.optJSONObject(0)?.let(::handleReport)
            "mv:ytvideo" -> args?.optString(0)?.let { href ->
                if (SourceParser.parse(href) is ParsedSource.YouTube) onYouTubeVideo?.invoke(href)
            }
        }
    }

    private fun handleReport(data: JSONObject) {
        if (data.optBoolean("drm")) {
            fail("這個影片有版權保護，無法播放", load = false)
            return
        }
        // 顯示「無法載入網頁」之後，網頁還在回報影片：網頁其實正常，取消錯誤
        if (failed && loadFailure && data.optBoolean("found")) {
            failed = false
            loadFailure = false
        }
        if (failed) return
        found = data.optBoolean("found")
        updateCover()
        val status = data.optString("status")
        val reportVersion = data.optInt("v", -1)

        if (found && waitingForVideo) {
            handler.removeCallbacks(waitVideoTimeout)
            waitingForVideo = false
            changeMode(WebMode.VIDEO)
        }

        val progress = data.optJSONObject("progress")?.let(::parseProgress)
        lastProgress = progress
        // 上次的觀看進度：等影片長度大於那個位置才跳過去（R55）
        val start = pendingStart
        if (start != null && progress != null) {
            if (pendingSince == 0L) pendingSince = SystemClock.elapsedRealtime()
            when {
                progress.live -> pendingStart = null
                start < progress.end -> {
                    pendingStart = null
                    send("mv:seek", start)
                }
                SystemClock.elapsedRealtime() - pendingSince > PENDING_START_TIMEOUT_MS -> pendingStart = null
            }
        }
        checkNoVideo()

        report(
            when (status) {
                "playing" -> PlayStatus.PLAYING
                "paused" -> PlayStatus.PAUSED
                "ended" -> PlayStatus.ENDED
                // 影片模式還在找影片：顯示讀取動畫；整頁模式沒有影片時當作暫停
                else -> if (mode == WebMode.VIDEO || !loaded) PlayStatus.LOADING else PlayStatus.PAUSED
            },
        )

        // 整頁模式中使用者直接按網站的播放／暫停，也算播放意圖（桌面版 R15 AC7）
        if (mode == WebMode.PAGE && reportVersion == version) {
            if (status == "playing" && intent == "pause") {
                updateState { intent = "play" }
            } else if (status == "paused" && intent == "play") {
                updateState { intent = "pause" }
            }
        }
    }

    private fun parseProgress(raw: JSONObject): PlaybackProgress? {
        val current = raw.optDouble("current")
        val start = raw.optDouble("start")
        val end = raw.optDouble("end")
        if (current.isNaN() || start.isNaN() || end.isNaN()) return null
        return PlaybackProgress(current, start, end, raw.optBoolean("live"))
    }

    private fun report(status: PlayStatus) {
        lastStatus = status
        // 跳到上次的位置之前不回報進度，存檔時保留原本的位置（R55）
        val progress = if (pendingStart == null) lastProgress else null
        onUpdate?.invoke(PlayerUpdate(status, progress, title = title))
    }

    private fun fail(message: String, load: Boolean = true) {
        if (failed || closed) return
        failed = true
        loadFailure = load
        updateCover()
        cancelTimers()
        updateState { intent = "pause" }
        onUpdate?.invoke(PlayerUpdate(PlayStatus.ERROR, null, title = title, errorMessage = message))
    }

    // 找不到影片（R13 AC4、R113）

    private fun checkNoVideo() {
        val waiting = mode == WebMode.VIDEO && loaded && !found && !failed
        if (!waiting) {
            handler.removeCallbacks(noVideoTimeout)
            noVideoPending = false
            return
        }
        // 網頁載入後幾秒還找不到影片，自動按一次網站的播放鈕
        if (!autoKickDone && !autoKickPending) {
            autoKickPending = true
            handler.postDelayed(autoKick, AUTO_KICK_DELAY_MS)
        }
        if (!noVideoPending) {
            noVideoPending = true
            handler.postDelayed(noVideoTimeout, NO_VIDEO_TIMEOUT_MS)
        }
    }

    private fun startLoadTimer() {
        handler.removeCallbacks(loadTimeout)
        handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS)
    }

    private fun cancelTimers() {
        handler.removeCallbacks(loadTimeout)
        handler.removeCallbacks(noVideoTimeout)
        handler.removeCallbacks(autoKick)
        handler.removeCallbacks(waitVideoTimeout)
        noVideoPending = false
        autoKickPending = false
        waitingForVideo = false
    }

    private companion object {
        const val BRIDGE = "MultiViewAndroid"

        /** 從開始載入算起，這麼久還沒開始顯示就算失敗（桌面版 R16）。 */
        const val LOAD_TIMEOUT_MS = 30_000L

        /** 網頁載入後找不到主要影片多久就切換成整頁模式（桌面版 R13 AC4）。 */
        const val NO_VIDEO_TIMEOUT_MS = 15_000L

        /** 影片模式、網頁載入後這麼久還找不到影片，自動按一次網站的播放鈕（桌面版 R113）。 */
        const val AUTO_KICK_DELAY_MS = 3_000L

        /** 按「只顯示影片」時自動按播放後，最多等這麼久找影片（桌面版 R113）。 */
        const val KICK_WAIT_MS = 6_000L
        const val PENDING_START_TIMEOUT_MS = 30_000L

        fun isYouTubeEmbedHost(host: String): Boolean =
            listOf("youtube.com", "youtube-nocookie.com").any { host == it || host.endsWith(".$it") }
    }
}
