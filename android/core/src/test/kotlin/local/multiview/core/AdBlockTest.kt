package local.multiview.core

import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 廣告阻擋的比對（R157）。規則的格式是 ios/scripts/easylist-to-webkit.mjs 的輸出。 */
class AdBlockTest {
    private val host = """^[a-z][a-z0-9+.-]*://([^/]*\\.)?"""

    private fun rule(filter: String, type: String = "block", extra: String = "") =
        """{"trigger":{"url-filter":"$filter"$extra},"action":{"type":"$type"}}"""

    private fun engine(vararg rules: String) = AdBlockEngine.load(listOf("[${rules.joinToString(",")}]"))

    private val script = AdBlockEngine.ResourceType.SCRIPT
    private val image = AdBlockEngine.ResourceType.IMAGE

    @Test
    fun hostRule() {
        // ||ads.example.com^
        val engine = engine(rule("${host}ads\\\\.example\\\\.com[/:?=&]"))
        assertTrue(engine.shouldBlock("https://ads.example.com/banner.js", "news.example.org", script))
        assertTrue(engine.shouldBlock("https://x.ads.example.com/a", "news.example.org", null))
        assertTrue(engine.shouldBlock("HTTPS://ADS.Example.com/a", null, null))
        assertFalse(engine.shouldBlock("https://example.com/ads.example.com", "news.example.org", script))
        assertFalse(engine.shouldBlock("https://notads.example.com/a", "news.example.org", script))
    }

    @Test
    fun pathRuleAndWildcard() {
        // /banner/ads/*  與  -ad-300x250.
        val engine = engine(rule("/banner/ads/"), rule("-ad-300x250\\\\."))
        assertTrue(engine.shouldBlock("https://cdn.example.com/banner/ads/1.png", "a.com", image))
        assertTrue(engine.shouldBlock("https://cdn.example.com/x-ad-300x250.gif", "a.com", image))
        assertFalse(engine.shouldBlock("https://cdn.example.com/banner/adsense.png", "a.com", image))
    }

    @Test
    fun resourceTypeAndLoadType() {
        val engine = engine(
            rule("/track\\\\.js", extra = ""","resource-type":["script"]"""),
            rule("${host}widgets\\\\.example[/:?=&]", extra = ""","load-type":["third-party"]"""),
        )
        assertTrue(engine.shouldBlock("https://a.com/track.js", "a.com", script))
        assertFalse(engine.shouldBlock("https://a.com/track.js", "a.com", image))
        // 不知道類型時不看類型限制
        assertTrue(engine.shouldBlock("https://a.com/track.js", "a.com", null))
        // 第三方才擋
        assertTrue(engine.shouldBlock("https://widgets.example/w.js", "news.com", script))
        assertFalse(engine.shouldBlock("https://widgets.example/w.js", "www.widgets.example", script))
    }

    @Test
    fun domainLimits() {
        val engine = engine(
            rule("/promo/", extra = ""","if-domain":["*shop.example"]"""),
            rule("/sponsor/", extra = ""","unless-domain":["*friendly.example"]"""),
        )
        assertTrue(engine.shouldBlock("https://cdn.x/promo/a.png", "www.shop.example", image))
        assertFalse(engine.shouldBlock("https://cdn.x/promo/a.png", "other.example", image))
        // 不知道網頁的網域：有 if-domain 的規則不作用
        assertFalse(engine.shouldBlock("https://cdn.x/promo/a.png", null, image))
        assertTrue(engine.shouldBlock("https://cdn.x/sponsor/a.png", "other.example", image))
        assertFalse(engine.shouldBlock("https://cdn.x/sponsor/a.png", "sub.friendly.example", image))
    }

    @Test
    fun exceptionsAndAllowedPages() {
        val engine = engine(
            rule("${host}ads\\\\.example\\\\.com[/:?=&]"),
            rule("${host}ads\\\\.example\\\\.com/needed\\\\.js", type = "ignore-previous-rules"),
            rule(".*", type = "ignore-previous-rules", extra = ""","if-domain":["*trusted.example"]"""),
        )
        assertTrue(engine.shouldBlock("https://ads.example.com/banner.js", "a.com", script))
        assertFalse(engine.shouldBlock("https://ads.example.com/needed.js", "a.com", script))
        // 整個網站不阻擋
        assertFalse(engine.shouldBlock("https://ads.example.com/banner.js", "www.trusted.example", script))
        assertEquals(2, engine.networkRuleCount)
    }

