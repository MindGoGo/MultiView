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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import local.multiview.core.CellSource
import local.multiview.core.PlayMethod
import local.multiview.core.PlayStatus
import local.multiview.core.Quality
import local.multiview.core.SourceParser
import local.multiview.core.SponsorBlockSettings
import local.multiview.core.SponsorSegment
import local.multiview.core.YouTubeMethods
import local.multiview.core.YtStream

/**
 * YouTube 來源的播放器（R156），對照 iOS 版的 YouTubeSourcePlayer.swift：依設定先用 yt-dlp 解析，成功就用原生播放器播放
 * （沒有 YouTube 的按鈕與廣告，而且可以多格同時出聲）；失敗或設定為內嵌時用 YouTube 內嵌播放器。
 */
class YouTubeSourcePlayer(
    private val context: Context,
    private val videoId: String,
    source: CellSource,
    private val methods: YouTubeMethods,
    /** SponsorBlock 的設定（R161）。 */
    private var sponsorBlock: SponsorBlockSettings = SponsorBlockSettings(),
) : CellPlayer {
    override var onUpdate: ((PlayerUpdate) -> Unit)? = null

    /** 退回內嵌播放器時通知一次（顯示提示用）；參數是失敗的原因。 */
    var onFallback: ((String) -> Unit)? = null

    private val container = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
    override val view: View get() = container

    // 解析完成、換播放器時畫面要跟著更新，所以用 Compose 的狀態保存
    private var inner by mutableStateOf<CellPlayer?>(null)
    private var usingYtDlp by mutableStateOf(false)
    private var closed by mutableStateOf(false)

    override val supportsVolume get() = inner?.supportsVolume ?: false
    override val isInteractive = false

    /** 解析中還不知道用哪一種；當作原生（不會讓其他網頁格子靜音）。 */
    override val usesWebAudio get() = inner?.usesWebAudio ?: false
    override val badge get() = if (usingYtDlp) "yt-dlp" else null

    /** 還沒有裡面的播放器：yt-dlp 解析中。 */
    override val isResolving get() = inner == null && !closed
    override val supportsQuality get() = inner?.supportsQuality ?: false
    override val audioOptions get() = inner?.audioOptions ?: emptyList()
    override val captionTracks get() = inner?.captionTracks ?: emptyList()
    override val storyboard get() = inner?.storyboard
    override val currentCaption get() = inner?.currentCaption

    override fun setCaption(key: String?) {
        source = source.copy(captions = key)
        inner?.setCaption(key)
    }
    override val currentAudio get() = inner?.currentAudio ?: -1

    // SponsorBlock（R161）：只有 yt-dlp 播放的一般影片（內嵌播放器沒有這些，一直是空的）
    override val sponsorSegments get() = inner?.sponsorSegments ?: emptyList()
    override val skipNotice get() = inner?.skipNotice

    override fun undoSkip() {
        inner?.undoSkip()
    }

    override fun dismissSkipNotice() {
        inner?.dismissSkipNotice()
    }

    override fun setSponsorBlock(settings: SponsorBlockSettings) {
        sponsorBlock = settings
        inner?.setSponsorBlock(settings)
        fetchSponsorSegments()
    }

    /** 這部影片的 SponsorBlock 片段（還沒過濾）；null 是還沒抓。 */
    private var sponsorRaw: List<SponsorSegment>? = null
    private var sponsorJob: Job? = null

    /** yt-dlp 解析出來是直播：不抓片段。 */
    private var isLive = false

    override fun setAudioTrack(index: Int) {
        audioOptions.firstOrNull { it.index == index }?.let { source = source.copy(audioLang = it.lang) }
        inner?.setAudioTrack(index)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var source = source

    /** 使用者在解析完成前按了播放或暫停；null 表示沒按過，照來源原本的設定。 */
    private var wantsPlaying: Boolean? = null

    /** 目前的觀看位置（退回內嵌時從這裡繼續）。 */
    private var lastPosition: Double? = null
    private var title: String? = null

    /** 播放中斷後已經重新解析幾次；開始播放後歸零。 */
    private var retries = 0

    /** 最近一次回報的狀態是不是播放中（重新解析後維持原本的播放或暫停）。 */
    private var wasPlaying = false

    private val watchUrl = SourceParser.watchPageUrl(videoId)

    init {
        if (methods.needsResolve) startResolving() else useEmbed()
        // 影片 ID 一開始就知道：和 yt-dlp 解析同時在背景抓片段
        fetchSponsorSegments()
    }

    /**
     * 在背景抓 SponsorBlock 的片段（R161）：開啟、一般影片用 yt-dlp 播放、不是直播、還沒抓過時才抓。
     * 抓不到（失敗、逾時）當作沒有片段，不影響播放。
     */
    private fun fetchSponsorSegments() {
        if (closed || !sponsorBlock.active || methods.vod != PlayMethod.YTDLP || isLive) return
        if (sponsorRaw != null || sponsorJob?.isActive == true) return
        sponsorJob = scope.launch {
            val raw = SponsorBlockClient.segments(videoId)
            sponsorRaw = raw
            (inner as? NativePlayer)?.setSponsorSegments(raw)
        }
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
        onFallback = null
    }

    // yt-dlp

    private fun startResolving() {
        // 解析中：格子顯示讀取動畫
        scope.launch {
            try {
                resolved(YtDlpResolver.resolve(context, watchUrl))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                fallBack(error.message ?: "yt-dlp 解析失敗")
            }
        }
    }

    private fun resolved(stream: YtStream) {
        if (closed) return
        title = stream.title
        // 每一組（直播、一般影片）各自的播放方式（R88）
        val method = if (stream.isLive) methods.live else methods.vod
        if (method != PlayMethod.YTDLP) {
            useEmbed()
            return
        }
        usingYtDlp = true
        val native = NativePlayer(
            context,
            stream.url,
            startingSource(stream.isLive),
            adaptive = stream.kind == YtStream.Kind.HLS,
            captionTracks = stream.captions,
            storyboard = stream.storyboard,
            headers = stream.headers,
        )
        install(native)
        // SponsorBlock（R161）：直播不處理
        isLive = stream.isLive
        if (isLive) {
            sponsorJob?.cancel()
        } else {
            native.setSponsorBlock(sponsorBlock)
            sponsorRaw?.let(native::setSponsorSegments)
            fetchSponsorSegments()
        }
    }

    /** yt-dlp 失敗：改用內嵌播放器，從原本的時間點繼續（R90）。 */
    private fun fallBack(reason: String) {
        if (closed) return
        usingYtDlp = false
        YtDlpResolver.forget(watchUrl)
        useEmbed()
        onFallback?.invoke(reason)
    }

    /** 播放中斷（例如串流網址過期）：重新解析，從原本的位置繼續。 */
    private fun retry() {
        retries++
        wantsPlaying = wantsPlaying ?: wasPlaying
        inner?.shutdown()
        inner = null
        container.removeAllViews()
        onUpdate?.invoke(PlayerUpdate(PlayStatus.LOADING, null, title = title))
        YtDlpResolver.forget(watchUrl)
        startResolving()
    }

    private fun useEmbed() {
        if (closed) return
        usingYtDlp = false
        install(YouTubeEmbedPlayer(context, videoId, startingSource(live = false)))
    }

    /** 建立裡面的播放器時用的來源：帶上目前的靜音、音量、播放狀態與位置。 */
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
        // 用 yt-dlp 播放時播放器出錯（例如串流網址過期）：重新解析，3 次都失敗才退回內嵌播放器（R90）
        if (usingYtDlp && update.status == PlayStatus.ERROR) {
            if (retries < MAX_RETRIES) retry() else fallBack(update.errorMessage ?: "播放中斷")
            return
        }
        when (update.status) {
            PlayStatus.PLAYING -> {
                retries = 0
                wasPlaying = true
                wantsPlaying = null
            }
            PlayStatus.PAUSED, PlayStatus.ENDED -> wasPlaying = false
            else -> {}
        }
        update.progress?.takeIf { !it.live }?.let { lastPosition = it.current }
        onUpdate?.invoke(if (update.title == null) update.copy(title = title) else update)
    }

    private companion object {
        /** 播放中斷時最多重新解析幾次（R90）。 */
        const val MAX_RETRIES = 3
    }
}
