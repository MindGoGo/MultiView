package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** YouTube 訂閱（R59–R61、R158）。照搬 iOS 版的 YouTubeFeedTests.swift。 */
class YouTubeFeedTest {
    private val channelId = "UC" + "a".repeat(22)
    private val videoId = "jfKfPfyJRdk"
    private val q = "\""

    @Test
    fun channelLookup() {
        fun lookup(input: String): String? = YouTubeFeed.channelLookup(input)?.let {
            "${if (it.kind == YouTubeFeed.LookupKind.CHANNEL) "channel" else "video"} ${it.page}"
        }
        assertEquals("channel https://www.youtube.com/@TED", lookup("https://www.youtube.com/@TED"))
        assertEquals("channel https://www.youtube.com/@TED", lookup("https://m.youtube.com/@TED/videos"))
        assertEquals("channel https://www.youtube.com/channel/$channelId", lookup("https://www.youtube.com/channel/$channelId"))
        assertEquals("channel https://www.youtube.com/c/TEDx", lookup("https://www.youtube.com/c/TEDx"))
        assertEquals("channel https://www.youtube.com/user/TEDtalks", lookup("https://www.youtube.com/user/TEDtalks"))
        assertEquals("video https://www.youtube.com/watch?v=$videoId", lookup("https://youtu.be/$videoId"))
        assertNull(lookup("https://www.youtube.com/channel/bad"))
        assertNull(lookup("https://www.youtube.com/"))
        assertNull(lookup("https://www.youtube.com/results?search_query=x"))
        assertNull(lookup("https://example.com/@TED"))
        assertNull(lookup("https://example.com/a.mp4"))
        assertNull(lookup("nope"))
    }

    @Test
    fun feedUrls() {
        val rest = "a".repeat(22)
        assertEquals(
            listOf(
                "https://www.youtube.com/feeds/videos.xml?channel_id=UC$rest",
                "https://www.youtube.com/feeds/videos.xml?playlist_id=UU$rest",
            ),
            YouTubeFeed.feedUrls(channelId),
        )
    }

    @Test
    fun extractChannelInfo() {
        val videoPage =
            "...,${q}channelId$q:$q$channelId$q,${q}isOwnerViewing$q:false,${q}ownerChannelName$q:${q}A \\u0026 B \\${q}頻道\\$q$q,${q}author$q:${q}x$q..."
        val video = YouTubeFeed.extractChannelInfo(videoPage, YouTubeFeed.LookupKind.VIDEO)
        assertEquals(channelId, video?.id)
        assertEquals("A & B \"頻道\"", video?.name)

        val channelPage = """<meta property="og:title" content="TED &amp; Friends"><script>{"externalId":"$channelId"}</script>"""
        val channel = YouTubeFeed.extractChannelInfo(channelPage, YouTubeFeed.LookupKind.CHANNEL)
        assertEquals(channelId, channel?.id)
        assertEquals("TED & Friends", channel?.name)

        val canonical = """<link rel="canonical" href="https://www.youtube.com/channel/$channelId"><meta property="og:title" content="名稱">"""
        assertEquals(channelId, YouTubeFeed.extractChannelInfo(canonical, YouTubeFeed.LookupKind.CHANNEL)?.id)

        assertNull(YouTubeFeed.extractChannelInfo("<html></html>", YouTubeFeed.LookupKind.CHANNEL))
        assertNull(YouTubeFeed.extractChannelInfo("<html></html>", YouTubeFeed.LookupKind.VIDEO))
    }

