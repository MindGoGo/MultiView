package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 預覽縮圖（R50，照搬桌面版 tests/unit/storyboard.test.ts）與字幕（R31 的規則、WebVTT）。 */
class StoryboardCaptionsTest {
    private val base = "https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L\$L/\$N.jpg?sqp=abc"
    private val spec = "$base|48#27#100#10#10#0#default#rs\$AAA|60#45#122#10#10#10000#M\$M#rs\$BBB|120#90#122#5#5#10000#M\$M#rs\$CCC"

    @Test
    fun extractSpec() {
        val html = "...,\"playerStoryboardSpecRenderer\":{\"spec\":\"https://i.ytimg.com/sb/x/storyboard3_L\$L/\$N.jpg?sqp=a\\u0026b=1|48#27#100#10#10#0#default#rs\$A\"},..."
        assertEquals("https://i.ytimg.com/sb/x/storyboard3_L\$L/\$N.jpg?sqp=a&b=1|48#27#100#10#10#0#default#rs\$A", StoryboardRules.extractSpec(html))
        assertNull(StoryboardRules.extractSpec("\"playerLiveStoryboardSpecRenderer\":{\"spec\":\"x\"}"))
        assertNull(StoryboardRules.extractSpec("<html></html>"))
    }

    @Test
    fun parse() {
        val sb = StoryboardRules.parse(spec)!!
        assertEquals(2, sb.level)
        assertEquals(StoryboardLevel(120, 90, 122, 5, 5, 10000.0, "M\$M", "rs\$CCC"), sb.info)
        assertEquals(2, StoryboardRules.parse("$spec|640#360#122#3#3#10000#M\$M#rs\$DDD")!!.level)
        assertNull(StoryboardRules.parse(""))
        assertNull(StoryboardRules.parse("not a url|1#2"))
        assertNull(StoryboardRules.parse("$base|48#27#100#10#10#0#default#rs\$AAA"))
    }

    @Test
    fun frame() {
        val sb = StoryboardRules.parse(spec)!!
        val first = StoryboardRules.frame(sb, 0.0, 1204.0)
        assertEquals("https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L2/M0.jpg?sqp=abc&sigh=rs\$CCC", first.url)
        assertEquals(listOf(0, 0, 120, 90), listOf(first.x, first.y, first.width, first.height))
        val f = StoryboardRules.frame(sb, 362.0, 1204.0)
        assertTrue(f.url.contains("/storyboard3_L2/M1.jpg"))
        assertEquals(listOf(120, 180), listOf(f.x, f.y))
        val last = StoryboardRules.frame(sb, 99999.0, 1204.0)
        assertTrue(last.url.contains("/M4.jpg"))
        assertEquals(listOf(0, 360), listOf(last.x, last.y))
        assertTrue(StoryboardRules.frame(sb, 5000.0, 5000.0).url.contains("/M4.jpg"))
        assertEquals(listOf(0, 0), StoryboardRules.frame(sb, -5.0, 100.0).let { listOf(it.x, it.y) })
    }

    private fun track(key: String, auto: Boolean = key.startsWith("asr:")) =
        CaptionTrack(key, key.removePrefix("asr:"), key, auto, "https://x/$key.vtt")

    @Test
    fun fromYtDlpAndFind() {
        val raw = JsonValues.parse(
            """[{"lang":"zh-Hant","name":"Chinese","url":"https://a","auto":false},
               {"lang":"en","name":"English","url":"https://b","auto":true},
               {"lang":"zh-Hant","url":"https://c","auto":false},{"lang":"","url":"https://d"}]""",
        )
        val tracks = CaptionRules.fromYtDlp(raw)
        assertEquals(listOf("zh-Hant", "asr:en"), tracks.map { it.key })
        assertTrue(tracks[1].label.endsWith("（自動產生）"))
        assertEquals(emptyList(), CaptionRules.fromYtDlp(null))

        val list = listOf(track("asr:en"), track("en"), track("ja"))
        assertEquals("asr:en", CaptionRules.find(list, "asr:en")?.key)
        // 同一種語言優先人工字幕
        assertEquals("en", CaptionRules.find(listOf(track("asr:en"), track("en")), "en")?.key)
        assertEquals("asr:en", CaptionRules.find(listOf(track("asr:en"), track("ja")), "en")?.key)
        assertNull(CaptionRules.find(list, "fr"))
        assertNull(CaptionRules.find(list, null))
    }

    @Test
    fun parseVtt() {
        val vtt = """WEBVTT
Kind: captions

00:00:01.000 --> 00:00:03.500 align:start position:0%
Hello &amp; <c.colorE5E5E5>world</c>

00:00:03.500 --> 00:00:03.510
Hello & world

00:00:03.510 --> 00:00:06.000
Hello & world
second<00:00:04.000><c> line</c>

1:00:00.000 --> 1:00:02.000
late
"""
        val cues = CaptionRules.parseVtt(vtt)
        assertEquals(3, cues.size)
        assertEquals(Cue(1.0, 3.5, "Hello & world"), cues[0])
        // 捲動的兩行：上一段的那一行不重複顯示
        assertEquals(Cue(3.51, 6.0, "second line"), cues[1])
        assertEquals(3600.0, cues[2].start)
        assertEquals("Hello & world", CaptionRules.cueAt(cues, 2.0))
        assertNull(CaptionRules.cueAt(cues, 7.0))
    }

    @Test
    fun sheetStoryboard() {
        val raw = JsonValues.parse(
            """{"width":160,"height":90,"rows":5,"columns":5,
               "sheets":[{"url":"https://s/0.jpg","duration":250.0},{"url":"https://s/1.jpg","duration":250.0},{"url":"https://s/2.jpg","duration":40.0}]}""",
        )
        val sb = SheetStoryboard.fromYtDlp(raw)!!
        // 每張 10 秒（250 秒 / 25 張）
        assertEquals(StoryboardFrame("https://s/0.jpg", 0, 0, 160, 90), sb.frame(0.0, 540.0))
        assertEquals(StoryboardFrame("https://s/0.jpg", 160, 90, 160, 90), sb.frame(65.0, 540.0))
        assertEquals(StoryboardFrame("https://s/1.jpg", 0, 0, 160, 90), sb.frame(250.0, 540.0))
        // 超過長度用最後一張 sheet；負的當作 0
        assertEquals("https://s/2.jpg", sb.frame(9999.0, 540.0)!!.url)
        assertEquals(0, sb.frame(-3.0, 540.0)!!.x)
        // 沒有 sheet 的長度：用影片長度平均分配
        val noDuration = sb.copy(sheets = sb.sheets.map { it.copy(duration = null) })
        assertEquals("https://s/1.jpg", noDuration.frame(300.0, 750.0)!!.url)
        assertNull(SheetStoryboard.fromYtDlp(JsonValues.parse("""{"width":160,"height":90,"rows":5,"columns":5,"sheets":[]}""")))
        assertNull(SheetStoryboard.fromYtDlp(null))
    }
}
