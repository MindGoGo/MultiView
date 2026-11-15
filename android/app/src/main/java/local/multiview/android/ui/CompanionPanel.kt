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
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
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
import local.multiview.android.AppModel
import local.multiview.core.CompanionRules
import local.multiview.core.CompanionTab
import local.multiview.core.ParsedSource
import local.multiview.core.SourceParser
import org.json.JSONObject

/**
 * YouTube 小視窗（桌面版 R78–R83；Android 版 R158）：搜尋、推薦影片、留言、聊天室。對照 iOS 版的 CompanionPanel.swift。
 * 內容跟著最後點過的 YouTube 格子。面板裡的網頁不播放影片，不會搶走格子的聲音。
 */
@Composable
fun CompanionPanel(model: AppModel, insets: PaddingValues, modifier: Modifier = Modifier) {
    val videoId = model.companionVideoId
    val tab = model.companionTab

    Column(
        modifier = modifier
            .fillMaxHeight()
            .background(Color(0xF216161A))
            // 面板上的點擊不要傳到下面的影片
            .pointerInput(Unit) { detectTapGestures { } }
            .padding(insets),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    CompanionRules.header(model.companionCell, model.companionTitle),
                    color = Color.White,
                    fontSize = 13.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                BarButton(AppIcons.Close, "關閉 YouTube 小視窗") { model.closeCompanion() }
            }
            Segmented(CompanionTab.entries.map { it to it.label }, tab) { model.companionTab = it }
        }

        Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0F0F0F)), contentAlignment = Alignment.Center) {
            // 每個分頁各自一個網頁，切換分頁時保留原本的內容。看不到的分頁縮到畫面外，不擋住點擊
            CompanionWeb(CompanionPage.SEARCH, null, null, visible = tab == CompanionTab.SEARCH) { href ->
                model.companionOpenVideo(href, replaceLinkedCell = false)
            }
            if (videoId != null) {
                val watchVisible = tab == CompanionTab.RELATED || tab == CompanionTab.COMMENTS
                CompanionWeb(
                    CompanionPage.WATCH,
                    videoId,
                    if (tab == CompanionTab.COMMENTS) "comments" else "related",
                    visible = watchVisible,
                ) { href -> model.companionOpenVideo(href, replaceLinkedCell = true) }
                // 聊天室要到那個分頁才載入
                if (tab == CompanionTab.CHAT) CompanionWeb(CompanionPage.CHAT, videoId, null, visible = true) { }
            } else if (tab != CompanionTab.SEARCH) {
                Text("先點一下 YouTube 的格子", color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp)
            }
        }
    }
}

private enum class CompanionPage { SEARCH, WATCH, CHAT }

private const val BRIDGE = "MultiViewCompanion"

/** 小視窗裡的一個網頁。 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CompanionWeb(page: CompanionPage, videoId: String?, section: String?, visible: Boolean, onVideo: (String) -> Unit) {
    val context = LocalContext.current
    val currentOnVideo = rememberUpdatedState(onVideo)
    val holder = remember(page) { CompanionWebHolder(context, page) { currentOnVideo.value(it) } }
    DisposableEffect(holder) { onDispose { holder.destroy() } }

    val address = when (page) {
        CompanionPage.SEARCH -> CompanionRules.MOBILE_HOME
        CompanionPage.WATCH -> videoId?.let(CompanionRules::watchPageUrl).orEmpty()
        CompanionPage.CHAT -> videoId?.let(CompanionRules::liveChatUrl).orEmpty()
    }
    AndroidView(
        // 看不到的分頁：透明而且不收點擊（縮成 0 會讓網頁重新排版，所以只改透明度）
        modifier = Modifier.fillMaxSize().alpha(if (visible) 1f else 0f),
        factory = { holder.webView },
        update = { view ->
            view.visibility = if (visible) android.view.View.VISIBLE else android.view.View.INVISIBLE
            holder.show(address, section)
        },
    )
}

/** 小視窗的網頁與它的狀態。 */
@SuppressLint("SetJavaScriptEnabled")
private class CompanionWebHolder(context: Context, page: CompanionPage, private val onVideo: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var loaded = ""
    private var section: String? = null
    private var destroyed = false

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
        // 版面的寬度就是面板的寬度（桌面版的網頁不要縮成整頁的縮圖）
        settings.useWideViewPort = page == CompanionPage.SEARCH
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

            override fun onPageFinished(view: WebView?, url: String?) {
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
            webView.loadUrl(address)
        }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        webView.stopLoading()
        webView.removeJavascriptInterface(BRIDGE)
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
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
            "ready" -> applySection()
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

          // 影片連結：不讓網頁換頁，交給 App 處理
          document.addEventListener('click', function (event) {
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
              // 面板比桌面版的網頁窄：內容不要超出面板的寬度（不用左右滑），文字自動換行（0.0.10 實測）
              both + ' { overflow-x: hidden !important; }' +
              ':is(' + both + ') * { max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important;' +
              ' overflow-wrap: anywhere !important; }' +
              'html:has(' + SELECTORS[active] + ') #masthead-container { display: none !important; }' +
              'body { visibility: hidden !important; }' +
              'html { background: #fff !important; }' +
              'html[dark] { background: #0f0f0f !important; }';
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
          document.addEventListener('DOMContentLoaded', function () { window.__multiViewApply(); });
          post({ type: 'ready' });
        })();
        """.trimIndent()
    }
}
