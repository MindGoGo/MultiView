package local.multiview.android.lab

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import local.multiview.core.ParsedSource
import local.multiview.core.SourceParser
import org.json.JSONObject

/** YouTube 內嵌播放器要求頁面有 http(s) 的來源（iOS 版用 https://local.multiview.ios）。 */
private const val ORIGIN = "https://local.multiview.android"
private const val BRIDGE = "MultiViewAndroid"

/**
 * YouTube 內嵌播放器的一格（R147）。由 App 自己提供載入播放器的頁面，不經過 YouTube 網站。
 * 頁面的程式和 iOS 版的 YouTubePlayer.swift 相同，只把送訊息的方式換成 addJavascriptInterface。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YouTubeCell(input: String, index: Int, controller: LabController) {
    val context = LocalContext.current
    val videoId = remember(input) {
        val text = input.trim()
        (SourceParser.parse(text) as? ParsedSource.YouTube)?.videoId ?: text.takeIf(SourceParser::isVideoId)
    }
    var muted by remember { mutableStateOf(false) }
    var volume by remember { mutableFloatStateOf(1f) }
    var status by remember { mutableStateOf(if (videoId == null) "不是 YouTube 影片網址" else "讀取中") }

    val webView = remember {
        WebView(context).apply {
            // 一定要填滿格子：沒有指定時 WebView 依網頁內容決定高度，
            // 播放器是絕對定位，內容高度是 0，結果有聲音沒畫面（0.0.2 實測）
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // 不需要使用者先點一下就能自動播放
            settings.mediaPlaybackRequiresUserGesture = false
            webChromeClient = WebChromeClient()
            addJavascriptInterface(Bridge { status = describe(it) }, BRIDGE)
            if (videoId != null) {
                loadDataWithBaseURL("$ORIGIN/", page(videoId), "text/html", "utf-8", null)
            }
        }
    }

    fun run(command: String) {
        webView.evaluateJavascript("if (window.ready) { $command }; void 0", null)
    }

    DisposableEffect(webView) {
        val cell = object : LabCell {
            override fun play() = run("window.userPaused = false; player.playVideo()")
            override fun pause() = run("window.userPaused = true; player.pauseVideo()")
        }
        controller.register(cell)
        onDispose {
            controller.unregister(cell)
            webView.stopLoading()
            webView.removeJavascriptInterface(BRIDGE)
            webView.destroy()
        }
    }

    LaunchedEffect(muted, volume) {
        // 網頁還沒準備好時先記在頁面裡，onReady 時套用
        val percent = (volume * 100).toInt().coerceIn(0, 100)
        webView.evaluateJavascript(
            "window.wantMuted = $muted; window.wantVolume = $percent; if (window.applyAudio) applyAudio(); void 0",
            null,
        )
    }

    AndroidView(modifier = Modifier.fillMaxSize(), factory = { webView })
    CellOverlay(
        index = index,
        status = status,
        muted = muted,
        volume = volume,
        onMutedChange = { muted = it },
        onVolumeChange = { volume = it },
    )
}

/** 網頁送來的訊息。網頁在自己的執行緒呼叫 [post]，改到主執行緒再交給畫面。 */
private class Bridge(private val onMessage: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun post(message: String) {
        main.post { onMessage(message) }
    }
}

private fun describe(message: String): String = try {
    val json = JSONObject(message)
    when (json.optString("type")) {
        "error" -> when (val code = json.optInt("code")) {
            100 -> "錯誤：找不到這部影片"
            101, 150 -> "錯誤：這部影片不允許在其他地方播放（$code）"
            2 -> "錯誤：影片代碼不正確"
            else -> "錯誤：YouTube 播放器（$code）"
        }
        else -> {
            val state = when (json.optInt("state", -1)) {
                1 -> "播放中"
                2 -> "暫停"
                3 -> "緩衝中"
                0 -> "已結束"
                5 -> "已載入"
                else -> "尚未開始"
            }
            // 頁面回報的實際狀態：靜音與音量（確認設定有沒有生效）、網頁大小（確認有畫面）、
            // 被暫停的次數（不是使用者按的暫停，用來確認系統會不會讓其他格暫停，R147）
            val audio = if (json.optBoolean("muted")) "靜音" else "音量 ${json.optInt("volume")}"
            val size = "${json.optInt("width")}×${json.optInt("height")}"
            val paused = json.optInt("paused")
            "$state $audio $size" + if (paused > 0) " 被暫停 $paused 次" else ""
        }
    }
} catch (_: Exception) {
    message
}

private fun page(videoId: String): String {
    val config = JSONObject()
        .put("videoId", videoId)
        .put("origin", ORIGIN)
        .toString()
    return """
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
          if (window.wantMuted === undefined) window.wantMuted = false;
          if (window.wantVolume === undefined) window.wantVolume = 100;
          function post(message) {
            try { $BRIDGE.post(JSON.stringify(message)); } catch (e) {}
          }
          function applyAudio() {
            if (!window.ready) return;
            player.setVolume(window.wantVolume);
            if (window.wantMuted) { player.mute(); } else { player.unMute(); }
          }
          window.pausedCount = 0;
          window.userPaused = false;
          var lastState = -1;
          function report() {
            if (!window.ready) return;
            var state = player.getPlayerState();
            // 從播放中變成暫停，而且不是 App 要求的暫停：被系統（或其他格）暫停
            if (lastState === 1 && state === 2 && !window.userPaused) window.pausedCount++;
            lastState = state;
            post({
              type: 'state',
              state: state,
              muted: player.isMuted(),
              volume: player.getVolume(),
              width: window.innerWidth,
              height: window.innerHeight,
              paused: window.pausedCount
            });
          }
          function onYouTubeIframeAPIReady() {
            player = new YT.Player('player', {
              width: '100%',
              height: '100%',
              videoId: cfg.videoId,
              playerVars: {
                autoplay: 1,
                controls: 0,
                rel: 0,
                iv_load_policy: 3,
                playsinline: 1,
                disablekb: 1,
                fs: 0,
                origin: cfg.origin
              },
              events: {
                onReady: function () { window.ready = true; applyAudio(); player.playVideo(); report(); },
                onStateChange: report,
                onError: function (event) { post({ type: 'error', code: event.data }); }
              }
            });
          }
          setInterval(report, 1000);
        </script>
        <script src="https://www.youtube.com/iframe_api"></script>
        </body>
        </html>
    """.trimIndent()
}