    @Test
    fun exceptionsRepeatedInEveryListAreCountedOnce() {
        val exception = rule("${host}ok\\\\.example[/:?=&]", type = "ignore-previous-rules")
        val engine = AdBlockEngine.load(listOf("[${rule("/a1/")},$exception]", "[${rule("/a2/")},$exception]"))
        assertEquals(3, engine.networkRuleCount)
    }

    @Test
    fun cosmeticCss() {
        val engine = AdBlockEngine.load(
            listOf(
                """[
                  {"trigger":{"url-filter":".*"},"action":{"type":"css-display-none","selector":".ad, #banner"}},
                  {"trigger":{"url-filter":".*","if-domain":["*news.example"]},"action":{"type":"css-display-none","selector":".sponsored"}},
                  {"trigger":{"url-filter":".*","unless-domain":["*news.example"]},"action":{"type":"css-display-none","selector":".promo"}},
                  {"trigger":{"url-filter":".*","if-domain":["*trusted.example"]},"action":{"type":"ignore-previous-rules"}}
                ]""",
            ),
        )
        assertEquals(".ad, #banner{display:none!important}\n.sponsored{display:none!important}\n", engine.cosmeticCss("www.news.example"))
        assertEquals(".ad, #banner{display:none!important}\n.promo{display:none!important}\n", engine.cosmeticCss("other.example"))
        assertEquals("", engine.cosmeticCss("trusted.example"))
        assertEquals(3, engine.cosmeticRuleCount)
    }

    @Test
    fun brokenInputIsIgnored() {
        assertFalse(AdBlockEngine.load(listOf("not json", "{}", "[1, {\"trigger\":{}}]")).shouldBlock("https://a.com/x", "a.com", null))
        assertFalse(AdBlockEngine.EMPTY.shouldBlock("https://ads.example.com/x", "a.com", null))
        // 編譯不了的正規表示式當作不符合
        assertFalse(engine(rule("/ads/(")).shouldBlock("https://a.com/ads/(", "a.com", null))
    }

    @Test
    fun filterTokens() {
        val prefix = """^[a-z][a-z0-9+.-]*://([^/]*\.)?"""
        assertEquals(listOf("ads", "example", "com"), AdBlockEngine.filterTokens("""${prefix}ads\.example\.com[/:?=&]"""))
        // 沒有固定開頭、結尾的字不能用（可能只是網址裡某個字的一部分）
        assertEquals(listOf("banner", "ads"), AdBlockEngine.filterTokens("""/banner/ads/"""))
        assertEquals(listOf("ads"), AdBlockEngine.filterTokens("""banner/ads/"""))
        assertEquals(emptyList(), AdBlockEngine.filterTokens("""banner"""))
        // 萬用字元旁邊的字不能用
        assertEquals(listOf("mid"), AdBlockEngine.filterTokens("""/pre.*post/mid/x.*"""))
        // 結尾固定時最後一個字可以用
        assertEquals(listOf("swf"), AdBlockEngine.filterTokens("""\.swf$"""))
        assertEquals("example", AdBlockEngine.bestToken("""${prefix}ads\.example\.com[/:?=&]"""))
        assertNull(AdBlockEngine.bestToken("""banner"""))
    }

    @Test
    fun urlHelpers() {
        assertEquals(setOf("https", "ads", "example", "com", "a", "b1", "js", "x", "1"), AdBlockEngine.urlTokens("https://ADS.example.com/a_b1.js?x=1"))
        assertEquals("ads.example.com", AdBlockEngine.hostOf("https://user@ADS.example.com:8443/a?b"))
        assertNull(AdBlockEngine.hostOf("data:text/plain,hi"))
        assertEquals("example.com", AdBlockEngine.siteOf("a.b.example.com"))
        assertEquals("example.com.tw", AdBlockEngine.siteOf("news.example.com.tw"))
        assertEquals("example.co.uk", AdBlockEngine.siteOf("www.example.co.uk"))
        assertTrue(AdBlockEngine.sameSite("news.tvbs.com.tw", "static.tvbs.com.tw"))
        assertFalse(AdBlockEngine.sameSite("news.tvbs.com.tw", "ads.other.com.tw"))
        assertTrue(AdBlockEngine.domainMatches("*example.com", "a.example.com"))
        assertFalse(AdBlockEngine.domainMatches("*example.com", "notexample.com"))
        assertFalse(AdBlockEngine.domainMatches("example.com", "a.example.com"))
    }

