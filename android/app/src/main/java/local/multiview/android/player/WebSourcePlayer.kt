package local.multiview.android.player

import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import local.multiview.core.CellSource
import local.multiview.core.PlayStatus
import local.multiview.core.Quality
import local.multiview.core.WebMethod
import local.multiview.core.YtDlpRules
import local.multiview.core.YtStream

/**
 * 網頁來源的播放器（桌面版 R12、R102、R103；Android 版 R156、R157），對照 iOS 版的 WebSourcePlayer.swift。
 * 其他網站的播放方式是 yt-dlp 時，先用 yt-dlp 解析，成功就用原生播放器播放（可以多格同時出聲）；
 * 失敗或播放方式是網頁時，顯示網頁（WebPagePlayer）。
 */
class WebSourcePlayer(
    private val context: Context,
    private val pageUrl: String,
    source: CellSource,
    private val mode: WebMode,
    private val interceptYouTube: Boolean,
    method: WebMethod,
) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null

    /** 要顯示給使用者的提示（例如「找不到影片」）。 */
    var onNotice: ((String) -> Unit)? = null

    /** YouTube 網站頁面裡點了影片（桌面版 R57）：這一格換成那部影片。 */
    var onYouTubeVideo: ((String) -> Unit)? = null

    /** yt-dlp 播不了、改顯示網頁時通知一次（顯示提示用）。 */
    var onFallback: (() -> Unit)? = null

    private val container = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
    override val view: View get() = container

    // 解析完成、換播放器時畫面要跟著更新，所以用 Compose 的狀態保存
    private var inner by mutableStateOf<CellPlayer?>(null)
    private var usingYtDlp by mutableStateOf(false)
    private var closed by mutableStateOf(false)

    override val supportsVolume get() = inner?.supportsVolume ?: false
    override val isInteractive get() = inner?.isInteractive ?: false

    /** 解析中還不知道用哪一種；當作原生（不會讓其他網頁格子靜音）。 */
    override val usesWebAudio get() = inner?.usesWebAudio ?: false
    override val badge get() = if (usingYtDlp) "yt-dlp" else null

    /** 還沒有裡面的播放器：yt-dlp 解析中。 */
    override val isResolving get() = inner == null && !closed
    override val supportsQuality get() = inner?.supportsQuality ?: false
    override val audioOptions get() = inner?.audioOptions ?: emptyList()
    override val captionTracks get() = inner?.captionTracks ?: emptyList()
    override val currentCaption get() = inner?.currentCaption

    override fun setCaption(key: String?) {
        source = source.copy(captions = key)
        inner?.setCaption(key)
    }
    override val currentAudio get() = inner?.currentAudio ?: -1

    override fun setAudioTrack(index: Int) {
        audioOptions.firstOrNull { it.index == index }?.let { source = source.copy(audioLang = it.lang) }
        inner?.setAudioTrack(index)
    }

    /** 正在顯示網頁時的網頁播放器；用 yt-dlp 播放或解析中時為 null。 */
    val webPage: WebPagePlayer? get() = inner as? WebPagePlayer

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var source = source

    /** 使用者在解析完成前按了播放或暫停；null 表示沒按過，照來源原本的設定。 */
    private var wantsPlaying: Boolean? = null

    /** 目前的觀看位置（重新解析、改顯示網頁時從這裡繼續）。 */
    private var lastPosition: Double? = null
    private var title: String? = null

    /** 這個串流開始播放過。 */
    private var everPlayed = false

    /** 播放失敗後已經重試幾次；開始播放後歸零。 */
    private var retries = 0

    /** 最近一次回報的狀態是不是播放中（重試後維持原本的播放或暫停）。 */
    private var wasPlaying = false

    init {
        // YouTube 網站頁面一律用網頁（R57）
        if (method == WebMethod.YTDLP && !interceptYouTube) startResolving() else showPage()
    }

    override fun play() {
        wantsPlaying = true
        inner?.play()
    }

    override fun pause() {
        wantsPlaying = false
        inner?.pause()
    }

    override fun setMuted(muted: Boolean) {
        source = source.copy(muted = muted)
        inner?.setMuted(muted)
    }

    override fun setVolume(volume: Int) {
        source = source.copy(volume = volume)
        inner?.setVolume(volume)
    }

    override fun seekTo(seconds: Double) {
        inner?.seekTo(seconds)
    }

    override fun setQuality(quality: Quality) {
        source = source.copy(quality = quality)
        inner?.setQuality(quality)
    }

    override fun shutdown() {
        if (closed) return
        closed = true
        scope.cancel()
        inner?.shutdown()
        inner = null
        container.removeAllViews()
        onUpdate = null
        onNotice = null
        onYouTubeVideo = null
        onFallback = null
    }

    // yt-dlp（R103）

    private fun startResolving(delayMs: Long = 0) {
        // 解析中：格子顯示讀取動畫
        scope.launch {
            try {
                if (delayMs > 0) delay(delayMs)
                resolved(YtDlpResolver.resolve(context, pageUrl))
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // 不支援的網站、需要登入、解析失敗：顯示網頁
                fallBack()
            }
        }
    }

    private fun resolved(stream: YtStream) {
        if (closed) return
        title = stream.title
        usingYtDlp = true
        install(
            NativePlayer(
                context,
                stream.url,
                startingSource(stream.isLive),
                adaptive = stream.kind == YtStream.Kind.HLS,
                captionTracks = stream.captions,
                headers = YtDlpRules.webStreamHeaders(pageUrl, stream.headers),
            ),
        )
    }

    /**
     * 串流播放失敗：
     * - 還沒開始播放過：剛解析出來的串流網址前幾秒可能被拒（桌面版 R103 實測 Dailymotion），等一下用同一個串流再試一次。
     * - 播放過（例如串流網址過期）：重新解析，從原本的位置繼續，最多 3 次。
     * 都不行就改顯示網頁。
     */
    private fun retry() {
        retries++
        wantsPlaying = wantsPlaying ?: wasPlaying
        inner?.shutdown()
        inner = null
        container.removeAllViews()
        onUpdate?.invoke(PlayerUpdate(PlayStatus.LOADING, null, title = title))
        if (everPlayed) {
            YtDlpResolver.forget(pageUrl)
            startResolving()
        } else {
            startResolving(FIRST_RETRY_DELAY_MS)
        }
    }

    /** yt-dlp 播不了：這一格改顯示網頁（只對這一次有效）。 */
    private fun fallBack() {
        if (closed) return
        YtDlpResolver.forget(pageUrl)
        showPage()
        onFallback?.invoke()
    }

    private fun showPage() {
        if (closed) return
        usingYtDlp = false
        val page = WebPagePlayer(
            context, pageUrl, startingSource(live = false), mode, adblock = source.adblock, interceptYouTube = interceptYouTube,
        )
        page.onNotice = { text -> onNotice?.invoke(text) }
        page.onYouTubeVideo = { href -> onYouTubeVideo?.invoke(href) }
        install(page)
    }

    /** 建立裡面的播放器時用的來源：帶上目前的靜音、音量、畫質、播放狀態與位置。 */
    private fun startingSource(live: Boolean): CellSource {
        var start = source
        wantsPlaying?.let { start = start.copy(autoplay = it) }
        if (live) {
            start = start.copy(resume = null)
        } else {
            lastPosition?.let { start = start.copy(resume = it) }
        }
        return start
    }

    private fun install(player: CellPlayer) {
        inner?.shutdown()
        container.removeAllViews()
        inner = player
        container.addView(
            player.view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        player.onUpdate = { update -> if (inner === player) forward(update) }
    }

    private fun forward(update: PlayerUpdate) {
        if (usingYtDlp && update.status == PlayStatus.ERROR) {
            if (retries < (if (everPlayed) MAX_RETRIES else 1)) retry() else fallBack()
            return
        }
        when (update.status) {
            PlayStatus.PLAYING -> {
                everPlayed = true
                retries = 0
                wasPlaying = true
                wantsPlaying = null
            }
            PlayStatus.PAUSED, PlayStatus.ENDED -> wasPlaying = false
            else -> {}
        }
        update.progress?.takeIf { !it.live }?.let { lastPosition = it.current }
        // 用 yt-dlp 播放時，歷史與最愛的名稱用解析得到的影片名稱（R103）
        onUpdate?.invoke(if (usingYtDlp && update.title == null) update.copy(title = title) else update)
    }

    private companion object {
        /** 播放中斷時最多重新解析幾次。 */
        const val MAX_RETRIES = 3

        /** 還沒播放過就失敗時，隔多久用同一個串流再試一次。 */
        const val FIRST_RETRY_DELAY_MS = 2000L
    }
}
