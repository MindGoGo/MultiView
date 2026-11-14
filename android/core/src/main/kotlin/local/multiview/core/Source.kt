package local.multiview.core

import java.net.URI
import java.net.URISyntaxException

/** 網址解析與分類（桌面版 R2、R12、R57；iOS 版 R126；Android 版 R150）。由 iOS 版的 Source.swift 改寫。 */
sealed class ParsedSource {
    enum class Kind { YOUTUBE, HLS, MP4, WEB }

    data class YouTube(val videoId: String) : ParsedSource()
    data class Hls(override val url: String) : ParsedSource()
    data class Mp4(override val url: String) : ParsedSource()
    data class Web(override val url: String) : ParsedSource()

    val kind: Kind
        get() = when (this) {
            is YouTube -> Kind.YOUTUBE
            is Hls -> Kind.HLS
            is Mp4 -> Kind.MP4
            is Web -> Kind.WEB
        }

    /** 直接連結與網頁來源的網址；YouTube 影片沒有（用影片代碼）。 */
    open val url: String? get() = null
}

object SourceParser {
    private val youtubeHosts = setOf("youtube.com", "www.youtube.com", "m.youtube.com")

    /** 解析使用者輸入的網址；不支援時回傳 null。 */
    fun parse(input: String): ParsedSource? {
        val url = WebUrl.parse(input) ?: return null

        youtubeId(url)?.let { return ParsedSource.YouTube(it) }

        val path = url.path.lowercase()
        if (path.endsWith(".m3u8")) return ParsedSource.Hls(url.href)
        if (path.endsWith(".mp4")) return ParsedSource.Mp4(url.href)
        // youtu.be 只有影片網址；youtube.com 的其他頁面（首頁、搜尋、頻道、播放清單、Shorts）當作 YouTube 網站頁面（R57）
        if (url.host == "youtu.be" || url.host.endsWith(".youtu.be")) return null
        return ParsedSource.Web(url.href)
    }

    /**
     * 格子實際使用的來源：改用 YouTube 網頁播放時（R48），以網頁來源載入這部影片的 YouTube 網頁，
     * 格子的網址仍是原本的 YouTube 網址。
     */
    fun resolve(input: String, youtubeWeb: Boolean): ParsedSource? {
        val parsed = parse(input)
        if (youtubeWeb && parsed is ParsedSource.YouTube) {
            return ParsedSource.Web(watchPageUrl(parsed.videoId))
        }
        return parsed
    }

    /** YouTube 網站頁面（R57）：youtube.com 網域、但不是單一影片的頁面，以網頁來源的整頁模式瀏覽。 */
    fun isYouTubeSite(input: String): Boolean {
        val parsed = parse(input) as? ParsedSource.Web ?: return false
        val url = WebUrl.parse(parsed.url) ?: return false
        return isYouTubeDomain(url.host)
    }

    /** YouTube 影片代碼：11 個英數、`_`、`-`。 */
    fun isVideoId(text: String): Boolean = text.length == 11 && text.all(::isIdCharacter)

    fun watchPageUrl(videoId: String): String = "https://www.youtube.com/watch?v=$videoId"

    /** youtube.com、youtu.be 和它們的子網域。 */
    internal fun isYouTubeDomain(host: String): Boolean =
        listOf("youtube.com", "youtu.be").any { host == it || host.endsWith(".$it") }

    internal fun isIdCharacter(c: Char): Boolean =
        c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '_' || c == '-'

    private fun youtubeId(url: WebUrl): String? {
        val segments = url.segments
        val id = when {
            url.host == "youtu.be" -> segments.singleOrNull()
            url.host in youtubeHosts -> when {
                segments.size == 1 && segments[0] == "watch" -> url.queryValue("v")
                segments.size == 2 && (segments[0] == "live" || segments[0] == "embed") -> segments[1]
                else -> null
            }
            else -> null
        }
        return id?.takeIf(::isVideoId)
    }
}

/**
 * http(s) 網址的各個部分，整理成和瀏覽器的 `URL` 相同的寫法：
 * 協定與網域小寫、沒有路徑時補 `/`、省略預設的連接埠。
 */
internal class WebUrl private constructor(
    val scheme: String,
    val host: String,
    val port: Int?,
    /** 百分比編碼後的路徑，至少是 `/`。 */
    val path: String,
    val query: String?,
    val fragment: String?,
    private val userInfo: String?,
) {
    /** 路徑中不是空白的各段。 */
    val segments: List<String> get() = path.split('/').filter { it.isNotEmpty() }

    /** 路徑的最後一段（可能是空的），例如檔名。 */
    val lastPathComponent: String get() = path.substringAfterLast('/')

    /** 第一個同名 query 參數的值（百分比解碼；和 iOS 的 URLComponents 一樣，`+` 不當成空白）。 */
    fun queryValue(name: String): String? {
        val query = query ?: return null
        for (item in query.split('&')) {
            val key = item.substringBefore('=')
            if (percentDecode(key) == name) {
                return if ('=' in item) percentDecode(item.substringAfter('=')) else null
            }
        }
        return null
    }

    val href: String
        get() = buildString {
            append(scheme).append("://")
            userInfo?.let { append(it).append('@') }
            append(host)
            port?.let { append(':').append(it) }
            append(path)
            query?.let { append('?').append(it) }
            fragment?.let { append('#').append(it) }
        }

    companion object {
        fun parse(input: String): WebUrl? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            val uri = try {
                URI(trimmed)
            } catch (_: URISyntaxException) {
                return null
            }
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "http" && scheme != "https") return null
            if (uri.isOpaque) return null
            val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
            val defaultPort = if (scheme == "https") 443 else 80
            val port = uri.port.takeIf { it != -1 && it != defaultPort }
            val path = uri.rawPath.orEmpty().ifEmpty { "/" }
            val userInfo = uri.rawUserInfo?.takeIf { it.isNotEmpty() && !it.startsWith(":") }
                ?.let { if (it.endsWith(":")) it.dropLast(1) else it }
            return WebUrl(scheme, host, port, path, uri.rawQuery, uri.rawFragment, userInfo)
        }

        /** 百分比解碼（UTF-8）；不是合法的 UTF-8 時回傳 null（對應 Swift 的 removingPercentEncoding）。 */
        fun percentDecodeOrNull(text: String): String? {
            val decoded = percentDecode(text)
            return if ('\uFFFD' in decoded && '\uFFFD' !in text) null else decoded
        }

        private fun percentDecode(text: String): String {
            if ('%' !in text) return text
            val bytes = java.io.ByteArrayOutputStream()
            var i = 0
            while (i < text.length) {
                val c = text[i]
                if (c == '%' && i + 2 < text.length) {
                    val hex = text.substring(i + 1, i + 3).toIntOrNull(16)
                    if (hex != null) {
                        bytes.write(hex)
                        i += 3
                        continue
                    }
                }
                bytes.write(c.toString().toByteArray(Charsets.UTF_8))
                i++
            }
            return bytes.toString(Charsets.UTF_8)
        }
    }
}
