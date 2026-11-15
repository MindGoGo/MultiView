package local.multiview.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 從 yt-dlp 的解析結果選出串流（R89、R103、R135）。照搬 iOS 版的 YtDlpTests.swift。 */
class YtDlpTest {
    private val now = 1_794_000_000_000.0
    private val expireSeconds = 1_794_597_314.0
    private val manifest =
        "https://manifest.googlevideo.com/api/manifest/hls_variant/expire/${expireSeconds.toLong()}/ei/x/file/index.m3u8"

    /** 把 Kotlin 的值轉成 JSON（測試資料用）。 */
    private fun json(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is JsonElement -> value
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k as String to json(v) })
        is List<*> -> JsonArray(value.map(::json))
        else -> error("不支援的型別：$value")
    }

    /** iPhone 上實測到的一般影片（2026-11-13）：HLS 有主清單，另外有分開的影像、聲音，和影音合一的 18。 */
    private val vodFormats: List<Map<String, Any>> = listOf(
        mapOf("format_id" to "sb0", "ext" to "mhtml", "protocol" to "mhtml", "vcodec" to "none", "acodec" to "none", "url" to "https://i.ytimg.com/sb"),
        mapOf("format_id" to "233", "ext" to "mp4", "protocol" to "m3u8_native", "vcodec" to "none", "manifest_url" to manifest, "url" to "https://x/233.m3u8"),
        mapOf("format_id" to "140", "ext" to "m4a", "protocol" to "https", "vcodec" to "none", "acodec" to "mp4a.40.2", "url" to "https://x/videoplayback?itag=140"),
        mapOf("format_id" to "232", "ext" to "mp4", "protocol" to "m3u8_native", "height" to 720, "vcodec" to "avc1.4D401F", "acodec" to "none", "manifest_url" to manifest, "url" to "https://x/232.m3u8"),
        mapOf("format_id" to "136", "ext" to "mp4", "protocol" to "https", "height" to 720, "vcodec" to "avc1.4D401F", "acodec" to "none", "url" to "https://x/videoplayback?itag=136"),
        mapOf("format_id" to "18", "ext" to "mp4", "protocol" to "https", "height" to 360, "vcodec" to "avc1.42001E", "acodec" to "mp4a.40.2", "url" to "https://x/videoplayback?itag=18&expire=${expireSeconds.toLong()}"),
    )

    private fun info(formats: List<Map<String, Any>>, extra: Map<String, Any> = emptyMap()): JsonElement =
        json(mapOf("title" to "標題 2026-11-13 12:00", "fulltitle" to "標題", "formats" to formats) + extra)

    @Test
    fun vodPrefersHlsManifest() {
        val stream = YtDlpRules.pickStream(info(vodFormats, mapOf("live_status" to "not_live", "is_live" to false)), now)
        assertEquals(YtStream.Kind.HLS, stream?.kind)
        assertEquals(manifest, stream?.url)
        assertEquals(false, stream?.isLive)
        assertEquals("標題", stream?.title)
        assertEquals(expireSeconds * 1000, stream?.expiresAt)
    }

    @Test
    fun liveUsesHls() {
        val stream = YtDlpRules.pickStream(info(vodFormats, mapOf("is_live" to true)), now)
        assertEquals(YtStream.Kind.HLS, stream?.kind)
        assertEquals(true, stream?.isLive)
        assertEquals(true, YtDlpRules.pickStream(info(vodFormats, mapOf("live_status" to "is_live")), now)?.isLive)
    }

    @Test
    fun vodWithoutHlsUsesFormat18() {
        val formats = vodFormats.filter { it["protocol"] != "m3u8_native" }
        val stream = YtDlpRules.pickStream(info(formats), now)
        assertEquals(YtStream.Kind.MP4, stream?.kind)
        assertEquals(true, stream?.url?.contains("itag=18"))
        assertEquals(expireSeconds * 1000, stream?.expiresAt)
    }

    @Test
    fun otherSitesUseBestPlayableMuxedFormat() {
        val formats = listOf(
            mapOf("format_id" to "low", "ext" to "mp4", "protocol" to "https", "height" to 360, "url" to "https://x/low.mp4"),
            mapOf("format_id" to "avi", "ext" to "avi", "protocol" to "https", "height" to 1080, "url" to "https://x/high.avi"),
            mapOf("format_id" to "webm", "ext" to "webm", "protocol" to "https", "height" to 1080, "url" to "https://x/high.webm"),
            mapOf("format_id" to "high", "ext" to "mp4", "protocol" to "https", "height" to 720, "url" to "https://x/high.mp4"),
            mapOf("format_id" to "audio", "ext" to "mp4", "protocol" to "https", "vcodec" to "none", "url" to "https://x/audio.mp4"),
        )
        val stream = YtDlpRules.pickStream(info(formats), now)
        // 原生播放器不能播 avi、webm；沒有標示編碼的格式當作影音合一
        assertEquals("https://x/high.mp4", stream?.url)
        assertEquals(now + YtDlpRules.DEFAULT_EXPIRY, stream?.expiresAt)
    }

    @Test
    fun sameHeightKeepsFirst() {
        val formats = listOf(
            mapOf("format_id" to "a", "ext" to "mp4", "protocol" to "https", "height" to 720, "url" to "https://x/a.mp4"),
            mapOf("format_id" to "b", "ext" to "mp4", "protocol" to "https", "height" to 720, "url" to "https://x/b.mp4"),
        )
        assertEquals("https://x/a.mp4", YtDlpRules.pickStream(info(formats), now)?.url)
    }

    @Test
    fun hlsWithoutManifestUsesLastVideoFormat() {
        val formats = listOf(
            mapOf("format_id" to "a", "protocol" to "m3u8_native", "vcodec" to "none", "url" to "https://x/audio.m3u8"),
            mapOf("format_id" to "v1", "protocol" to "m3u8_native", "height" to 480, "url" to "https://x/480.m3u8"),
            mapOf("format_id" to "v2", "protocol" to "m3u8", "height" to 720, "url" to "https://x/720.m3u8"),
        )
        assertEquals("https://x/720.m3u8", YtDlpRules.pickStream(info(formats), now)?.url)
    }

    @Test
    fun nothingPlayable() {
        // 只有縮圖
        assertNull(YtDlpRules.pickStream(info(listOf(vodFormats[0])), now))
        // 還沒開始的直播
        assertNull(YtDlpRules.pickStream(info(listOf(vodFormats[5]), mapOf("live_status" to "is_upcoming")), now))
        // 直播只用 HLS
        assertNull(YtDlpRules.pickStream(info(listOf(vodFormats[5]), mapOf("is_live" to true)), now))
        assertNull(YtDlpRules.pickStream(null, now))
        assertNull(YtDlpRules.pickStream(JsonPrimitive("text"), now))
    }

    @Test
    fun postLiveUsesHls() {
        val stream = YtDlpRules.pickStream(info(vodFormats, mapOf("live_status" to "post_live", "is_live" to false)), now)
        assertEquals(YtStream.Kind.HLS, stream?.kind)
        assertEquals(false, stream?.isLive)
    }

    @Test
    fun playlistUsesFirstEntryWithFormats() {
        val playlist = json(mapOf("_type" to "playlist", "entries" to listOf(mapOf("title" to "沒有格式"), info(vodFormats))))
        assertEquals(manifest, YtDlpRules.pickStream(playlist, now)?.url)
        assertNull(YtDlpRules.pickStream(json(mapOf("_type" to "playlist", "entries" to emptyList<Any>())), now))
    }

    @Test
    fun headersKeepOnlyRefererAndUserAgent() {
        val formats = listOf(
            mapOf(
                "format_id" to "v", "ext" to "mp4", "protocol" to "https", "url" to "https://x/v.mp4",
                "http_headers" to mapOf("Referer" to "https://site.example/", "User-Agent" to "UA", "Cookie" to "secret", "Accept" to "*/*"),
            ),
        )
        assertEquals(
            mapOf("Referer" to "https://site.example/", "User-Agent" to "UA"),
            YtDlpRules.pickStream(info(formats), now)?.headers,
        )
    }

    @Test
    fun expiry() {
        assertEquals(1_794_597_314_000.0, YtDlpRules.expiry("https://x/videoplayback?expire=1794597314&a=1", now))
        assertEquals(1_794_597_314_000.0, YtDlpRules.expiry("https://x/videoplayback?a=1&expire=1794597314", now))
        assertEquals(expireSeconds * 1000, YtDlpRules.expiry(manifest, now))
        assertEquals(now + 5 * 60 * 60 * 1000, YtDlpRules.expiry("https://x/a.mp4", now))
        // 數字太短的不是時間
        assertEquals(now + YtDlpRules.DEFAULT_EXPIRY, YtDlpRules.expiry("https://x/a?expire=123", now))
    }

    @Test
    fun isUsable() {
        val stream = YtStream(YtStream.Kind.HLS, manifest, isLive = true, title = null, expiresAt = now + 60 * 60 * 1000)
        assertTrue(YtDlpRules.isUsable(stream, now))
        assertFalse(YtDlpRules.isUsable(stream, now + 55 * 60 * 1000))
    }

    @Test
    fun streamFromResolveOutput() {
        val ok = json(mapOf("ok" to true, "info" to info(vodFormats), "log" to emptyList<String>())).toString()
        assertEquals(ResolveResult.Success::class, YtDlpRules.streamFromResolveOutput(ok, now)::class)
        assertEquals(manifest, (YtDlpRules.streamFromResolveOutput(ok, now) as ResolveResult.Success).stream.url)

        fun error(text: String) = (YtDlpRules.streamFromResolveOutput(text, now) as? ResolveResult.Failure)?.message
        assertEquals("Video unavailable", error("{\"ok\":false,\"error\":\"Video unavailable\"}"))
        assertEquals("yt-dlp 解析失敗", error("{\"ok\":false}"))
        assertEquals("沒有可以播放的格式", error("{\"ok\":true,\"info\":{\"formats\":[]}}"))
        assertEquals("無法讀取 yt-dlp 的結果", error("not json"))
    }

    @Test
    fun webStreamHeaders() {
        val page = "https://www.twitch.tv/somebody"
        assertEquals(mapOf("Referer" to page), YtDlpRules.webStreamHeaders(page, emptyMap()))
        assertEquals(
            mapOf("User-Agent" to "UA", "Referer" to page),
            YtDlpRules.webStreamHeaders(page, mapOf("User-Agent" to "UA")),
        )
        // yt-dlp 有提供 Referer 時用 yt-dlp 的（大小寫不拘）
        val given = mapOf("referer" to "https://player.example/", "User-Agent" to "UA")
        assertEquals(given, YtDlpRules.webStreamHeaders(page, given))
    }
}
