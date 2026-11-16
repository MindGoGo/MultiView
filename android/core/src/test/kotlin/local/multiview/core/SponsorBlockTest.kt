package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** SponsorBlock 的規則（R161）。iOS 版的 SponsorBlockTests.swift 照搬同樣的案例。 */
class SponsorBlockTest {
    private val sponsor = SponsorCategory.SPONSOR

    private fun seg(start: Double, end: Double, id: String, category: SponsorCategory = sponsor) =
        SponsorSegment(start, end, category, id)

    private fun item(start: Any?, end: Any?, category: String = "sponsor", uuid: String = "u", action: String? = "skip") =
        buildMap<String, Any?> {
            put("segment", listOf(start, end))
            put("category", category)
            if (action != null) put("actionType", action)
            put("UUID", uuid)
            put("videoDuration", 600)
        }

    private fun response(vararg videos: Pair<String, List<Map<String, Any?>>>): String =
        j(videos.map { (id, segments) -> mapOf("videoID" to id, "hash" to "x", "segments" to segments) }).toString()

    @Test
    fun hashPrefixIsFirstFourHexOfSha256() {
        // SHA-256("dQw4w9WgXcQ") = 5f6b0b4e…（用 sha256sum 算的）
        assertEquals("5f6b", SponsorBlockRules.hashPrefix("dQw4w9WgXcQ"))
        // SHA-256("abc") = ba7816bf…
        assertEquals("ba78", SponsorBlockRules.hashPrefix("abc"))
    }

    @Test
    fun requestUrl() {
        assertEquals(
            "https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%5D",
            SponsorBlockRules.requestUrl("dQw4w9WgXcQ", listOf(sponsor)),
        )
        // 順序固定（照類別的定義順序），不管傳進來的順序
        assertEquals(
            "https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%2C%22intro%22%5D",
            SponsorBlockRules.requestUrl("dQw4w9WgXcQ", listOf(SponsorCategory.INTRO, sponsor)),
        )
        // 預設要全部的類別
        val all = SponsorBlockRules.requestUrl("dQw4w9WgXcQ")
        SponsorCategory.entries.forEach { assertTrue(all.contains("%22${it.raw}%22")) }
    }

    @Test
    fun parseKeepsOnlyThisVideoAndSkipSegments() {
        val text = response(
            "other" to listOf(item(1, 50, uuid = "o1")),
            "vid" to listOf(
                item(30.5, 60.25, uuid = "a"),
                item(100, 120, category = "intro", uuid = "b"),
                item(200, 210, action = "mute", uuid = "c"),
                item(300, 300, category = "poi_highlight", action = "poi", uuid = "d"),
                item(0, 600, category = "sponsor", action = "full", uuid = "e"),
                item(400, 420, category = "exclusive_access", uuid = "f"),
                item(500, 490, uuid = "g"),
                item("x", 10, uuid = "h"),
                item(5, 15, action = null, uuid = "i"),
            ),
        )
        assertEquals(
            listOf(seg(30.5, 60.25, "a"), seg(100.0, 120.0, "b", SponsorCategory.INTRO), seg(5.0, 15.0, "i")),
            SponsorBlockRules.parse(text, "vid"),
        )
        assertEquals(emptyList(), SponsorBlockRules.parse(text, "missing"))
    }

    @Test
    fun parseBadResponsesAreEmpty() {
        assertEquals(emptyList(), SponsorBlockRules.parse("", "vid"))
        assertEquals(emptyList(), SponsorBlockRules.parse("Not Found", "vid"))
        assertEquals(emptyList(), SponsorBlockRules.parse("{\"videoID\":\"vid\"}", "vid"))
        assertEquals(emptyList(), SponsorBlockRules.parse("[{\"videoID\":\"vid\",\"segments\":5}]", "vid"))
    }