    @Test
    fun guessType() {
        assertEquals(AdBlockEngine.ResourceType.SCRIPT, AdBlockEngine.guessType("https://a.com/x.js?v=1", "*/*"))
        assertEquals(AdBlockEngine.ResourceType.IMAGE, AdBlockEngine.guessType("https://a.com/pixel", "image/avif,image/webp,*/*"))
        assertEquals(AdBlockEngine.ResourceType.STYLE, AdBlockEngine.guessType("https://a.com/s", "text/css,*/*;q=0.1"))
        assertEquals(AdBlockEngine.ResourceType.DOCUMENT, AdBlockEngine.guessType("https://a.com/frame", "text/html,application/xhtml+xml"))
        assertEquals(AdBlockEngine.ResourceType.MEDIA, AdBlockEngine.guessType("https://a.com/v/seg1.ts", null))
        assertNull(AdBlockEngine.guessType("https://a.com/api/data", "*/*"))
    }

    /**
     * 用真正的 EasyList 測效能（R157：每個請求平均 1 毫秒以內）。
     * 規則要先轉好：`node ios/scripts/easylist-to-webkit.mjs resources/easylist.txt android/core/build/adblock`
     * （GitHub Actions 會先執行；沒有轉好的規則時略過這個測試）。
     */
    @Test
    fun realEasyListPerformance() {
        val directory = File("build/adblock")
        val files = directory.listFiles { file -> file.name.endsWith(".json") && file.name != "manifest.json" }.orEmpty()
        assumeTrue(files.isNotEmpty(), "沒有轉好的 EasyList 規則，略過")

        val loadStart = System.nanoTime()
        val engine = AdBlockEngine.load(files.sortedBy { it.name }.map { it.readText() })
        val loadMillis = (System.nanoTime() - loadStart) / 1e6
        assertTrue(engine.networkRuleCount > 20_000, "規則數量：${engine.networkRuleCount}")

        // 一定要擋、一定不能擋的例子
        assertTrue(engine.shouldBlock("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "news.tvbs.com.tw", script))
        assertTrue(engine.shouldBlock("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "example.com", script))
        assertFalse(engine.shouldBlock("https://news.tvbs.com.tw/videos/123", "news.tvbs.com.tw", AdBlockEngine.ResourceType.FETCH))
        assertFalse(engine.shouldBlock("https://www.youtube.com/iframe_api", "example.com", script))
        assertFalse(engine.shouldBlock("https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js", "example.com", script))

        val urls = listOf(
            "https://news.tvbs.com.tw/videos/123456",
            "https://static.tvbs.com.tw/css/main.20261101.css",
            "https://cdn.example.com/assets/js/app.3f9a1c.js",
            "https://images.example.com/photos/2026/11/14/abcdef123456_1200x630.jpg",
            "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
            "https://www.google-analytics.com/analytics.js",
            "https://video.example-cdn.net/live/stream_1080p/segment_000123.ts?token=abc123&expires=1794000000",
            "https://api.example.com/v2/articles?page=3&limit=20&sort=latest",
            "https://fonts.gstatic.com/s/notosanstc/v36/abc.woff2",
            "https://connect.facebook.net/en_US/fbevents.js",
        )
        // 先跑一輪讓正規表示式都編譯好，再計時
        repeat(3) { urls.forEach { engine.shouldBlock(it, "news.tvbs.com.tw", null) } }
        val rounds = 200
        val start = System.nanoTime()
        repeat(rounds) { urls.forEach { engine.shouldBlock(it, "news.tvbs.com.tw", null) } }
        val perRequest = (System.nanoTime() - start) / 1e6 / (rounds * urls.size)
        println(
            "EasyList：網路規則 ${engine.networkRuleCount}、隱藏規則 ${engine.cosmeticRuleCount}、" +
                "每個請求都要比對的規則 ${engine.untokenizedCount}；載入 ${"%.0f".format(loadMillis)} 毫秒；" +
                "每個請求 ${"%.3f".format(perRequest)} 毫秒；隱藏規則的 CSS ${engine.cosmeticCss("news.tvbs.com.tw").length / 1024}KB",
        )
        assertTrue(perRequest < 1.0, "每個請求 $perRequest 毫秒")
    }
}
