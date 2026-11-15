package local.multiview.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import local.multiview.core.JsonValues.array
import local.multiview.core.JsonValues.bool
import local.multiview.core.JsonValues.nonEmptyString
import local.multiview.core.JsonValues.number
import local.multiview.core.JsonValues.obj
import local.multiview.core.JsonValues.string

/**
 * yt-dlp 播放的純邏輯：從解析結果選出要播的串流（桌面版 R89、R103；iOS 版 R135；Android 版 R148、R156）。
 * 由 iOS 版的 YtDlp.swift 改寫（它又是從桌面版 src/lib/ytdlp.ts 來的）。
 */
data class YtStream(
    val kind: Kind,
    val url: String,
    val isLive: Boolean,
    val title: String?,
    /** 網址的有效期限（毫秒時間）。 */
    val expiresAt: Double,
    /** 網站要求的請求標頭（其他網站，R103）：只有 Referer、User-Agent。 */
    val headers: Map<String, String> = emptyMap(),
) {
    enum class Kind { HLS, MP4 }
}

sealed class ResolveResult {
    data class Success(val stream: YtStream) : ResolveResult()
    data class Failure(val message: String) : ResolveResult()
}

object YtDlpRules {
    /** 讀不到網址的有效期限時，當作 5 小時後過期。 */
    const val DEFAULT_EXPIRY: Double = 5.0 * 60 * 60 * 1000

    /** 距離過期不到這麼久的串流不再沿用，重新解析。 */
    const val EXPIRY_MARGIN: Double = 10.0 * 60 * 1000

    /** 原生播放器能播的容器；webm、avi、mkv、flv 等不能（和 iOS 版相同）。 */
    private val playableExtensions = setOf("mp4", "m4v", "mov")

    /** 串流網址的有效期限：query 的 expire= 或路徑中的 /expire/<秒>/。 */
    fun expiry(url: String, now: Double): Double {
        for (marker in listOf("?expire=", "&expire=", "/expire/", "/expire=")) {
            val start = url.indexOf(marker)
            if (start < 0) continue
            val digits = url.substring(start + marker.length).takeWhile { it in '0'..'9' }
            if (digits.length >= 9) {
                digits.toDoubleOrNull()?.let { return it * 1000 }
            }
        }
        return now + DEFAULT_EXPIRY
    }

    /** 這個串流現在還能不能用（快取用）。 */
    fun isUsable(stream: YtStream, now: Double): Boolean = stream.expiresAt - now > EXPIRY_MARGIN

    /**
     * 從 yt-dlp 的解析結果選出要播的串流（R89、R103）：
     * - HLS：優先有主清單（manifest_url）的格式；其他網站沒有主清單時用 HLS 格式本身的網址（有影像的最後一個）
     * - 沒有 HLS：影音合一、播放器能播的容器的 http(s) 格式，YouTube 用 360p（format 18），其他網站用畫質最高的
     * - 直播只用 HLS；還沒開始的直播、沒有可以播的格式回傳 null
     */
    fun pickStream(rawInfo: JsonElement?, now: Double): YtStream? {
        val root = obj(rawInfo) ?: return null
        val info = firstVideo(root) ?: return null
        val formats = array(info["formats"]).orEmpty().mapNotNull(::obj)
        val liveStatus = string(info["live_status"])
        val isLive = bool(info["is_live"]) == true || liveStatus == "is_live"
        // 直播的 title 後面會加上日期時間，fulltitle 是原本的名稱
        val title = nonEmptyString(info["fulltitle"]) ?: nonEmptyString(info["title"])

        fun isHls(format: JsonObject) = string(format["protocol"]).orEmpty().startsWith("m3u8")
        fun make(kind: YtStream.Kind, format: JsonObject, url: String) =
            YtStream(kind, url, isLive, title, expiry(url, now), headers(format, info))

        val hlsStream = formats.firstOrNull { isHls(it) && nonEmptyString(it["manifest_url"]) != null }
            ?.let { make(YtStream.Kind.HLS, it, nonEmptyString(it["manifest_url"])!!) }
            ?: formats.lastOrNull { isHls(it) && nonEmptyString(it["url"]) != null && string(it["vcodec"]) != "none" }
                ?.let { make(YtStream.Kind.HLS, it, nonEmptyString(it["url"])!!) }

        if (isLive) return hlsStream
        if (liveStatus == "is_upcoming") return null
        if (hlsStream != null) return hlsStream

        val muxed = formats.filter { format ->
            val protocol = string(format["protocol"]).orEmpty()
            (protocol == "http" || protocol == "https") &&
                nonEmptyString(format["url"]) != null &&
                string(format["vcodec"]) != "none" &&
                string(format["acodec"]) != "none" &&
                isPlayable(format)
        }
        // 畫質一樣時用前面的（maxByOrNull 遇到相同的值保留第一個，和桌面版的穩定排序相同）
        val best = muxed.firstOrNull { string(it["format_id"]) == "18" }
            ?: muxed.maxByOrNull { number(it["height"]) ?: 0.0 }
            ?: return null
        val url = nonEmptyString(best["url"]) ?: return null
        return make(YtStream.Kind.MP4, best, url)
    }