    @Test
    fun selectFiltersSortsAndMerges() {
        val raw = listOf(
            seg(100.0, 130.0, "late"),
            seg(10.0, 40.0, "first"),
            seg(35.0, 50.0, "overlap"),
            seg(50.0, 55.0, "touching"),
            seg(70.0, 70.5, "short"),
            seg(80.0, 90.0, "intro", SponsorCategory.INTRO),
            seg(12.0, 20.0, "inside"),
        )
        // 預設只跳過業配：intro 不要；太短的不要；重疊、相接的合併，id 用最早開始的那一段
        assertEquals(
            listOf(seg(10.0, 55.0, "first"), seg(100.0, 130.0, "late")),
            SponsorBlockRules.select(raw, SponsorBlockSettings()),
        )
        assertEquals(
            listOf(seg(10.0, 55.0, "first"), seg(80.0, 90.0, "intro", SponsorCategory.INTRO), seg(100.0, 130.0, "late")),
            SponsorBlockRules.select(raw, SponsorBlockSettings(categories = setOf(sponsor, SponsorCategory.INTRO))),
        )
        // 不同類別重疊也合併成一段（類別用最早開始的）
        assertEquals(
            listOf(seg(10.0, 30.0, "a")),
            SponsorBlockRules.select(
                listOf(seg(20.0, 30.0, "b", SponsorCategory.OUTRO), seg(10.0, 25.0, "a")),
                SponsorBlockSettings(categories = setOf(sponsor, SponsorCategory.OUTRO)),
            ),
        )
        assertEquals(emptyList(), SponsorBlockRules.select(raw, SponsorBlockSettings(enabled = false)))
        assertEquals(emptyList(), SponsorBlockRules.select(raw, SponsorBlockSettings(categories = emptySet())))
        // 剛好 1 秒的保留
        assertEquals(1, SponsorBlockRules.select(listOf(seg(5.0, 6.0, "x")), SponsorBlockSettings()).size)
    }

    @Test
    fun checkSkipsToSegmentEnd() {
        val segments = listOf(seg(10.0, 40.0, "a"), seg(100.0, 130.0, "b"))
        val state = SkipState()
        assertNull(SponsorBlockRules.check(segments, state, 9.9, 600.0))
        assertEquals(SkipAction(segments[0], 40.0), SponsorBlockRules.check(segments, state, 10.0, 600.0))
        assertEquals(SkipAction(segments[0], 40.0), SponsorBlockRules.check(segments, state, 25.0, 600.0))
        // 已經在結尾：不跳
        assertNull(SponsorBlockRules.check(segments, state, 39.8, 600.0))
        assertNull(SponsorBlockRules.check(segments, state, 40.0, 600.0))
        assertEquals(SkipAction(segments[1], 130.0), SponsorBlockRules.check(segments, state, 101.0, 600.0))
        // 不知道影片長度：照樣跳到片段結尾
        assertEquals(SkipAction(segments[0], 40.0), SponsorBlockRules.check(segments, state, 11.0, Double.NaN))
        assertNull(SponsorBlockRules.check(segments, state, Double.NaN, 600.0))
        assertNull(SponsorBlockRules.check(emptyList(), state, 11.0, 600.0))
    }

    @Test
    fun segmentEndingInLastSecondCountsAsFinished() {
        val outro = seg(570.0, 599.2, "end")
        assertEquals(SkipAction(outro, 600.0), SponsorBlockRules.check(listOf(outro), SkipState(), 580.0, 600.0))
        // 片段結尾超過影片長度也一樣
        val over = seg(570.0, 605.0, "over")
        assertEquals(SkipAction(over, 600.0), SponsorBlockRules.check(listOf(over), SkipState(), 580.0, 600.0))
        // 離結尾還有超過 1 秒：跳到片段結尾
        val before = seg(570.0, 598.5, "before")
        assertEquals(SkipAction(before, 598.5), SponsorBlockRules.check(listOf(before), SkipState(), 580.0, 600.0))
    }

    @Test
    fun skippedSegmentIsNotSkippedAgainWhenRewinding() {
        val segments = listOf(seg(10.0, 40.0, "a"))
        val action = SponsorBlockRules.check(segments, SkipState(), 10.2, 600.0)!!
        val state = SkipState().markHandled(action.segment)
        // 使用者倒回去看：不再跳
        assertNull(SponsorBlockRules.check(segments, state, 12.0, 600.0))
        // 取消（跳回片段開頭）也一樣
        assertNull(SponsorBlockRules.check(segments, state, 10.0, 600.0))
    }

