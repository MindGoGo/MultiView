package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 網址解析（R2、R12、R57）。照搬 iOS 版的 SourceTests.swift（又是從桌面版 tests/unit/source.test.ts、web-source.test.ts 來的）。 */
class SourceTest {
    private val id = "jfKfPfyJRdk"

    @Test
    fun youTubeUrls() {
        val urls = listOf(
            "https://www.youtube.com/watch?v=$id",
            "https://youtube.com/watch?v=$id",
            "https://m.youtube.com/watch?v=$id",
            "http://www.youtube.com/watch?v=$id",
            "https://youtu.be/$id",
            "https://www.youtube.com/live/$id",
            "https://www.youtube.com/embed/$id",
        )
        for (url in urls) {
            assertEquals(ParsedSource.YouTube(id), SourceParser.parse(url), url)
        }
    }

    @Test
    fun youTubeIgnoresOtherQueryItems() {
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("https://www.youtube.com/watch?v=$id&t=42s&list=PL123"))
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("https://youtu.be/$id?si=abc&t=10"))
    }

    @Test
    fun trimsWhitespace() {
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("  https://youtu.be/$id  "))
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("\nhttps://youtu.be/$id\n"))
    }

    @Test
    fun hostIsCaseInsensitive() {
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("HTTPS://WWW.YouTube.com/watch?v=$id"))
    }

    @Test
    fun youtuBeExtraPathIsRejected() {
        assertNull(SourceParser.parse("https://youtu.be/$id/extra"))
        assertNull(SourceParser.parse("https://youtu.be/"))
    }

    @Test
    fun otherYouTubePagesAreWebSources() {
        val urls = listOf(
            "https://www.youtube.com/shorts/$id",
            "https://www.youtube.com/watch?list=PL123",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/@somechannel",
        )
        for (url in urls) {
            assertEquals(ParsedSource.Kind.WEB, SourceParser.parse(url)?.kind, url)
            assertTrue(SourceParser.isYouTubeSite(url), url)
        }
    }

    @Test
    fun lookalikeDomainsAreWebSources() {
        assertEquals(ParsedSource.Kind.WEB, SourceParser.parse("https://notyoutube.com/watch?v=$id")?.kind)
        assertEquals(ParsedSource.Kind.WEB, SourceParser.parse("https://youtube.com.evil.example/watch")?.kind)
        assertFalse(SourceParser.isYouTubeSite("https://notyoutube.com/watch?v=$id"))
        assertFalse(SourceParser.isYouTubeSite("https://youtube.com.evil.example/watch"))
    }

    @Test
    fun directLinks() {
        assertEquals(
            ParsedSource.Hls("https://cdn.example.com/live/index.m3u8"),
            SourceParser.parse("https://cdn.example.com/live/index.m3u8"),
        )
        assertEquals(ParsedSource.Mp4("http://example.com/a/b.mp4"), SourceParser.parse("http://example.com/a/b.mp4"))
    }

    @Test
    fun directLinkExtensionIsCaseInsensitiveAndAllowsQuery() {
        assertEquals(ParsedSource.Kind.HLS, SourceParser.parse("https://x.com/v/STREAM.M3U8?token=abc")?.kind)
        assertEquals(ParsedSource.Kind.MP4, SourceParser.parse("https://x.com/v/Clip.MP4?x=1#t=5")?.kind)
        assertEquals("https://x.com/v/Clip.MP4?x=1#t=5", SourceParser.parse("https://x.com/v/Clip.MP4?x=1#t=5")?.url)
    }

    @Test
    fun extensionOnlyInQueryIsWebSource() {
        assertEquals(ParsedSource.Kind.WEB, SourceParser.parse("https://x.com/play?file=a.mp4")?.kind)
    }

    @Test
    fun unsupportedInputs() {
        val inputs = listOf(
            "example.com/video.mp4",
            "這不是網址",
            "",
            "   ",
            "ftp://example.com/a.mp4",
            "file:///C:/videos/a.mp4",
            "javascript:alert(1)",
            "twitch.tv/abc",
            "www.twitch.tv/abc",
            "ftp://example.com/live",
        )
        for (input in inputs) {
            assertNull(SourceParser.parse(input), input)
        }
    }

    @Test
    fun webSources() {
        assertEquals(ParsedSource.Web("https://www.twitch.tv/somechannel"), SourceParser.parse("https://www.twitch.tv/somechannel"))
        // 和瀏覽器一樣：沒有路徑時補上 /
        assertEquals(ParsedSource.Web("https://example.com/"), SourceParser.parse("https://example.com"))
        assertEquals(
            ParsedSource.Web("http://news.example.org/live?ch=1"),
            SourceParser.parse("  http://news.example.org/live?ch=1  "),
        )
    }

    @Test
    fun hrefNormalization() {
        assertEquals("http://example.com/Path", SourceParser.parse("HTTP://Example.COM:80/Path")?.url)
        assertEquals("https://example.com:8443/a", SourceParser.parse("https://example.com:8443/a")?.url)
    }

    @Test
    fun resolveYouTubeWeb() {
        val url = "https://youtu.be/$id"
        assertEquals(ParsedSource.YouTube(id), SourceParser.resolve(url, youtubeWeb = false))
        assertEquals(ParsedSource.Web("https://www.youtube.com/watch?v=$id"), SourceParser.resolve(url, youtubeWeb = true))
        // 不是 YouTube 影片時不受影響
        assertEquals(ParsedSource.Kind.MP4, SourceParser.resolve("https://example.com/a.mp4", youtubeWeb = true)?.kind)
        assertNull(SourceParser.resolve("nope", youtubeWeb = true))
    }

    @Test
    fun isYouTubeSite() {
        assertTrue(SourceParser.isYouTubeSite("https://www.youtube.com/"))
        assertTrue(SourceParser.isYouTubeSite("https://m.youtube.com/results?search_query=news"))
        assertFalse(SourceParser.isYouTubeSite("https://www.youtube.com/watch?v=$id"))
        assertFalse(SourceParser.isYouTubeSite("https://www.twitch.tv/abc"))
        assertFalse(SourceParser.isYouTubeSite("nope"))
    }

    @Test
    fun isVideoId() {
        assertTrue(SourceParser.isVideoId("jfKfPfyJRdk"))
        assertTrue(SourceParser.isVideoId("a_b-c_d-e_f"))
        assertFalse(SourceParser.isVideoId("short"))
        assertFalse(SourceParser.isVideoId("jfKfPfyJRdk1"))
        assertFalse(SourceParser.isVideoId("jfKfPfyJRd!"))
    }

    // Android 版另外補的：query 參數的百分比解碼
    @Test
    fun queryValueIsPercentDecoded() {
        assertEquals(ParsedSource.YouTube(id), SourceParser.parse("https://www.youtube.com/watch?feature=a%20b&v=$id"))
        assertEquals(ParsedSource.YouTube("a_b-c_d-e_f"), SourceParser.parse("https://www.youtube.com/watch?v=a_b%2Dc_d-e_f"))
    }
}