    @Test
    fun parseFeed() {
        val xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
         <title>頻道</title>
         <entry>
          <id>yt:video:aaaaaaaaaaa</id>
          <yt:videoId>aaaaaaaaaaa</yt:videoId>
          <title>舊的 &amp; 影片</title>
          <published>2026-11-10T08:00:00+00:00</published>
         </entry>
         <entry>
          <yt:videoId>bbbbbbbbbbb</yt:videoId>
          <title>新的 &#39;影片&#x27;</title>
          <published>2026-11-13T12:30:00+00:00</published>
         </entry>
         <entry>
          <yt:videoId>ccccccccccc</yt:videoId>
          <title>沒有時間</title>
         </entry>
        </feed>
        """
        val videos = YouTubeFeed.parseFeed(xml)
        assertEquals(listOf("bbbbbbbbbbb", "aaaaaaaaaaa"), videos?.map { it.videoId })
        assertEquals("新的 '影片'", videos?.first()?.title)
        assertEquals("舊的 & 影片", videos?.last()?.title)
        // 2026-11-13T12:30:00Z
        assertEquals(1_794_573_000_000.0, videos?.first()?.published)
        assertNull(YouTubeFeed.parseFeed("<html>不是摘要</html>"))
        assertEquals(emptyList(), YouTubeFeed.parseFeed("<feed></feed>"))
    }

    @Test
    fun parseLiveStatus() {
        val canonical = """<link rel="canonical" href="https://www.youtube.com/watch?v=$videoId">"""
        assertEquals(videoId, YouTubeFeed.parseLiveStatus("""$canonical{"isLive":true}"""))
        // 已排程、還沒開始的直播不算
        assertNull(YouTubeFeed.parseLiveStatus("""$canonical{"isLive":true,"isUpcoming":true}"""))
        assertNull(YouTubeFeed.parseLiveStatus(canonical))
        assertNull(YouTubeFeed.parseLiveStatus("""{"isLive":true}"""))
    }

    @Test
    fun parseTakeoutCsv() {
        val other = "UC" + "b".repeat(22)
        val english = "﻿Channel Id,Channel Url,Channel Title\r\n$channelId,http://www.youtube.com/channel/$channelId,TED\r\n" +
            "$other,http://www.youtube.com/channel/$other,\"Name, with comma\"\r\n$channelId,x,重複\r\n"
        val channels = YouTubeFeed.parseTakeoutCsv(english)
        assertEquals(listOf(channelId, other), channels?.map { it.id })
        assertEquals(listOf("TED", "Name, with comma"), channels?.map { it.name })
        assertEquals("https://www.youtube.com/channel/$channelId", channels?.first()?.url)

        // 中文介面匯出的檔案：欄位名稱不同、順序可能不同
        val chinese = "頻道 ID,頻道網址,頻道名稱\n$channelId,http://www.youtube.com/channel/$channelId,公視新聞網\n"
        assertEquals("公視新聞網", YouTubeFeed.parseTakeoutCsv(chinese)?.first()?.name)

        // 沒有名稱時用頻道代碼
        assertEquals(channelId, YouTubeFeed.parseTakeoutCsv("$channelId,http://x/\n")?.first()?.name)
        // 不是訂閱檔
        assertNull(YouTubeFeed.parseTakeoutCsv("name,price\napple,3\n"))
        assertNull(YouTubeFeed.parseTakeoutCsv(""))
    }

    @Test
    fun splitCsvLine() {
        assertEquals(listOf("a", "b,c", "d \"e\"", ""), YouTubeFeed.splitCsvLine("a, \"b,c\" ,\"d \"\"e\"\"\","))
    }

    @Test
    fun countNewAndFormatAgo() {
        val now = 1_794_600_000_000.0
        val hour = 3600.0 * 1000
        val videos = listOf(
            FeedVideo("a", "a", now - hour),
            FeedVideo("b", "b", now - 23 * hour),
            FeedVideo("c", "c", now - 25 * hour),
        )
        assertEquals(2, YouTubeFeed.countNew(videos, now))
        assertEquals("1 分鐘前", YouTubeFeed.formatAgo(now, now))
        assertEquals("59 分鐘前", YouTubeFeed.formatAgo(now - 59 * 60 * 1000, now))
        assertEquals("3 小時前", YouTubeFeed.formatAgo(now - 3 * hour, now))
        assertEquals("2 天前", YouTubeFeed.formatAgo(now - 48 * hour, now))
        assertEquals("1 個月前", YouTubeFeed.formatAgo(now - 45 * 24 * hour, now))
        assertEquals("2 年前", YouTubeFeed.formatAgo(now - 800 * 24 * hour, now))
    }

    @Test
    fun parseChannelVideos() {
        val ok = """{"ok": true, "videos": [{"id": "aaaaaaaaaaa", "title": "新的", "timestamp": 1794573000}, {"id": "bbbbbbbbbbb", "title": "沒有時間", "timestamp": null}, {"id": "bad", "title": "x"}]}"""
        val videos = YouTubeFeed.parseChannelVideos(ok).valueOrNull()!!
        assertEquals(listOf("aaaaaaaaaaa", "bbbbbbbbbbb"), videos.map { it.videoId })
        assertEquals(1_794_573_000_000.0, videos[0].published)
        assertEquals(0.0, videos[1].published)
        // 不知道發布時間：不顯示時間、不算新影片
        assertEquals("", YouTubeFeed.formatAgo(0.0, 1_794_600_000_000.0))
        assertEquals(1, YouTubeFeed.countNew(videos, 1_794_573_000_000.0 + 1000))

        assertEquals("HTTP Error 404", YouTubeFeed.parseChannelVideos("""{"ok": false, "error": "HTTP Error 404"}""").errorOrNull())
        assertEquals("無法讀取 yt-dlp 的結果", YouTubeFeed.parseChannelVideos("not json").errorOrNull())
    }

    @Test
    fun decodeEntities() {
        assertEquals("a & b <c> \"d\" 'e'", YouTubeFeed.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"))
        assertEquals("中文 '", YouTubeFeed.decodeEntities("&#20013;&#x6587; &#39;"))
        // 不認得的、沒有結尾的原樣保留
        assertEquals("R&D &nbsp; 100% & more;", YouTubeFeed.decodeEntities("R&D &nbsp; 100% & more;"))
    }
}