    /** 解析 mv_bridge.resolve 回傳的文字，選出串流；失敗時回傳錯誤訊息。 */
    fun streamFromResolveOutput(text: String, now: Double): ResolveResult {
        val result = obj(JsonValues.parse(text)) ?: return ResolveResult.Failure("無法讀取 yt-dlp 的結果")
        if (bool(result["ok"]) != true) {
            return ResolveResult.Failure(nonEmptyString(result["error"]) ?: "yt-dlp 解析失敗")
        }
        val stream = pickStream(result["info"], now) ?: return ResolveResult.Failure("沒有可以播放的格式")
        return ResolveResult.Success(stream)
    }

    /**
     * 其他網站的串流要帶的標頭（R103、桌面版 R110）：Referer 是原本的網頁網址，yt-dlp 有提供時用 yt-dlp 的。
     */
    fun webStreamHeaders(pageUrl: String, fromYtDlp: Map<String, String>): Map<String, String> =
        if (fromYtDlp.keys.any { it.lowercase() == "referer" }) fromYtDlp else fromYtDlp + ("Referer" to pageUrl)

    private fun isPlayable(format: JsonObject): Boolean {
        val ext = string(format["ext"]) ?: return true
        return ext.lowercase() in playableExtensions
    }

    /** 串流需要帶的請求標頭：只留 Referer、User-Agent（不帶 Cookie，R103）。 */
    private fun headers(format: JsonObject, info: JsonObject): Map<String, String> {
        val raw = obj(format["http_headers"]) ?: obj(info["http_headers"]) ?: return emptyMap()
        return raw.entries
            .filter { (key, _) -> key.lowercase() == "referer" || key.lowercase() == "user-agent" }
            .mapNotNull { (key, value) -> string(value)?.let { key to it } }
            .toMap()
    }

    /** 一個網頁有多部影片（yt-dlp 回傳清單）時用第一部有格式的（R103）。 */
    private fun firstVideo(info: JsonObject): JsonObject? {
        if (string(info["_type"]) != "playlist") return info
        return array(info["entries"]).orEmpty().mapNotNull(::obj).firstOrNull { array(it["formats"]) != null }
    }
}

/** yt-dlp 的版本與自動更新的判斷（桌面版 R91–R93；Android 版 R156）。 */
object YtDlpVersion {
    /** 日期格式的版本號（2026.10.26、2026.10.26.123456）：取出可比較的版本，不是時回傳 null。 */
    fun parse(text: String): String? {
        val candidates = text.trim().split(Regex("[^0-9.]+")).filter { it.isNotEmpty() }
        for (candidate in candidates) {
            val numbers = candidate.split('.')
            if (numbers.size !in 3..4 || numbers.any { it.isEmpty() }) continue
            if (numbers[0].length != 4 || numbers[1].length > 2 || numbers[2].length > 2) continue
            val out = mutableListOf(numbers[0], numbers[1].padStart(2, '0'), numbers[2].padStart(2, '0'))
            if (numbers.size == 4) out += numbers[3]
            return out.joinToString(".")
        }
        return null
    }

