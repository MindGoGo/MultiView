package local.multiview.core

import local.multiview.core.JsonValues.array
import local.multiview.core.JsonValues.bool
import local.multiview.core.JsonValues.nonEmptyString
import local.multiview.core.JsonValues.number
import local.multiview.core.JsonValues.obj
import local.multiview.core.JsonValues.string
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import kotlin.math.floor

/* YouTube 訂閱（桌面版 R59–R61；Android 版 R158）：頻道網址辨識、頻道資訊、頻道摘要的解析。由 iOS 版的 YouTubeFeed.swift 改寫。 */

/** 頻道摘要裡的一部影片（R59）。 */
data class FeedVideo(
    val videoId: String,
    val title: String,
    /** 發布時間（毫秒）。 */
    val published: Double,
)

data class ChannelLookup(val page: String, val kind: YouTubeFeed.LookupKind)

data class ChannelInfo(val id: String, val name: String)

object YouTubeFeed {
    enum class LookupKind { CHANNEL, VIDEO }

    /** 名稱旁顯示的新影片：24 小時內發布的（R59）。 */
    const val NEW_VIDEO_INTERVAL = 24.0 * 3600 * 1000

    /** 最新影片多久自動更新一次（面板開著時，R59）。 */
    const val REFRESH_INTERVAL = 15.0 * 60 * 1000

    fun feedUrl(channelId: String): String = "https://www.youtube.com/feeds/videos.xml?channel_id=$channelId"

    /**
     * 頻道摘要的網址，依序嘗試：頻道的摘要、頻道「上傳的影片」播放清單的摘要。
     * （YouTube 的摘要對 App 回傳 404，2026-11-14 實測；Android 版和 iOS 版一樣改用 yt-dlp，這個函式保留給測試與備用。）
     */
    fun feedUrls(channelId: String): List<String> {
        val urls = mutableListOf(feedUrl(channelId))
        if (channelId.startsWith("UC")) {
            urls += "https://www.youtube.com/feeds/videos.xml?playlist_id=UU${channelId.drop(2)}"
        }
        return urls
    }

    fun liveUrl(channelId: String): String = "https://www.youtube.com/channel/$channelId/live"

    /**
     * 加入頻道時貼上的網址（R59）：頻道頁（/@帳號、/channel/UC…、/c/…、/user/…）或影片網址。
     * 回傳要讀取的網頁網址；不是頻道或影片時回傳 null。
     */
    fun channelLookup(input: String): ChannelLookup? {
        val parsed = SourceParser.parse(input) ?: return null
        if (parsed is ParsedSource.YouTube) {
            return ChannelLookup(SourceParser.watchPageUrl(parsed.videoId), LookupKind.VIDEO)
        }
        val url = (parsed as? ParsedSource.Web)?.url?.let(WebUrl::parse) ?: return null
        if (url.host != "youtube.com" && !url.host.endsWith(".youtube.com")) return null
        val segments = url.segments
        val first = segments.firstOrNull() ?: return null
        val second = segments.getOrNull(1)
        if (first.startsWith("@") || first.startsWith("%40")) {
            return ChannelLookup("https://www.youtube.com/$first", LookupKind.CHANNEL)
        }
        if (first == "channel" && second != null && Channel.isId(second)) {
            return ChannelLookup(Channel.pageUrl(second), LookupKind.CHANNEL)
        }
        if ((first == "c" || first == "user") && second != null) {
            return ChannelLookup("https://www.youtube.com/$first/$second", LookupKind.CHANNEL)
        }
        return null
    }

