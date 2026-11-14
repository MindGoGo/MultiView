package local.multiview.core

import kotlin.math.floor

/* 進度條的判斷與換算（桌面版 R19、R51、R55；Android 版 R153、R155）。由 iOS 版的 Progress.swift 改寫。 */

/** 播放器回報的進度，單位是秒。 */
data class PlaybackProgress(
    val current: Double,
    /** 一般影片是 0；直播是可回放範圍的開始。 */
    val start: Double,
    /** 一般影片是總長度；直播是直播最新位置（可回放範圍的結束）。 */
    val end: Double,
    val live: Boolean,
)

enum class ProgressKind {
    /** 一般影片。 */
    VOD,

    /** 可回放的直播。 */
    DVR,

    /** 沒有回放範圍的直播（沒有進度條）。 */
    LIVE,
}

data class ProgressDisplay(
    val kind: ProgressKind,
    /** 目前位置在進度條上的比例 0–1（live 沒有進度條，為 0）。 */
    val fraction: Double,
    /** 是否正在看直播（只有 dvr 有意義）。 */
    val atLive: Boolean,
)

/** 播放器元件的資訊（原生播放器、網頁中的影片共用）。 */
data class MediaInfo(
    /** 還沒載入時是 NaN；直播可能是無限大。 */
    val duration: Double,
    val currentTime: Double,
    /** 可以跳轉的各段範圍。 */
    val seekable: List<ClosedFloatingPointRange<Double>> = emptyList(),
    /** 已知是否為直播；不知道時為 null，依長度判斷。 */
    val live: Boolean? = null,
)

object ProgressRules {
    /** 可回放範圍至少這麼長，才算可回放的直播（R19 共用定義）。 */
    const val DVR_MIN_SECONDS = 60.0

    /** 距離直播最新位置這麼近以內，視為正在看直播。 */
    const val LIVE_EDGE_SECONDS = 10.0

    /** 長度超過這個值的影片當作直播（有些網站的直播回報一個極大的長度，而不是無限大）。 */
    internal const val LIVE_DURATION_SECONDS = 10.0 * 24 * 3600

    /** 開頭、結尾這麼近以內的位置不保存，下次從頭開始（R55）。 */
    const val RESUME_MARGIN_SECONDS = 5.0

    /** 雙擊格子左右兩側快轉、倒轉的秒數。 */
    const val DOUBLE_TAP_SKIP_SECONDS = 10.0

    /** 鍵盤 ←／→ 快轉、倒轉的秒數（R51）。 */
    const val KEY_SKIP_SECONDS = 5.0

    fun view(progress: PlaybackProgress): ProgressDisplay {
        val span = progress.end - progress.start
        if (!progress.live) {
            val fraction = if (span > 0) clamp01((progress.current - progress.start) / span) else 0.0
            return ProgressDisplay(ProgressKind.VOD, fraction, false)
        }
        if (span < DVR_MIN_SECONDS) return ProgressDisplay(ProgressKind.LIVE, 0.0, true)
        return ProgressDisplay(
            ProgressKind.DVR,
            clamp01((progress.current - progress.start) / span),
            progress.end - progress.current <= LIVE_EDGE_SECONDS,
        )
    }

    /** 進度條上的比例 → 要跳到的秒數。 */
    fun seekTarget(progress: PlaybackProgress, fraction: Double): Double =
        progress.start + clamp01(fraction) * (progress.end - progress.start)

    /** 快轉、倒轉後的秒數（R51）：限制在可跳轉的範圍內。沒有進度條（沒有回放範圍的直播）時回傳 null。 */
    fun skipTarget(progress: PlaybackProgress, seconds: Double): Double? {
        if (view(progress).kind == ProgressKind.LIVE) return null
        return minOf(maxOf(progress.current + seconds, progress.start), progress.end)
    }

    /** 要保存的觀看進度（R55）：只有點播影片；直播、播完或距離結尾不到 5 秒、還不到 5 秒時不保存。 */
    fun resumePosition(progress: PlaybackProgress?, ended: Boolean = false): Double? {
        if (progress == null || progress.live || ended) return null
        if (progress.current < RESUME_MARGIN_SECONDS || progress.end - progress.current < RESUME_MARGIN_SECONDS) return null
        return JsonValues.jsRound(progress.current * 10) / 10
    }

    /** `m:ss`，一小時以上 `h:mm:ss`。 */
    fun formatTime(seconds: Double): String {
        val total = maxOf(0.0, floor(if (seconds.isFinite()) seconds else 0.0)).toLong()
        val hours = total / 3600
        val minutes = (total % 3600) / 60
        val secs = pad(total % 60)
        return if (hours > 0) "$hours:${pad(minutes)}:$secs" else "$minutes:$secs"
    }

    /** 距離直播的時間，例如 `-1:23`。 */
    fun formatBehind(seconds: Double): String = "-" + formatTime(seconds)

    /** 從播放器的資訊算出進度；還不知道長度時回傳 null。 */
    fun fromMedia(media: MediaInfo): PlaybackProgress? {
        // 長度是 NaN 表示還沒載入，不是直播
        if (media.live == null && media.duration.isNaN()) return null
        val live = media.live ?: (media.duration == Double.POSITIVE_INFINITY || media.duration > LIVE_DURATION_SECONDS)
        if (!live) {
            if (!(media.duration > 0)) return null
            return PlaybackProgress(media.currentTime, 0.0, media.duration, false)
        }
        val first = media.seekable.firstOrNull()
        val last = media.seekable.lastOrNull()
        if (first == null || last == null) {
            return PlaybackProgress(media.currentTime, media.currentTime, media.currentTime, true)
        }
        return PlaybackProgress(media.currentTime, first.start, last.endInclusive, true)
    }

    private fun pad(value: Long) = if (value < 10) "0$value" else "$value"

    private fun clamp01(value: Double) = if (value.isFinite()) value.coerceIn(0.0, 1.0) else 0.0
}

/** 播放狀態（桌面版 `src/players/types.ts` 的 PlayStatus）。 */
enum class PlayStatus {
    LOADING, PLAYING, PAUSED, ENDED, ERROR;

    /** 每格的播放／暫停按鈕（R26）：播放中或緩衝中顯示暫停，其他（暫停、播完）顯示播放。 */
    val showsPause: Boolean get() = this == PLAYING || this == LOADING
}

/** 全部播放／暫停的對象（R8、R9、R20）。 */
object PlaybackRules {
    enum class ToggleAction { PLAY, PAUSE }

    /** 顯示中、有來源、而且不是錯誤狀態的格位（R8）。statuses 以來源的 id 為索引。 */
    fun controllableIndices(slots: Slots, layout: LayoutId, statuses: Map<Int, PlayStatus>, solo: Int? = null): List<Int> =
        slots.indices.filter { index ->
            val source = slots[index] ?: return@filter false
            SlotRules.isVisible(index, layout, solo) && statuses[source.id] != PlayStatus.ERROR
        }

    /** 只要有任何一格在播放就全部暫停，否則全部播放（R9）。 */
    fun toggleAllAction(slots: Slots, layout: LayoutId, statuses: Map<Int, PlayStatus>, solo: Int? = null): ToggleAction {
        val anyPlaying = controllableIndices(slots, layout, statuses, solo).any { index ->
            statuses[slots[index]?.id] == PlayStatus.PLAYING
        }
        return if (anyPlaying) ToggleAction.PAUSE else ToggleAction.PLAY
    }
}