    /** a 比 b 新回傳正數、一樣回傳 0、比較舊回傳負數。 */
    fun compare(a: String, b: String): Int {
        val left = a.split('.').filter { it.isNotEmpty() }.map { it.toLongOrNull() ?: 0 }
        val right = b.split('.').filter { it.isNotEmpty() }.map { it.toLongOrNull() ?: 0 }
        for (index in 0 until maxOf(left.size, right.size)) {
            val difference = (left.getOrNull(index) ?: 0) - (right.getOrNull(index) ?: 0)
            if (difference != 0L) return if (difference > 0) 1 else -1
        }
        return 0
    }
}

/** 更新紀錄 update.json（R156）。 */
data class YtDlpUpdateRecord(
    /** 上次自動更新檢查的時間（毫秒）；沒有時為 0。 */
    val lastCheck: Double = 0.0,
    /** 上次開啟時的 App 版本；沒有時為空字串。 */
    val appVersion: String = "",
) {
    fun encoded(): String = JsonValues.encode(
        JsonObject(
            mapOf(
                "lastCheck" to JsonValues.num(lastCheck),
                "appVersion" to kotlinx.serialization.json.JsonPrimitive(appVersion),
            ),
        ),
    )

    companion object {
        /** 讀不到或格式錯誤時當作從來沒檢查過、App 版本不同。 */
        fun parse(text: String?): YtDlpUpdateRecord {
            val root = text?.let { obj(JsonValues.parse(it)) } ?: return YtDlpUpdateRecord()
            return YtDlpUpdateRecord(number(root["lastCheck"]) ?: 0.0, string(root["appVersion"]) ?: "")
        }
    }
}

object YtDlpUpdateRules {
    /** 開啟時的自動更新：距離上次檢查超過 24 小時（R92 時機 1）。 */
    const val AUTO_UPDATE_INTERVAL = 24.0 * 60 * 60 * 1000

    /** 因為解析失敗而觸發的更新，至少間隔這麼久（R92：10 分鐘內不重複）。 */
    const val FAILURE_UPDATE_INTERVAL = 10.0 * 60 * 1000

    fun shouldAutoUpdate(record: YtDlpUpdateRecord, now: Double): Boolean =
        now - record.lastCheck >= AUTO_UPDATE_INTERVAL || record.lastCheck > now

    /** 看起來是 yt-dlp 太舊、無法解析 YouTube 頁面的錯誤（R92 時機 2）。 */
    fun isOutdatedError(message: String): Boolean {
        val text = message.lowercase()
        if (notOutdatedPatterns.any { it in text }) return false
        return outdatedPatterns.any { it in text }
    }

    /** 從官方的 SHA2-256SUMS 找出某個檔案的雜湊值（小寫十六進位）。 */
    fun checksum(fileName: String, sums: String): String? {
        for (line in sums.lines()) {
            val fields = line.split(' ').filter { it.isNotEmpty() }
            if (fields.size != 2) continue
            // 檔名前面可能有表示二進位模式的 *
            val name = fields[1].removePrefix("*")
            val hash = fields[0]
            if (name == fileName && hash.length == 64 && hash.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
                return hash.lowercase()
            }
        }
        return null
    }

    private val outdatedPatterns = listOf(
        "unable to extract", "nsig", "n challenge", "failed to extract any player response", "player response",
        "signature extraction failed", "please report this issue", "confirm you are on the latest version",
    )

    /** 確定不是 yt-dlp 的問題（影片本身、登入、網路），不需要更新。 */
    private val notOutdatedPatterns = listOf(
        "private video", "video unavailable", "has been removed", "not available", "sign in to confirm",
        "members-only", "age-restricted", "age restricted", "confirm your age", "this live event will begin",
        "premieres in", "getaddrinfo", "timed out", "unable to download", "unsupported url", "cloudflare",
        "nodename nor servname", "network is unreachable", "offline",
    )
}
