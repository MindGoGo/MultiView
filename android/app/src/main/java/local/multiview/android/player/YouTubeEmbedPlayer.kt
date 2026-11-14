package local.multiview.android.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import local.multiview.core.CellSource
import local.multiview.core.MediaInfo
import local.multiview.core.PlayStatus
import local.multiview.core.ProgressRules
import org.json.JSONObject

/**
 * YouTube 官方內嵌播放器（桌面版 R3；Android 版 R147）。對照 iOS 版的 YouTubePlayer.swift。
 * 由 App 自己提供載入播放器的頁面，不經過 YouTube 網站；隱藏 YouTube 的控制列，點擊由格子攔下。
 */
@SuppressLint("SetJavaScriptEnabled")
class YouTubeEmbedPlayer(context: Context, videoId: String, source: CellSource) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null
    override val supportsVolume = true
    override val isInteractive = false
    override val usesWebAudio = true

    private val webView = WebView(context)
    private var failure: String? = null
    private var closed = false

    override val view: View get() = webView

    init {
        webView.apply {
            // 一定要填滿格子：沒有指定時 WebView 依網頁內容決定高度，結果有聲音沒畫面（0.0.2 實測）
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.BLACK)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // 不需要使用者先點一下就能自動播放
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = WebChromeClient()
            addJavascriptInterface(Bridge(::handle), BRIDGE)
        }
        val config = JSONObject()
            .put("videoId", videoId)
            .put("autoplay", source.autoplay)
            .put("muted", source.muted)
            .put("volume", source.volume)
            .put("origin", ORIGIN)
        // 上次的觀看進度（R55）：在載入時指定，播放後才生效
        source.resume?.takeIf { it > 0 }?.let { config.put("start", it.toInt()) }
        webView.loadDataWithBaseURL("$ORIGIN/", page(config.toString()), "text/html", "utf-8", null)
    }

    override fun play() = run("player.playVideo()")

    override fun pause() = run("player.pauseVideo()")

    override fun setMuted(muted: Boolean) = run(if (muted) "player.mute()" else "player.unMute()")

    override fun setVolume(volume: Int) = run("player.setVolume(${volume.coerceIn(0, 100)})")

    override fun seekTo(seconds: Double) {
        if (seconds.isFinite()) run("player.seekTo($seconds, true)")
    }

    override fun shutdown() {
        if (closed) return
        closed = true
        onUpdate = null
        webView.stopLoading()
        webView.removeJavascriptInterface(BRIDGE)
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    private fun run(command: String) {
        if (!closed) webView.evaluateJavascript("if (window.ready) { $command }; void 0", null)
    }

    private fun handle(message: String) {
        if (closed) return
        val json = try {
            JSONObject(message)
        } catch (_: Exception) {
            return
        }
        when (json.optString("type")) {
            "error" -> {
                failure = errorMessage(json.optInt("code"))
                onUpdate?.invoke(PlayerUpdate(PlayStatus.ERROR, null, errorMessage = failure))
            }
            "state" -> {
                if (failure != null) return
                val duration = json.optDouble("duration", 0.0)
                val live = json.optBoolean("live")
                val status = when (json.optInt("state", -1)) {
                    1 -> PlayStatus.PLAYING
                    3 -> PlayStatus.LOADING
                    0 -> PlayStatus.ENDED
                    else -> PlayStatus.PAUSED // 尚未開始、暫停、已載入
                }
                val media = MediaInfo(
                    duration = if (duration > 0) duration else Double.NaN,
                    currentTime = json.optDouble("current", 0.0),
                    seekable = if (live && duration > 0) listOf(0.0..duration) else emptyList(),
                    live = if (live) true else null,
                )
                onUpdate?.invoke(
                    PlayerUpdate(status, ProgressRules.fromMedia(media), title = json.optString("title").ifEmpty { null }),
                )
            }
        }
    }

    private fun errorMessage(code: Int): String = when (code) {
        100 -> "找不到這部影片（可能已被移除或設為私人）"
        101, 150 -> "這部影片不允許在其他地方播放"
        2 -> "影片代碼不正確"
        else -> "YouTube 播放器發生錯誤（$code）"
    }

    /** 網頁送來的訊息。網頁在自己的執行緒呼叫 [post]，改到主執行緒再處理。 */
    private class Bridge(private val onMessage: (String) -> Unit) {
        private val main = Handler(Looper.getMainLooper())

        @JavascriptInterface
        fun post(message: String) {
            main.post { onMessage(message) }
        }
    }

    private companion object {
        /** YouTube 內嵌播放器要求頁面有 http(s) 的來源（iOS 版用 https://local.multiview.ios）。 */
        const val ORIGIN = "https://local.multiview.android"
        const val BRIDGE = "MultiViewAndroid"

        /** 頁面的程式和 iOS 版相同，只把送訊息的方式換成 addJavascriptInterface。 */
        fun page(config: String): String = """
            <!DOCTYPE html>
            <html>
            <head>
            <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
            <style>
              html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
              #player { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
            </style>
            </head>
            <body>
            <div id="player"></div>
            <script>
              var cfg = $config;
              var player = null;
              window.ready = false;
              function post(message) {
                try { $BRIDGE.post(JSON.stringify(message)); } catch (e) {}
              }
              function report() {
                if (!window.ready) return;
                var data = player.getVideoData ? (player.getVideoData() || {}) : {};
                post({
                  type: 'state',
                  state: player.getPlayerState(),
                  current: player.getCurrentTime() || 0,
                  duration: player.getDuration() || 0,
                  live: !!data.isLive,
                  title: data.title || ''
                });
              }
              function onYouTubeIframeAPIReady() {
                var vars = {
                  autoplay: cfg.autoplay ? 1 : 0,
                  mute: cfg.muted ? 1 : 0,
                  controls: 0,
                  rel: 0,
                  iv_load_policy: 3,
                  playsinline: 1,
                  disablekb: 1,
                  fs: 0,
                  origin: cfg.origin
                };
                if (cfg.start) vars.start = cfg.start;
                player = new YT.Player('player', {
                  width: '100%',
                  height: '100%',
                  videoId: cfg.videoId,
                  playerVars: vars,
                  events: {
                    onReady: function () {
                      window.ready = true;
                      player.setVolume(cfg.volume);
                      if (cfg.muted) { player.mute(); } else { player.unMute(); }
                      report();
                    },
                    onStateChange: report,
                    onError: function (event) { post({ type: 'error', code: event.data }); }
                  }
                });
              }
              setInterval(report, 500);
            </script>
            <script src="https://www.youtube.com/iframe_api"></script>
            </body>
            </html>
        """.trimIndent()
    }
}
