package local.multiview.android.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import local.multiview.core.CompanionRules
import local.multiview.core.SheetStoryboard
import local.multiview.core.Storyboard
import local.multiview.core.StoryboardFrame
import local.multiview.core.StoryboardRules
import java.net.HttpURLConnection
import java.net.URL

/**
 * 進度條的預覽縮圖（桌面版 R50；Android 版 R153）：YouTube 用 YouTube 提供的縮圖，mp4 跳到那個位置取得畫面。
 * 只在主執行緒呼叫；讀取在背景執行緒。
 */
object PreviewThumbnails {
    /** YouTube 影片的縮圖資訊；null 表示沒有（直播、取得失敗）。 */
    private val storyboards = mutableMapOf<String, Storyboard?>()
    private val sheets = LruCache<String, Bitmap>(6)
    private val frames = LruCache<String, Bitmap>(40)
    private val mp4Lock = Mutex()
    private var retriever: Pair<String, MediaMetadataRetriever>? = null

    /** 縮圖的寬度（像素）上限。 */
    private const val MAX_WIDTH = 320

    suspend fun youtube(videoId: String, seconds: Double, duration: Double): Bitmap? {
        val sb = if (storyboards.containsKey(videoId)) {
            storyboards[videoId]
        } else {
            val html = fetch("https://www.youtube.com/watch?v=$videoId")?.let { String(it, Charsets.UTF_8) }
            // 網路錯誤時不記住，下次再試
            if (html == null) return null
            StoryboardRules.extractSpec(html)?.let(StoryboardRules::parse).also { storyboards[videoId] = it }
        } ?: return null
        return crop(StoryboardRules.frame(sb, seconds, duration))
    }

    /** yt-dlp 解析出來的縮圖（YouTube 等用 yt-dlp 播放的影片）。 */
    suspend fun sheet(sb: SheetStoryboard, seconds: Double, duration: Double): Bitmap? =
        sb.frame(seconds, duration)?.let { crop(it) }

    private suspend fun crop(frame: StoryboardFrame): Bitmap? {
        val sheet = sheets.get(frame.url) ?: withContext(Dispatchers.IO) {
            fetch(frame.url)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
        }?.also { sheets.put(frame.url, it) } ?: return null
        if (frame.x + frame.width > sheet.width || frame.y + frame.height > sheet.height) return null
        return Bitmap.createBitmap(sheet, frame.x, frame.y, frame.width, frame.height)
    }

    /** mp4：取最接近的關鍵畫面（每 2 秒一張，同一個位置不重複取）。 */
    suspend fun mp4(url: String, seconds: Double): Bitmap? {
        val bucket = (seconds / 2).toLong()
        val key = "$url#$bucket"
        frames.get(key)?.let { return it }
        return mp4Lock.withLock {
            withContext(Dispatchers.IO) {
                try {
                    val current = retriever?.takeIf { it.first == url }?.second ?: MediaMetadataRetriever().also {
                        retriever?.second?.release()
                        it.setDataSource(url, emptyMap())
                        retriever = url to it
                    }
                    val frame = current.getFrameAtTime(bucket * 2_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                        ?: return@withContext null
                    val scaled = if (frame.width > MAX_WIDTH) {
                        Bitmap.createScaledBitmap(frame, MAX_WIDTH, frame.height * MAX_WIDTH / frame.width, true)
                    } else {
                        frame
                    }
                    scaled
                } catch (_: Exception) {
                    retriever?.second?.release()
                    retriever = null
                    null
                }
            }
        }?.also { frames.put(key, it) }
    }

    private suspend fun fetch(address: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val connection = URL(address).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 15_000
                connection.readTimeout = 15_000
                connection.setRequestProperty("User-Agent", CompanionRules.DESKTOP_USER_AGENT)
                connection.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8")
                // 有些地區沒有同意 Cookie 時 YouTube 會轉到同意頁面，網頁裡就沒有縮圖資訊
                connection.setRequestProperty("Cookie", "SOCS=CAI; CONSENT=YES+")
                if (connection.responseCode != 200) null else connection.inputStream.use { it.readBytes() }
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }
}