    @Test
    fun userSeekIntoSegmentIsNotSkipped() {
        val segments = listOf(seg(10.0, 40.0, "a"), seg(100.0, 130.0, "b"))
        // 拖曳到片段裡面：這個片段不跳
        val state = SkipState().userSeeked(segments, 20.0)
        assertEquals(setOf("a"), state.handled)
        assertNull(SponsorBlockRules.check(segments, state, 20.25, 600.0))
        // 其他片段照樣跳
        assertEquals(segments[1].id, SponsorBlockRules.check(segments, state, 100.1, 600.0)?.segment?.id)
        // 跳到片段外面：不影響
        val outside = SkipState().userSeeked(segments, 50.0)
        assertEquals(SkipState(), outside)
        // 跳到片段前面，播放進入片段：照樣跳
        val before = SkipState().userSeeked(segments, 5.0)
        assertEquals(SkipAction(segments[0], 40.0), SponsorBlockRules.check(segments, before, 10.1, 600.0))
    }

    @Test
    fun cellsKeepSeparateStates() {
        val segments = listOf(seg(10.0, 40.0, "a"))
        val cell1 = SkipState().markHandled(segments[0])
        val cell2 = SkipState()
        assertNull(SponsorBlockRules.check(segments, cell1, 12.0, 600.0))
        assertEquals(40.0, SponsorBlockRules.check(segments, cell2, 12.0, 600.0)?.target)
    }

    @Test
    fun labelsAndSegmentAt() {
        assertEquals("已跳過業配", SponsorBlockRules.skippedLabel(SponsorCategory.SPONSOR))
        assertEquals("已跳過開場", SponsorBlockRules.skippedLabel(SponsorCategory.INTRO))
        val segments = listOf(seg(10.0, 40.0, "a"), seg(100.0, 130.0, "b"))
        assertEquals("b", SponsorBlockRules.segmentAt(segments, 100.0)?.id)
        assertNull(SponsorBlockRules.segmentAt(segments, 40.0))
        assertNull(SponsorBlockRules.segmentAt(segments, 5.0))
    }

    @Test
    fun marks() {
        val segments = listOf(seg(0.0, 60.0, "a"), seg(150.0, 300.0, "b", SponsorCategory.OUTRO), seg(310.0, 400.0, "c"))
        assertEquals(
            listOf(SegmentMark(0.0, 0.2, sponsor), SegmentMark(0.5, 1.0, SponsorCategory.OUTRO)),
            SponsorBlockRules.marks(segments, 300.0),
        )
        assertEquals(emptyList(), SponsorBlockRules.marks(segments, Double.NaN))
        assertEquals(emptyList(), SponsorBlockRules.marks(segments, 0.0))
    }

    @Test
    fun settingsDefaultsAndNormalization() {
        assertEquals(SponsorBlockSettings(true, setOf(sponsor)), SponsorBlockRules.normalizeSettings(null))
        assertEquals(SponsorBlockSettings(true, setOf(sponsor)), SponsorBlockRules.normalizeSettings(j("x")))
        assertEquals(
            SponsorBlockSettings(false, setOf(SponsorCategory.INTRO, SponsorCategory.FILLER)),
            SponsorBlockRules.normalizeSettings(j(mapOf("enabled" to false, "categories" to listOf("filler", "intro", "bogus", 3)))),
        )
        // 欄位不合法時各自用預設值；空的類別清單保留（使用者全部取消勾選）
        assertEquals(
            SponsorBlockSettings(true, emptySet()),
            SponsorBlockRules.normalizeSettings(j(mapOf("enabled" to "no", "categories" to emptyList<String>()))),
        )
        assertTrue(SponsorBlockSettings().active)
        assertTrue(!SponsorBlockSettings(categories = emptySet()).active)
    }

    @Test
    fun settingsFileRoundTrip() {
        val settings = Settings(sponsorBlock = SponsorBlockSettings(false, setOf(SponsorCategory.OUTRO, sponsor)))
        val text = SettingsCodec.encode(settings)
        assertTrue(text.contains("\"sponsorBlock\""))
        assertEquals(settings.sponsorBlock, SettingsCodec.parse(text).settings.sponsorBlock)
        // 舊的設定檔沒有這個欄位：預設開啟、只跳過業配
        assertEquals(SponsorBlockSettings(), SettingsCodec.parse("{\"version\":1}").settings.sponsorBlock)
        assertEquals(
            listOf("sponsor", "outro"),
            JsonValues.array(SponsorBlockRules.encodeSettings(settings.sponsorBlock)["categories"])!!.map { JsonValues.string(it) },
        )
    }

    @Test
    fun categoryCodesMatchApi() {
        assertEquals(
            listOf("sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler", "music_offtopic"),
            SponsorCategory.entries.map { it.raw },
        )
        assertNull(SponsorCategory.fromRaw("poi_highlight"))
    }
}
