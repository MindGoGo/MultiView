package local.multiview.android.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.delay
import local.multiview.android.AppModel
import local.multiview.core.CompanionRules
import local.multiview.core.CompanionTab
import local.multiview.core.ParsedSource
import local.multiview.core.SourceParser
import org.json.JSONObject

/**
 * YouTube 小視窗（桌面版 R78–R83；Android 版 R158）：搜尋、推薦影片、留言、聊天室。對照 iOS 版的 CompanionPanel.swift。
 * 內容跟著最後點過的 YouTube 格子。面板裡的網頁不播放影片，不會搶走格子的聲音。
 * 例外是搜尋分頁選了「在這裡看」（R162）：點影片時網頁照常換頁、播放，開始播放時格子暫停，關掉小視窗時恢復。
 */
@Composable
fun CompanionPanel(
    model: AppModel,
    insets: PaddingValues,
    modifier: Modifier = Modifier,
    /**
     * 面板是不是開著。關掉時面板只是移到畫面外，裡面的網頁留著：再打開時不用重新載入，
     * 也不會先看到黑色的畫面（0.0.12 實測：每次打開都重新建立網頁，整個畫面先黑一下）。
     * 關著的時候不載入新的網頁。
     */
    open: Boolean = true,
) {
    val videoId = model.companionVideoId
    val tab = model.companionTab
    // 聊天室要到那個分頁才載入；同一部影片載入過就留著，切換分頁時不重新載入
    var chatVideo by remember { mutableStateOf<String?>(null) }
    if (open && tab == CompanionTab.CHAT && videoId != null && chatVideo != videoId) chatVideo = videoId

    // 搜尋分頁的網頁：上一頁、放進格子、暫停影片要用到（R162）
    val context = LocalContext.current
    val search = remember {
        CompanionWebHolder(context, CompanionPage.SEARCH, onMediaStarted = { model.companionMediaStarted() }) { href ->
            model.companionOpenVideo(href, replaceLinkedCell = false)
        }
    }
    DisposableEffect(search) {
        val browser = object : AppModel.CompanionBrowser {
            override fun pauseMedia() = search.pauseMedia()
            override fun goBack() = search.goBack()
        }
        model.companionBrowser = browser
        onDispose { if (model.companionBrowser === browser) model.companionBrowser = null }
    }

    // 在這裡看（R162）：上方的標題、分頁像格子的工具列一樣，過幾秒自動隱藏，點上方的小把手再叫出來
    val browsing = model.companionBrowse && tab == CompanionTab.SEARCH
    var headerShown by remember { mutableStateOf(true) }
    var headerTouches by remember { mutableIntStateOf(0) }
    if (!browsing && !headerShown) headerShown = true
    LaunchedEffect(browsing, headerShown, headerTouches, open) {
        if (browsing && headerShown && open) {
            delay(HEADER_TIMEOUT_MS)
            headerShown = false
        }
    }
    // 按了上方的按鈕：重新計算自動隱藏的時間
    fun touched(action: () -> Unit): () -> Unit = {
        headerTouches++
        action()
    }
    val currentVideo = search.currentUrl.takeIf { SourceParser.parse(it) is ParsedSource.YouTube }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .background(Color(0xF216161A))
            // 面板上的點擊不要傳到下面的影片
            .pointerInput(Unit) { detectTapGestures { } }
            .padding(insets),
    ) {
        if (headerShown) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (browsing && search.canGoBack) {
                        BarButton(AppIcons.ArrowBack, "上一頁", onClick = touched { search.goBack() })
                    }
                    Text(
                        if (browsing) "在小視窗裡看" else CompanionRules.header(model.companionCell, model.companionTitle),
                        color = Color.White,
                        fontSize = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    // 在這裡看的是一部影片：放進格子
                    if (browsing && currentVideo != null) {
                        BarButton(AppIcons.SendToGrid, "放進格子", onClick = touched { model.companionPushCurrent(currentVideo) })
                    }
                    // 搜尋分頁點影片的方式：圖示是目前的方式，按一下切換（R162）
                    if (tab == CompanionTab.SEARCH) {
                        BarButton(
                            if (model.companionBrowse) AppIcons.WatchHere else AppIcons.SendToGrid,
                            if (model.companionBrowse) "點影片：在這裡看（按一下改成放進格子）" else "點影片：放進格子（按一下改成在這裡看）",
                            highlighted = model.companionBrowse,
                            onClick = touched {
                                model.changeCompanionBrowse(!model.companionBrowse)
                                model.showToast(if (model.companionBrowse) "點影片：在小視窗裡看" else "點影片：放進格子")
                            },
                        )
                    }
                    BarButton(AppIcons.Close, "關閉 YouTube 小視窗") { model.closeCompanion() }
                }
                Segmented(CompanionTab.entries.map { it to it.label }, tab) {
                    headerTouches++
                    model.selectCompanionTab(it)
                }
            }
        } else {
            // 小把手：叫出上方的標題與分頁
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClickLabel = "顯示小視窗的工具列") { headerShown = true }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(modifier = Modifier.size(width = 44.dp, height = 5.dp).background(Color.White.copy(alpha = 0.35f), CircleShape))
            }
        }

        Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0F0F0F)), contentAlignment = Alignment.Center) {
            // 網頁還沒顯示出來時看到的是這行字，不是黑色的畫面
            Text("載入中…", color = Color.White.copy(alpha = 0.5f), fontSize = 14.sp)
            // 每個分頁各自一個網頁，切換分頁時保留原本的內容
            CompanionWeb(search, null, null, visible = tab == CompanionTab.SEARCH, active = open, browse = model.companionBrowse)
            if (videoId != null) {
                val watchVisible = tab == CompanionTab.RELATED || tab == CompanionTab.COMMENTS
                val watch = rememberCompanionWeb(CompanionPage.WATCH) { href -> model.companionOpenVideo(href, replaceLinkedCell = true) }
                CompanionWeb(
                    watch,
                    videoId,
                    if (tab == CompanionTab.COMMENTS) "comments" else "related",
                    visible = watchVisible,
                    active = open,
                )
                if (chatVideo == videoId) {
                    val chat = rememberCompanionWeb(CompanionPage.CHAT) { }
                    CompanionWeb(chat, videoId, null, visible = tab == CompanionTab.CHAT, active = open)
                }
            } else if (tab != CompanionTab.SEARCH) {
                Text(
                    "先點一下 YouTube 的格子",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 14.sp,
                    modifier = Modifier.fillMaxSize().background(Color(0xFF0F0F0F)).padding(top = 48.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}

private enum class CompanionPage { SEARCH, WATCH, CHAT }

private const val BRIDGE = "MultiViewCompanion"

/** 在這裡看（R162）時，上方的標題與分頁自動隱藏的時間（和格子的工具列相同）。 */
private const val HEADER_TIMEOUT_MS = 3000L

/** 建立小視窗裡的一個網頁（推薦／留言、聊天室）。 */
@Composable
private fun rememberCompanionWeb(page: CompanionPage, onVideo: (String) -> Unit): CompanionWebHolder {
    val context = LocalContext.current
    val currentOnVideo = rememberUpdatedState(onVideo)
    return remember(page) { CompanionWebHolder(context, page) { currentOnVideo.value(it) } }
}

/** 小視窗裡的一個網頁。 */
@Composable
private fun CompanionWeb(
    holder: CompanionWebHolder,
    videoId: String?,
    section: String?,
    visible: Boolean,
    /** 面板開著：關著的時候不載入新的網頁（連結的影片換了，等打開面板才載入）。 */
    active: Boolean,
    /** 搜尋分頁點影片時在這裡看（R162），不交給 App。 */
    browse: Boolean = false,
) {
    DisposableEffect(holder) { onDispose { holder.destroy() } }
    val page = holder.page

    val address = when (page) {
        CompanionPage.SEARCH -> CompanionRules.MOBILE_HOME
        CompanionPage.WATCH -> videoId?.let(CompanionRules::watchPageUrl).orEmpty()
        CompanionPage.CHAT -> videoId?.let(CompanionRules::liveChatUrl).orEmpty()
    }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { holder.webView },
        update = {
            // 看不到的分頁藏起來（網頁留著，不重新排版）
            holder.visible = visible
            holder.browse = browse
            if (active) holder.show(address, section)
        },
    )
}

/** 小視窗的網頁與它的狀態。 */
@SuppressLint("SetJavaScriptEnabled")
private class CompanionWebHolder(
    context: Context,
    val page: CompanionPage,
    /** 在這裡看（R162）：網頁開始播放有聲音的影片。 */
    private val onMediaStarted: () -> Unit = {},
    private val onVideo: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var loaded = ""
    private var section: String? = null
    private var destroyed = false

    /** 網頁已經開始顯示內容。還沒顯示時把網頁藏起來，看到的是後面的「載入中…」，不是黑色的畫面。 */
    private var painted = false

    /** 網頁目前的網址（包括網頁自己換頁，例如 YouTube 手機版不重新載入的換頁）與能不能回上一頁（R162）。 */
    var currentUrl by mutableStateOf("")
        private set
    var canGoBack by mutableStateOf(false)
        private set

    /** 點影片時在這裡看，不交給 App（R162）。 */
    var browse = false
        set(value) {
            if (field == value) return
            field = value
            applyBrowse()
        }

    /** 這個分頁是不是目前的分頁。 */
    var visible = true
        set(value) {
            field = value
            updateVisibility()
        }

    private fun updateVisibility() {
        if (destroyed) return
        webView.visibility = if (visible) android.view.View.VISIBLE else android.view.View.INVISIBLE
        // 還沒顯示內容時用透明的（不能藏起來：藏起來的網頁可能不會回報「開始顯示」）
        webView.alpha = if (painted) 1f else 0f
    }

    val webView = WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        // 和面板相同的深灰色：網頁載入前不會先閃一下黑色
        setBackgroundColor(AndroidColor.rgb(0x0F, 0x0F, 0x0F))
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // 面板裡的網頁不自動播放影片：不出聲，也不會讓系統暫停格子裡的影片
        settings.mediaPlaybackRequiresUserGesture = true
        settings.setSupportMultipleWindows(true)
        val base = settings.userAgentString.replace("; wv", "").replace(Regex("""Version/\d+\.\d+ """), "")
        // 搜尋用手機版的 YouTube；推薦、留言、聊天室用桌面版的網頁（樣式是針對桌面版寫的）
        settings.userAgentString = if (page == CompanionPage.SEARCH) base else CompanionRules.DESKTOP_USER_AGENT
        // 版面的寬度由網頁的 viewport 決定，整個網頁縮到剛好放進面板。
        // 推薦、留言（桌面版的網頁）由注入的程式把 viewport 設成 480 寬（和桌面版 MultiView 的小視窗相同）：
        // 直接用面板的寬度（手機約 400）排版時內容排不下，要左右滑（0.0.10、0.0.12 實測）
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        addJavascriptInterface(Bridge(), BRIDGE)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(this, SCRIPT, setOf("*"))
        }
        webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?) = false
        }
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val scheme = request?.url?.scheme?.lowercase()
                return scheme != "http" && scheme != "https"
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                currentUrl = url.orEmpty()
                canGoBack = view?.canGoBack() ?: false
            }

            override fun onPageCommitVisible(view: WebView?, url: String?) {
                painted = true
                updateVisibility()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // 沒有收到「開始顯示」時，載入完成也算
                painted = true
                updateVisibility()
                // 比較舊的 WebView 不能在網頁開始時注入：載入完成後補上
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view?.evaluateJavascript(SCRIPT, null)
                }
                applySection()
            }
        }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun post(message: String) {
            main.post { handle(message) }
        }
    }

    /** 顯示這個網址；只顯示推薦區或留言區（R79、R80）。換了影片才重新載入。 */
    fun show(address: String, nextSection: String?) {
        if (destroyed) return
        if (section != nextSection) {
            section = nextSection
            applySection()
        }
        if (loaded != address && address.isNotEmpty()) {
            loaded = address
            // 換了影片：新的網頁顯示出來之前先藏起來
            painted = false
            updateVisibility()
            webView.loadUrl(address)
        }
    }

    /** 暫停網頁裡的影片（R162）。 */
    fun pauseMedia() {
        if (destroyed) return
        webView.evaluateJavascript("document.querySelectorAll('video').forEach(function (v) { v.pause(); }); void 0", null)
    }

    /** 回上一頁；沒有上一頁時回傳 false。 */
    fun goBack(): Boolean {
        if (destroyed || !webView.canGoBack()) return false
        webView.goBack()
        return true
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        webView.stopLoading()
        webView.removeJavascriptInterface(BRIDGE)
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    private fun applyBrowse() {
        if (destroyed) return
        webView.evaluateJavascript("window.__multiViewBrowse = $browse; void 0", null)
    }

    private fun applySection() {
        if (destroyed) return
        val argument = section?.let { "'$it'" } ?: "null"
        webView.evaluateJavascript(
            "window.__multiViewSection = $argument; window.__multiViewApply && window.__multiViewApply(); void 0",
            null,
        )
    }

    private fun handle(message: String) {
        if (destroyed) return
        val body = try {
            JSONObject(message)
        } catch (_: Exception) {
            return
        }
        when (body.optString("type")) {
            // 網頁（重新）載入：告訴它現在要顯示哪一區
            "ready" -> {
                applySection()
                applyBrowse()
            }
            // 在這裡看的影片開始播放（R162）
            "playing" -> if (browse) onMediaStarted()
            "video" -> {
                val href = body.optString("href")
                when {
                    SourceParser.parse(href) is ParsedSource.YouTube -> onVideo(href)
                    // 不是單一影片（頻道、播放清單、Shorts）：照常換頁
                    href.startsWith("http") -> webView.loadUrl(href)
                }
            }
        }
    }

    private companion object {
        /**
         * 注入網頁的程式：攔下影片連結的點擊；只顯示推薦區或留言區；影片一開始播放就暫停。
         * 和 iOS 版 CompanionPanel.swift 裡的相同，只把送訊息的方式換成 addJavascriptInterface。
         */
        val SCRIPT = """
        (function () {
          if (window !== window.top || window.__multiViewInstalled) return;
          window.__multiViewInstalled = true;
          function post(message) { try { $BRIDGE.post(JSON.stringify(message)); } catch (e) {} }

          // 影片連結：不讓網頁換頁，交給 App 處理。在這裡看（R162，只有 Android 版）時照常換頁
          document.addEventListener('click', function (event) {
            if (window.__multiViewBrowse) return;
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!link) return;
            var href = link.href || '';
            if (!/^https?:\/\/([a-z]+\.)?(youtube\.com\/(watch|live\/|shorts\/|embed\/)|youtu\.be\/)/.test(href)) return;
            event.preventDefault();
            event.stopPropagation();
            post({ type: 'video', href: href });
          }, true);

          var SELECTORS = { related: 'ytd-watch-flexy #related', comments: 'ytd-watch-flexy #comments' };
          var PANE = 'position: fixed !important; inset: 0 !important; width: auto !important; min-width: 0 !important;' +
            'max-width: none !important; height: auto !important; margin: 0 !important; padding: 12px 16px !important;' +
            'box-sizing: border-box !important; overflow-y: auto !important; z-index: 2147483647 !important;' +
            'display: block !important; background: #fff !important;';
          function css(active) {
            var both = SELECTORS.related + ', ' + SELECTORS.comments;
            var inactive = SELECTORS[active === 'related' ? 'comments' : 'related'];
            return 'html:has(' + SELECTORS[active] + '), html:has(' + SELECTORS[active] + ') body { overflow: hidden !important; }' +
              both + ' { ' + PANE + ' }' +
              'html[dark] :is(' + both + ') { background: #0f0f0f !important; }' +
              SELECTORS[active] + ' { visibility: visible !important; }' +
              inactive + ' { visibility: hidden !important; pointer-events: none !important; }' +
              both + ' { overflow-x: hidden !important; overflow-wrap: anywhere !important; }' +
              'html:has(' + SELECTORS[active] + ') #masthead-container { display: none !important; }' +
              'body { visibility: hidden !important; }' +
              'html { background: #fff !important; }' +
              'html[dark] { background: #0f0f0f !important; }';
          }
          // 版面的寬度：影片頁（推薦、留言）用 480，和桌面版 MultiView 的小視窗相同；聊天室用面板的寬度
          var VIEWPORT = location.pathname === '/watch' ? 'width=480' : (location.pathname.indexOf('/live_chat') === 0 ? 'width=device-width, initial-scale=1' : null);
          function applyViewport() {
            if (!VIEWPORT || !document.head) return;
            var meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
              meta = document.createElement('meta');
              meta.name = 'viewport';
              document.head.appendChild(meta);
            }
            if (meta.content !== VIEWPORT) meta.content = VIEWPORT;
          }
          if (VIEWPORT) {
            applyViewport();
            new MutationObserver(applyViewport).observe(document.documentElement || document, { childList: true, subtree: false });
            document.addEventListener('DOMContentLoaded', applyViewport);
          }
          var style = null;
          window.__multiViewApply = function () {
            var section = window.__multiViewSection;
            if (!section) {
              if (style) { style.remove(); style = null; }
              return;
            }
            if (!document.documentElement) return;
            if (!style) style = document.createElement('style');
            style.textContent = css(section);
            if (!style.isConnected) document.documentElement.appendChild(style);
            document.querySelectorAll('video').forEach(function (video) {
              video.muted = true;
              if (!video.paused) video.pause();
            });
          };
          // 只顯示某一區時，影片（包括廣告）一開始播放就暫停
          window.addEventListener('play', function (event) {
            var video = event.target;
            if (!window.__multiViewSection || !video || video.tagName !== 'VIDEO') return;
            video.muted = true;
            video.pause();
          }, true);
          // 在這裡看（R162）：有聲音的影片開始播放時告訴 App（搜尋結果裡靜音的預覽不算）
          function audible(event) {
            var video = event.target;
            if (!window.__multiViewBrowse || !video || video.tagName !== 'VIDEO' || video.muted || video.paused) return;
            post({ type: 'playing' });
          }
          window.addEventListener('playing', audible, true);
          // 靜音開始播放、之後才打開聲音
          window.addEventListener('volumechange', audible, true);
          document.addEventListener('DOMContentLoaded', function () { window.__multiViewApply(); });
          post({ type: 'ready' });
        })();
        """.trimIndent()
    }
}
