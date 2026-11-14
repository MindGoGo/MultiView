package local.multiview.android.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import local.multiview.core.CellSource
import local.multiview.core.PlayStatus

/**
 * 網頁來源的暫時做法：以整頁模式顯示網頁，手指直接操作網頁。
 * 影片模式（只顯示影片）、廣告阻擋、YouTube 網站頁面點影片換成那部影片，在 R157 的版本加入，屆時取代這個檔案。
 */
@SuppressLint("SetJavaScriptEnabled")
class SimpleWebPlayer(context: Context, url: String, source: CellSource) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null
    override val supportsVolume = false
    override val isInteractive = true
    override val usesWebAudio = true

    private val webView = WebView(context)
    private var muted = source.muted
    private var closed = false

    /** 網頁開始顯示過：之後網站自己的跳轉失敗不算錯誤（iOS 0.0.21 的教訓）。 */
    private var shown = false

    override val view: View get() = webView

    init {
        webView.apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            webChromeClient = object : WebChromeClient() {
                override fun onReceivedTitle(view: WebView?, title: String?) {
                    if (shown) report(title)
                }
            }
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    applyMuted()
                }

                // 網頁開始顯示就算載入成功，不等「載入完成」：新聞網站一直在載入廣告，永遠等不到
                override fun onPageCommitVisible(view: WebView?, url: String?) {
                    shown = true
                    applyMuted()
                    report(view?.title)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    applyMuted()
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    if (closed || shown || request?.isForMainFrame != true) return
                    onUpdate?.invoke(
                        PlayerUpdate(PlayStatus.ERROR, null, errorMessage = "無法載入網頁（${error?.description ?: "未知的錯誤"}）"),
                    )
                }
            }
            loadUrl(url)
        }
    }

    override fun play() = run("document.querySelectorAll('video,audio').forEach(function (m) { m.play(); })")

    override fun pause() = run("document.querySelectorAll('video,audio').forEach(function (m) { m.pause(); })")

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        applyMuted()
    }

    override fun setVolume(volume: Int) {}

    override fun seekTo(seconds: Double) {}

    override fun shutdown() {
        if (closed) return
        closed = true
        onUpdate = null
        webView.stopLoading()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    private fun report(title: String?) {
        if (closed) return
        onUpdate?.invoke(PlayerUpdate(PlayStatus.PLAYING, null, title = title?.takeIf { it.isNotBlank() }))
    }

    /** 網頁裡的影片跟著格子的靜音設定；之後才出現的影片也要套用，所以每秒檢查一次。 */
    private fun applyMuted() {
        run(
            """
            (function () {
              window.__multiViewMuted = $muted;
              function apply() {
                document.querySelectorAll('video,audio').forEach(function (m) { m.muted = window.__multiViewMuted; });
              }
              apply();
              if (!window.__multiViewMuteTimer) window.__multiViewMuteTimer = setInterval(apply, 1000);
            })()
            """.trimIndent(),
        )
    }

    private fun run(script: String) {
        if (!closed) webView.evaluateJavascript("$script; void 0", null)
    }
}
