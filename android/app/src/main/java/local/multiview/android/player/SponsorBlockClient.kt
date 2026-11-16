package local.multiview.android.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import local.multiview.core.SponsorBlockRules
import local.multiview.core.SponsorSegment
import java.net.HttpURLConnection
import java.net.URL

/**
 * 向 SponsorBlock 要片段（R161），對照 iOS 版的 SponsorBlockClient.swift。
 * 用隱私版 API（只送影片 ID 雜湊的前 4 碼）。一律要全部的類別，依設定過濾由 [SponsorBlockRules.select] 處理。
 * 同一部影片在 App 執行期間只抓一次（記憶體快取，好幾格同一部影片也共用同一個請求）；
 * 失敗、逾時當作沒有片段，不放進快取（下次建立播放器時再試）。
 */
object SponsorBlockClient {
    /** 不跟著格子取消：好幾格可能在等同一個請求。 */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val requests = HashMap<String, Deferred<List<SponsorSegment>?>>()

    /** 這部影片的片段（還沒依設定過濾）；沒有、失敗或逾時時是空的。 */
    suspend fun segments(videoId: String): List<SponsorSegment> {
        val request = synchronized(requests) {
            requests.getOrPut(videoId) {
                scope.async {
                    // 失敗的不留在快取裡（同一部影片同時只有一個請求，所以拿掉的就是這一個）
                    fetch(videoId).also { if (it == null) synchronized(requests) { requests.remove(videoId) } }
                }
            }
        }
        return withTimeoutOrNull(SponsorBlockRules.TIMEOUT_MS.toLong()) { request.await() }.orEmpty()
    }

    /** 成功時回傳片段（404 是沒有片段，回傳空的）；其他情況回傳 null。 */
    private fun fetch(videoId: String): List<SponsorSegment>? = try {
        val connection = URL(SponsorBlockRules.requestUrl(videoId)).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = SponsorBlockRules.TIMEOUT_MS
            connection.readTimeout = SponsorBlockRules.TIMEOUT_MS
            connection.setRequestProperty("User-Agent", "MultiView")
            when (connection.responseCode) {
                200 -> SponsorBlockRules.parse(connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }, videoId)
                404 -> emptyList()
                else -> null
            }
        } finally {
            connection.disconnect()
        }
    } catch (_: Exception) {
        null
    }
}
