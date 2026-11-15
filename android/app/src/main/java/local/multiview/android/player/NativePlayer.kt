package local.multiview.android.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.graphics.Color as AndroidColor
import android.util.TypedValue
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.OptIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import local.multiview.core.AudioOption
import local.multiview.core.AudioTrackRules
import local.multiview.core.CaptionRules
import local.multiview.core.CaptionTrack
import local.multiview.core.CellSource
import local.multiview.core.Cue
import local.multiview.core.RawAudioTrack
import java.util.Locale
import local.multiview.core.MediaInfo
import local.multiview.core.PlayStatus
import local.multiview.core.ProgressRules
import local.multiview.core.Quality
import local.multiview.core.Volume

/**
 * 原生播放器（ExoPlayer）：mp4、m3u8、yt-dlp 解析出來的串流（R146、R152、R153）。對照 iOS 版的 NativePlayer.swift。
 * 不處理音訊焦點：否則一格開始出聲時系統會讓其他格暫停。音訊焦點由 App 統一處理（AudioFocus）。
 */
@OptIn(UnstableApi::class)
class NativePlayer(
    context: Context,
    url: String,
    source: CellSource,
    /** HLS：可以選畫質。 */
    private val adaptive: Boolean,
    /** 串流要帶的請求標頭（yt-dlp 解析其他網站時，R103）。 */
    headers: Map<String, String> = emptyMap(),
    override val badge: String? = null,
    /** yt-dlp 解析出來的字幕（R156）。 */
    override val captionTracks: List<CaptionTrack> = emptyList(),
) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null
    override val supportsVolume = true
    override val isInteractive = false
    override val usesWebAudio = false
    override val supportsQuality get() = adaptive

    private val handler = Handler(Looper.getMainLooper())
    private val exo: ExoPlayer
    private val playerView: PlayerView
    private var muted = source.muted
    private var volume = source.volume
    private var failure: String?  = null
    private var closed = false
    /** 直播落後太多而重新對齊的次數（避免一直重試）。 */
    private var liveResyncs = 0

    override val view: View get() = playerView

    // 聲音軌（桌面版 R95）。畫面要跟著更新，所以用 Compose 的狀態保存
    override var audioOptions by mutableStateOf<List<AudioOption>>(emptyList())
        private set
    override var currentAudio by mutableStateOf(-1)
        private set

    // 字幕（R156）：自己讀 WebVTT、自己顯示（讀不到字幕不會影響播放）
    override var currentCaption by mutableStateOf<String?>(null)
        private set
    private var cues: List<Cue> = emptyList()
    private var captionJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val requestHeaders = headers
    private val captionView = TextView(context).apply {
        setTextColor(AndroidColor.WHITE)
        setBackgroundColor(0x99000000.toInt())
        gravity = Gravity.CENTER
        setPadding(12, 4, 12, 4)
        visibility = View.GONE
    }
    private val captionTicker = object : Runnable {
        override fun run() {
            if (closed || cues.isEmpty()) return
            showCue()
            handler.postDelayed(this, CAPTION_INTERVAL_MS)
        }
    }

    /** 這一格記住的語言（選單選過的）。 */
    private val savedAudioLang = source.audioLang

    /** 播放器目前的聲音軌：每一條對應的群組與位置。 */
    private var audioRefs: List<Pair<Tracks.Group, Int>> = emptyList()
    private var audioRaw: List<RawAudioTrack> = emptyList()

    private val ticker = object : Runnable {
        override fun run() {
            if (closed) return
            report()
            handler.postDelayed(this, REPORT_INTERVAL_MS)
        }
    }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) = report()

        override fun onTracksChanged(tracks: Tracks) = updateAudioTracks(tracks)

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) liveResyncs = 0
            report()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = report()

        override fun onPlayerError(error: PlaybackException) {
            // 直播暫停太久，落在可回放範圍之外：跳回直播最新的位置
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && liveResyncs < MAX_LIVE_RESYNCS) {
                liveResyncs++
                exo.seekToDefaultPosition()
                exo.prepare()
                return
            }
            failure = "無法播放（${error.errorCodeName.removePrefix("ERROR_CODE_")}）"
            report()
        }
    }

    init {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(headers)
        headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.let { http.setUserAgent(it.value) }
        exo = ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(http))
            .build()
        exo.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            /* handleAudioFocus = */ false,
        )
        // 背景播放時（R154）不讓 CPU 與網路休眠；只在播放中才會佔用
        exo.setWakeMode(C.WAKE_MODE_NETWORK)
        exo.addListener(listener)
        applyQuality(source.quality)
        applyVolume()

        val item = MediaItem.Builder().setUri(url)
        if (adaptive) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        exo.setMediaItem(item.build())
        // 上次的觀看進度（R55）
        source.resume?.takeIf { it > 0 }?.let { exo.seekTo((it * 1000).toLong()) }
        exo.playWhenReady = source.autoplay
        exo.prepare()

        playerView = PlayerView(context).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(android.graphics.Color.BLACK)
            setKeepContentOnPlayerReset(true)
            player = exo
        }
        handler.postDelayed(ticker, REPORT_INTERVAL_MS)

        playerView.overlayFrameLayout?.addView(
            captionView,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT)
                .apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL },
        )
        // 字的大小跟著格子：高度的 5%，最小 10sp
        playerView.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
            val minPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 10f, view.resources.displayMetrics)
            captionView.setTextSize(TypedValue.COMPLEX_UNIT_PX, maxOf(minPx, view.height * 0.05f))
            (captionView.layoutParams as? FrameLayout.LayoutParams)?.bottomMargin = (view.height * 0.06f).toInt()
            captionView.maxWidth = (view.width * 0.9f).toInt()
        }
        CaptionRules.find(captionTracks, source.captions)?.let { setCaption(it.key) }
    }

    override fun setCaption(key: String?) {
        if (closed) return
        captionJob?.cancel()
        cues = emptyList()
        captionView.visibility = View.GONE
        val track = captionTracks.firstOrNull { it.key == key }
        currentCaption = track?.key
        track ?: return
        captionJob = scope.launch {
            val text = withContext(Dispatchers.IO) { fetchText(track.url) } ?: return@launch
            cues = CaptionRules.parseVtt(text)
            handler.removeCallbacks(captionTicker)
            handler.post(captionTicker)
        }
    }

    private fun showCue() {
        val text = CaptionRules.cueAt(cues, exo.currentPosition / 1000.0)
        if (text == null) {
            captionView.visibility = View.GONE
        } else {
            if (captionView.text != text) captionView.text = text
            captionView.visibility = View.VISIBLE
        }
    }

    /** 讀字幕檔：帶網站要求的 User-Agent、Referer。 */
    private fun fetchText(address: String): String? = try {
        val connection = URL(address).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            requestHeaders.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            if (connection.responseCode != 200) null else connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }
        } finally {
            connection.disconnect()
        }
    } catch (_: Exception) {
        null
    }

    override fun play() {
        if (closed) return
        if (failure != null || exo.playbackState == Player.STATE_IDLE) {
            // 出錯之後按播放：重新載入
            failure = null
            exo.prepare()
        } else if (exo.playbackState == Player.STATE_ENDED) {
            exo.seekTo(0)
        }
        exo.play()
    }

    override fun pause() {
        if (!closed) exo.pause()
    }

    override fun setMuted(muted: Boolean) {
        this.muted = muted
        applyVolume()
    }

    override fun setVolume(volume: Int) {
        this.volume = volume
        applyVolume()
    }

    override fun seekTo(seconds: Double) {
        if (closed || !seconds.isFinite()) return
        val duration = exo.duration
        // 直播跳到最後面：回到直播最新的位置
        if (exo.isCurrentMediaItemLive && duration != C.TIME_UNSET && seconds * 1000 >= duration - 1000) {
            exo.seekToDefaultPosition()
        } else {
            exo.seekTo((seconds * 1000).toLong().coerceAtLeast(0))
        }
        report()
    }

    override fun setQuality(quality: Quality) {
        if (!closed) applyQuality(quality)
    }

    override fun shutdown() {
        if (closed) return
        closed = true
        handler.removeCallbacks(ticker)
        handler.removeCallbacks(captionTicker)
        scope.cancel()
        onUpdate = null
        exo.removeListener(listener)
        playerView.player = null
        exo.release()
    }

    override fun setAudioTrack(index: Int) {
        if (closed) return
        val (group, track) = audioRefs.getOrNull(index) ?: return
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, track))
            .build()
    }

    /**
     * 聲音軌改變：列出選項；第一次拿到這些聲音軌時，依這一格記住的語言 → 系統語言 → 原本的聲音 → 第一條選擇
     * （YouTube 的主清單沒有標成預設的聲音軌，不選的話可能播到 AI 配音）。
     */
    private fun updateAudioTracks(tracks: Tracks) {
        val refs = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
            .flatMap { group -> (0 until group.length).map { group to it } }
        val raw = refs.map { (group, i) -> group.getTrackFormat(i).let { RawAudioTrack(it.language, it.label ?: "") } }
        audioRefs = refs
        val selected = refs.indexOfFirst { (group, i) -> group.isTrackSelected(i) }
        if (raw != audioRaw) {
            audioRaw = raw
            audioOptions = if (raw.size > 1) AudioTrackRules.options(raw) else emptyList()
            if (audioOptions.size > 1) {
                val pick = AudioTrackRules.pick(raw, savedAudioLang, Locale.getDefault().toLanguageTag())
                if (pick >= 0 && pick != selected) {
                    setAudioTrack(pick)
                    currentAudio = AudioTrackRules.currentOption(raw, audioOptions, pick)
                    return
                }
            }
        }
        currentAudio = if (selected >= 0) AudioTrackRules.currentOption(raw, audioOptions, selected) else -1
    }

    private fun applyVolume() {
        if (!closed) exo.volume = if (muted) 0f else Volume.fraction(volume).toFloat()
    }

    /** 畫質（R153）：自動，或限制最高的畫面高度。 */
    private fun applyQuality(quality: Quality) {
        val builder = exo.trackSelectionParameters.buildUpon()
        when (quality) {
            Quality.Auto -> builder.clearVideoSizeConstraints()
            is Quality.Height -> builder.setMaxVideoSize(Int.MAX_VALUE, quality.height)
        }
        exo.trackSelectionParameters = builder.build()
    }

    private fun status(): PlayStatus = when {
        failure != null -> PlayStatus.ERROR
        exo.playbackState == Player.STATE_ENDED -> PlayStatus.ENDED
        exo.isPlaying -> PlayStatus.PLAYING
        exo.playbackState == Player.STATE_READY -> PlayStatus.PAUSED
        // 還在載入、緩衝中
        else -> PlayStatus.LOADING
    }

    private fun report() {
        if (closed) return
        val duration = exo.duration
        val seconds = if (duration == C.TIME_UNSET) Double.NaN else duration / 1000.0
        val live = exo.isCurrentMediaItemLive
        val media = MediaInfo(
            duration = seconds,
            currentTime = exo.currentPosition / 1000.0,
            // 直播：ExoPlayer 的位置是相對於可回放範圍的開頭
            seekable = if (live && seconds > 0) listOf(0.0..seconds) else emptyList(),
            live = live,
        )
        onUpdate?.invoke(PlayerUpdate(status(), ProgressRules.fromMedia(media), errorMessage = failure))
    }

    private companion object {
        const val REPORT_INTERVAL_MS = 500L
        const val CAPTION_INTERVAL_MS = 200L
        const val MAX_LIVE_RESYNCS = 3
    }
}