    /** 從頻道頁或影片頁的 HTML 取出頻道代碼與名稱；取不到時回傳 null。 */
    fun extractChannelInfo(html: String, kind: LookupKind): ChannelInfo? = when (kind) {
        LookupKind.VIDEO -> {
            val id = firstMatch(""""channelId":"(UC[\w-]{22})"""", html)
            val name = firstMatch(""""ownerChannelName":"((?:[^"\\]|\\.)*)"""", html)
                ?: firstMatch(""""author":"((?:[^"\\]|\\.)*)"""", html)
            if (id != null && name != null) ChannelInfo(id, decodeJsonString(name)) else null
        }
        LookupKind.CHANNEL -> {
            val id = firstMatch(""""externalId":"(UC[\w-]{22})"""", html)
                ?: firstMatch("""<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"""", html)
            val name = firstMatch("""<meta property="og:title" content="([^"]*)"""", html)
            if (id != null && name != null) ChannelInfo(id, decodeEntities(name)) else null
        }
    }

    /** 解析頻道摘要（Atom XML），新的在上面；格式不對時回傳 null。 */
    fun parseFeed(xml: String): List<FeedVideo>? {
        if ("<feed" !in xml) return null
        val videos = Regex("""<entry>([\s\S]*?)</entry>""").findAll(xml).mapNotNull { match ->
            val entry = match.groupValues[1]
            val videoId = firstMatch("""<yt:videoId>([^<]+)</yt:videoId>""", entry) ?: return@mapNotNull null
            val title = firstMatch("""<title>([^<]*)</title>""", entry) ?: return@mapNotNull null
            val published = firstMatch("""<published>([^<]+)</published>""", entry)?.let(::parseDate) ?: return@mapNotNull null
            FeedVideo(videoId, decodeEntities(title), published)
        }.toList()
        // 穩定排序：發布時間一樣時維持摘要裡的順序
        return videos.sortedByDescending { it.published }
    }

    /**
     * 頻道直播頁的 HTML → 正在直播的影片代碼（R60）。
     * 正在直播時直播頁指向那場直播的影片，並標示直播中；已排程、還沒開始的直播不算。判斷不了時回傳 null。
     */
    fun parseLiveStatus(html: String): String? {
        val id = firstMatch("""<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"""", html)
            ?: return null
        if (""""isLive":true""" !in html || """"isUpcoming":true""" in html) return null
        return id
    }

    /**
     * Google Takeout 匯出的 YouTube 訂閱檔（subscriptions.csv，R61）。
     * 不同語言的欄位名稱不同，所以用內容辨識：頻道代碼欄、網址欄，其餘的是名稱。
     * 找不到任何頻道時回傳 null（不是訂閱檔）。回傳的頻道加入時間是 0。
     */
    fun parseTakeoutCsv(text: String): List<Channel>? {
        val out = mutableListOf<Channel>()
        // 去掉檔案開頭的 BOM，Windows 與 Unix 的換行都可以
        for (line in text.removePrefix("﻿").split('\n', '\r').filter { it.isNotEmpty() }) {
            val cells = splitCsvLine(line)
            val id = cells.firstOrNull(Channel::isId) ?: continue
            if (out.any { it.id == id }) continue
            val name = cells.firstOrNull { it.isNotEmpty() && it != id && !isWebAddress(it) } ?: id
            out += Channel(id, name, Channel.pageUrl(id), 0.0)
        }
        return out.ifEmpty { null }
    }

    /**
     * mv_bridge.channel_videos 的結果 → 最新影片；失敗時回傳錯誤訊息。
     * 沒有時間的影片 published 是 0（維持頻道頁的順序）。
     */
    fun parseChannelVideos(text: String): Outcome<List<FeedVideo>, String> {
        val result = obj(JsonValues.parse(text)) ?: return Outcome.Err("無法讀取 yt-dlp 的結果")
        if (bool(result["ok"]) != true) return Outcome.Err(nonEmptyString(result["error"]) ?: "yt-dlp 讀取失敗")
        val videos = array(result["videos"]).orEmpty().mapNotNull { raw ->
            val video = obj(raw) ?: return@mapNotNull null
            val id = string(video["id"])?.takeIf(SourceParser::isVideoId) ?: return@mapNotNull null
            FeedVideo(id, string(video["title"]) ?: id, number(video["timestamp"])?.let { it * 1000 } ?: 0.0)
        }
        return Outcome.Ok(videos)
    }

    fun countNew(videos: List<FeedVideo>, now: Double): Int =
        videos.count { it.published > 0 && now - it.published < NEW_VIDEO_INTERVAL }

    /** 發布時間的簡短說明，例如「3 小時前」「2 天前」。 */
    fun formatAgo(published: Double, now: Double): String {
        // 不知道發布時間（yt-dlp 推算不出來）
        if (!(published > 0)) return ""
        val minutes = maxOf(0L, floor((now - published) / 60000).toLong())
        if (minutes < 60) return "${maxOf(minutes, 1)} 分鐘前"
        val hours = minutes / 60
        if (hours < 24) return "$hours 小時前"
        val days = hours / 24
        if (days < 30) return "$days 天前"
        val months = days / 30
        return if (months < 12) "$months 個月前" else "${months / 12} 年前"
    }

    /** 解碼 HTML／XML 的字元參照。 */
    fun decodeEntities(text: String): String {
        val out = StringBuilder()
        var index = 0
        while (true) {
            val start = text.indexOf('&', index)
            if (start < 0) break
            out.append(text, index, start)
            val end = text.indexOf(';', start)
            val decoded = if (end >= 0 && end - start <= 10) decodeEntity(text.substring(start + 1, end)) else null
            if (decoded != null) {
                out.append(decoded)
                index = end + 1
            } else {
                out.append('&')
                index = start + 1
            }
        }
        return out.append(text, index, text.length).toString()
    }

    // 內部

    private fun decodeEntity(name: String): String? = when (name) {
        "quot" -> "\""
        "apos" -> "'"
        "lt" -> "<"
        "gt" -> ">"
        "amp" -> "&"
        else -> {
            if (!name.startsWith("#")) {
                null
            } else {
                val digits = name.drop(1)
                val value = if (digits.startsWith("x") || digits.startsWith("X")) {
                    digits.drop(1).toIntOrNull(16)
                } else {
                    digits.toIntOrNull(10)
                }
                // 不是合法的 Unicode 字元（超出範圍、代理字元）時不解碼
                value?.takeIf { it in 0..0x10FFFF && it !in 0xD800..0xDFFF }?.let { String(Character.toChars(it)) }
            }
        }
    }

    /** JSON 字串內容的跳脫字元（例如 &、\"）。 */
    private fun decodeJsonString(text: String): String = string(JsonValues.parse("\"$text\"")) ?: text

    private fun parseDate(text: String): Double? = try {
        OffsetDateTime.parse(text.trim()).toInstant().toEpochMilli().toDouble()
    } catch (_: DateTimeParseException) {
        null
    }

    private fun isWebAddress(text: String): Boolean {
        val lower = text.lowercase()
        return lower.startsWith("http://") || lower.startsWith("https://")
    }

    /** 拆開一行 CSV（支援引號、引號內的逗號與 "" 跳脫）。 */
    internal fun splitCsvLine(line: String): List<String> {
        val out = mutableListOf<String>()
        val current = StringBuilder()
        var quoted = false
        var index = 0
        while (index < line.length) {
            val character = line[index]
            when {
                quoted && character == '"' && index + 1 < line.length && line[index + 1] == '"' -> {
                    current.append('"')
                    index++
                }
                quoted && character == '"' -> quoted = false
                quoted -> current.append(character)
                character == '"' -> quoted = true
                character == ',' -> {
                    out += current.toString()
                    current.clear()
                }
                else -> current.append(character)
            }
            index++
        }
        out += current.toString()
        return out.map { it.trim(' ', '\t') }
    }

    /** 第一個符合的地方的第一個括號內容。 */
    private fun firstMatch(pattern: String, text: String): String? = Regex(pattern).find(text)?.groupValues?.get(1)
}
