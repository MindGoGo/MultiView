package local.multiview.android.player

import android.view.View
import local.multiview.core.PlayStatus
import local.multiview.core.PlaybackProgress
import local.multiview.core.Quality

/** 播放器回報的狀態。 */
data class PlayerUpdate(
    val status: PlayStatus,
    val progress: PlaybackProgress?,
    /** 影片名稱的來源（YouTube 標題、網頁標題）；取不到時為 null。 */
    val title: String? = null,
    /** 錯誤狀態時顯示的訊息。 */
    val errorMessage: String? = null,
)

/**
 * 一格的播放器（對照 iOS 版的 CellPlayer.swift）。每個來源一個，換位、切換版型時沿用同一個，不重新載入（R6 AC1）。
 * 會隨時間改變、畫面要跟著更新的屬性（例如解析完成後的標示）由實作用 Compose 的狀態保存。
 */
interface CellPlayer {
    /** 播放器的畫面；同一時間只會放在一個格子裡。 */
    val view: View
    var onUpdate: ((PlayerUpdate) -> Unit)?

    /** 能不能各自調整音量；不能的只有靜音開關。 */
    val supportsVolume: Boolean

    /** 手指直接操作播放器的畫面（整頁模式的網頁）；false 時由格子攔下點擊（R151）。 */
    val isInteractive: Boolean

    /** 聲音是不是由網頁播放。WebView 不讓兩個網頁同時出聲，這類格子同一時間只有一格有聲音（R152）。 */
    val usesWebAudio: Boolean

    /** 播放方式的小標示（桌面版 R109），例如「yt-dlp」；不需要標示時為 null。 */
    val badge: String? get() = null

    /** 正在用 yt-dlp 解析（讀取動畫顯示「解析中…」）。 */
    val isResolving: Boolean get() = false

    fun play()
    fun pause()
    fun setMuted(muted: Boolean)

    /** 音量 0–100。 */
    fun setVolume(volume: Int)
    fun seekTo(seconds: Double)

    /** 移除來源時釋放資源。 */
    fun shutdown()

    /** 能不能選畫質（原生播放器播 HLS 時，R153）。 */
    val supportsQuality: Boolean get() = false

    /** 畫質：自動，或最高畫面高度。 */
    fun setQuality(quality: Quality) {}
}
