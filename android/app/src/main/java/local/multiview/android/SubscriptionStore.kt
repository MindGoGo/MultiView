package local.multiview.android

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import local.multiview.android.ytdlp.YtDlp
import local.multiview.core.CompanionRules
import local.multiview.core.FeedVideo
import local.multiview.core.Outcome
import local.multiview.core.YouTubeFeed
import java.net.HttpURLConnection
import java.net.URL

/**
 * 訂閱頻道的最新影片與直播狀態（R59、R60；Android 版 R158）。不保存，每次開啟時重新讀取。對照 iOS 版的 SubscriptionStore.swift。
 *
 * YouTube 的 RSS 摘要對 App 回傳 404（2026-11-14 在 iOS 版實測），所以最新影片直接用 yt-dlp 讀頻道的影片頁。
 * yt-dlp 比較慢，而且和播放用的解析共用同一個 Python，所以一次只讀一個頻道，展開的頻道優先。
 * 直播狀態讀頻道的 /live 頁。只在主執行緒使用。
 */
class SubscriptionStore(private val context: Context) {
    data class Feed(
        /** 最新影片，新的在上面；還沒讀過時為 null。 */
        val videos: List<FeedVideo>? = null,
        /** 正在直播的影片代碼；沒有直播或判斷不了時為 null。 */
        val live: String? = null,
        /** 上次讀取完成的時間（毫秒）。 */
        val loadedAt: Double = 0.0,
        /** 正在讀直播狀態。 */
        val loading: Boolean = false,
        /** 最新影片還在讀取（排隊等 yt-dlp）。 */
        val videosLoading: Boolean = false,
        /** 上次讀取失敗（顯示「無法取得最新影片」）。 */
        val failed: Boolean = false,
        /** 失敗的原因；顯示在訊息後面，方便回報問題。 */
        val failure: String? = null,
    )

    val feeds = mutableStateMapOf<String, Feed>()

    private val scope = MainScope()

    /** 同時最多讀取幾個頻道的直播頁。 */
    private val liveSlots = Semaphore(4)
    private val videoQueue = ArrayDeque<String>()
    private var videoRunning = false

    val anyLoading: Boolean get() = feeds.values.any { it.loading || it.videosLoading }

    /** 讀取這些頻道的最新影片與直播狀態。force 為 false 時，15 分鐘內讀過的不重複讀取。 */
    fun load(ids: List<String>, force: Boolean) {
        val now = System.currentTimeMillis().toDouble()
        for (id in ids) {
            val feed = feeds[id] ?: Feed()
            if (feed.loading || feed.videosLoading) continue
            if (!force && feed.loadedAt > 0 && now - feed.loadedAt < YouTubeFeed.REFRESH_INTERVAL) continue
            feeds[id] = feed.copy(loading = true, videosLoading = true)
            videoQueue.addLast(id)
            scope.launch {
                val live = liveSlots.withPermit { fetchText(YouTubeFeed.liveUrl(id)) }?.let(YouTubeFeed::parseLiveStatus)
                // 讀取期間頻道被移除了就不管
                feeds[id]?.let { feeds[id] = it.copy(loading = false, live = live) }
            }
        }
        pumpVideos()
    }

    /** 展開頻道時呼叫：還在排隊讀最新影片的話，移到最前面。 */
    fun prioritize(id: String) {
        if (videoQueue.remove(id)) videoQueue.addFirst(id)
    }

    fun forget(id: String) {
        feeds.remove(id)
        videoQueue.remove(id)
    }

    /** 讀取一個網頁的文字；失敗時回傳 null。 */
    suspend fun fetchText(address: String): String? = withContext(Dispatchers.IO) {
        try {
            val connection = URL(address).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 20_000
                connection.readTimeout = 20_000
                connection.instanceFollowRedirects = true
                // YouTube 對沒有瀏覽器識別的要求可能回傳不同的內容
                connection.setRequestProperty("User-Agent", CompanionRules.DESKTOP_USER_AGENT)
                connection.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8")
                if (connection.responseCode != 200) return@withContext null
                // 少數回應不是合法的 UTF-8：容許錯誤的位元組，不要整份丟掉
                connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    // yt-dlp：一次一個頻道

    private fun pumpVideos() {
        if (videoRunning) return
        val id = videoQueue.removeFirstOrNull() ?: return
        videoRunning = true
        scope.launch {
            val result = try {
                YouTubeFeed.parseChannelVideos(YtDlp.channelVideos(context, id, VIDEO_COUNT))
            } catch (error: Exception) {
                Outcome.Err(error.message ?: "Python 錯誤")
            }
            feeds[id]?.let { feed ->
                val now = System.currentTimeMillis().toDouble()
                feeds[id] = when (result) {
                    is Outcome.Ok -> feed.copy(videosLoading = false, loadedAt = now, videos = result.value, failed = false, failure = null)
                    is Outcome.Err -> feed.copy(videosLoading = false, loadedAt = now, failed = true, failure = result.error.take(80))
                }
            }
            videoRunning = false
            pumpVideos()
        }
    }

    private companion object {
        /** 用 yt-dlp 讀的最新影片數量。 */
        const val VIDEO_COUNT = 15
    }
}
