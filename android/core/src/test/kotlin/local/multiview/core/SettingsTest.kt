package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 設定檔驗證與讀寫（R10、R155）、匯入桌面版設定（R158）。照搬 iOS 版的 SettingsTests.swift。 */
class SettingsTest {
    private val yt = "https://www.youtube.com/watch?v=jfKfPfyJRdk"
    private val web = "https://www.twitch.tv/somechannel"

    /** 只有 slots 欄位的設定內容。 */
    private fun view(slots: List<Any?>): Settings = SettingsCodec.normalizeView(j(mapOf("slots" to slots)))

    private fun slots(vararg pairs: Pair<Int, SavedSource>): List<SavedSource?> =
        MutableList<SavedSource?>(9) { null }.also { list -> pairs.forEach { (index, source) -> list[index] = source } }

    @Test
    fun defaults() {
        val settings = Settings()
        assertEquals(LayoutId.GRID2, settings.layout)
        assertEquals(9, settings.slots.size)
        assertTrue(settings.slots.all { it == null })
        assertEquals(100, settings.brightness)
        assertEquals(YouTubeMethods(PlayMethod.EMBED, PlayMethod.EMBED), settings.youtubeMethods)
        assertEquals(WebMethod.WEB, settings.webMethod)
        assertEquals(ListTab(ListGroup.YOUTUBE, ListTab.Tab.FAVORITES), settings.listTab)
        assertEquals(Ratios(listOf(0.5, 0.5), listOf(0.5, 0.5)), settings.ratiosFor(LayoutId.GRID2))
    }

    @Test
    fun roundTrip() {
        val settings = Settings(
            layout = LayoutId.GRID3,
            ratios = mapOf(LayoutId.TWO to Ratios(listOf(0.7, 0.3), listOf(1.0))),
            slots = slots(
                0 to SavedSource(url = yt, muted = false, volume = 40),
                4 to SavedSource(
                    url = web, muted = true, volume = 30, adblock = false, quality = Quality.Height(720), captions = "zh-TW",
                    audioLang = "ja", brightness = 60, youtubeWeb = false, position = 183.5,
                    backUrl = "https://www.youtube.com/@somechannel", pageAdblock = false,
                ),
            ),
            brightness = 80,
            autoYoutubeWeb = true,
            youtubeMethods = YouTubeMethods(PlayMethod.YTDLP, PlayMethod.EMBED),
            webMethod = WebMethod.YTDLP,
            listTab = ListTab(ListGroup.OTHER, ListTab.Tab.HISTORY),
        )
        val result = SettingsCodec.parse(SettingsCodec.encode(settings))
        assertFalse(result.corrupt)
        assertEquals(settings, result.settings)
    }

    @Test
    fun brokenJsonIsCorrupt() {
        val result = SettingsCodec.parse("{ not json")
        assertTrue(result.corrupt)
        assertEquals(Settings(), result.settings)
    }

    @Test
    fun wrongStructureIsCorrupt() {
        assertTrue(SettingsCodec.parse("[]").corrupt)
        assertTrue(SettingsCodec.parse("null").corrupt)
        assertTrue(SettingsCodec.parse("{\"version\":2}").corrupt)
        assertTrue(SettingsCodec.parse("{\"version\":true}").corrupt)
        assertTrue(SettingsCodec.parse("{\"version\":\"1\"}").corrupt)
        assertTrue(SettingsCodec.parse("隨便的文字").corrupt)
        assertFalse(SettingsCodec.parse("{\"version\":1}").corrupt)
    }

    @Test
    fun invalidFieldsAreReplacedIndividually() {
        val text = """
        {
          "version": 1,
          "window": { "width": "big", "height": 500, "x": 10 },
          "layout": "4x4",
          "ratios": {
            "2": { "cols": [0.9, 0.9], "rows": [1] },
            "2x2": { "cols": [0.6, 0.4], "rows": [0.5, 0.5] }
          },
          "slots": [
            { "url": "ftp://example.com/a.mp4", "muted": false },
            { "url": "$yt", "volume": 250 },
            "garbage"
          ]
        }
        """
        val result = SettingsCodec.parse(text)
        assertFalse(result.corrupt)
        val settings = result.settings
        assertEquals(LayoutId.GRID2, settings.layout)
        assertEquals(mapOf(LayoutId.GRID2 to Ratios(listOf(0.6, 0.4), listOf(0.5, 0.5))), settings.ratios)
        assertNull(settings.slots[0]) // 不支援的網址
        // 桌面版音量可以到 200，手機最高 100
        assertEquals(SavedSource(url = yt, muted = false, volume = 100), settings.slots[1])
        assertNull(settings.slots[2])
        assertEquals(9, settings.slots.size)
    }

    @Test
    fun slotsArePaddedOrTruncatedToNine() {
        assertEquals(9, view(emptyList()).slots.size)
        val truncated = view(List(20) { mapOf("url" to yt) })
        assertEquals(9, truncated.slots.size)
        assertTrue(truncated.slots.all { it?.url == yt })
        assertEquals(LayoutId.GRID2, SettingsCodec.normalizeView(null).layout)
    }

    @Test
    fun firstVersionSettingsFile() {
        // 第一版的設定檔沒有 adblock 等欄位：廣告阻擋視為開啟（R12 AC7）
        val text = """
        {
          "version": 1,
          "window": { "width": 1280, "height": 720, "alwaysOnTop": false },
          "layout": "2x2",
          "ratios": {},
          "slots": [{ "url": "$yt", "muted": false, "volume": 40 }, null, null, null, null, null, null, null, null]
        }
        """
        val result = SettingsCodec.parse(text)
        assertFalse(result.corrupt)
        assertEquals(LayoutId.GRID2, result.settings.layout)
        assertEquals(
            SavedSource(
                url = yt, muted = false, volume = 40, adblock = true, quality = Quality.Auto, captions = null, audioLang = null,
                brightness = 100, youtubeWeb = false, position = null, backUrl = null, pageAdblock = true,
            ),
            result.settings.slots[0],
        )
    }

    @Test
    fun adblockIsOffOnlyWhenExplicitlyFalse() {
        val result = view(
            listOf(mapOf("url" to web, "adblock" to "no"), mapOf("url" to web, "adblock" to 0), mapOf("url" to web, "adblock" to false)),
        )
        assertEquals(listOf(true, true, false), result.slots.take(3).map { it?.adblock })
    }

    @Test
    fun mutedIsOnOnlyWhenExplicitlyTrue() {
        val result = view(
            listOf(mapOf("url" to web, "muted" to 1), mapOf("url" to web, "muted" to "true"), mapOf("url" to web, "muted" to true)),
        )
        assertEquals(listOf(false, false, true), result.slots.take(3).map { it?.muted })
    }

    @Test
    fun sourceFieldNormalization() {
        val result = view(
            listOf(
                mapOf("url" to yt, "quality" to "high", "captions" to "", "position" to -5, "backUrl" to "https://example.com/"),
                mapOf("url" to yt, "quality" to 720, "captions" to "en", "position" to 12.5, "backUrl" to "https://www.youtube.com/"),
                mapOf("url" to yt, "quality" to 720.5, "brightness" to 130, "volume" to true),
            ),
        )
        assertEquals(Quality.Height(1080), result.slots[0]?.quality)
        assertNull(result.slots[0]?.captions)
        assertNull(result.slots[0]?.position)
        assertNull(result.slots[0]?.backUrl) // 不是 YouTube 網站頁面
        assertEquals(Quality.Height(720), result.slots[1]?.quality)
        assertEquals("en", result.slots[1]?.captions)
        assertEquals(12.5, result.slots[1]?.position)
        assertEquals("https://www.youtube.com/", result.slots[1]?.backUrl)
        assertEquals(Quality.Auto, result.slots[2]?.quality)
        assertEquals(100, result.slots[2]?.brightness) // 桌面版 130% → 手機最高 100%
        assertEquals(100, result.slots[2]?.volume) // true 不是數字
    }

    @Test
    fun listTabNormalization() {
        fun tab(group: Any, tab: Any): ListTab =
            SettingsCodec.normalizeView(j(mapOf("listTab" to mapOf("group" to group, "tab" to tab)))).listTab
        assertEquals(ListTab(ListGroup.OTHER, ListTab.Tab.HISTORY), tab("other", "history"))
        assertEquals(ListTab(ListGroup.YOUTUBE, ListTab.Tab.SUBSCRIPTIONS), tab("youtube", "subscriptions"))
        // 訂閱只在 YouTube 那一邊
        assertEquals(ListTab(), tab("other", "subscriptions"))
        assertEquals(ListTab(), tab("x", "favorites"))
        assertEquals(ListTab(), tab("youtube", 3))
    }

    @Test
    fun methodsNormalization() {
        val view = SettingsCodec.normalizeView(
            j(mapOf("youtubeMethods" to mapOf("live" to "ytdlp", "vod" to "other"), "webMethod" to "ytdlp")),
        )
        assertEquals(YouTubeMethods(PlayMethod.YTDLP, PlayMethod.EMBED), view.youtubeMethods)
        assertTrue(view.youtubeMethods.needsResolve)
        assertEquals(WebMethod.YTDLP, view.webMethod)
        assertFalse(YouTubeMethods().needsResolve)
    }

    @Test
    fun encodedFileHasDesktopFieldNames() {
        val text = SettingsCodec.encode(Settings(slots = slots(0 to SavedSource(url = yt, backUrl = "https://www.youtube.com/"))))
        assertTrue(text.contains("\"version\": 1"), text)
        assertTrue(text.contains("\"backUrl\""))
        assertTrue(text.contains("\"pageAdblock\": true"))
        assertTrue(text.contains("\"quality\": \"auto\""))
        assertTrue(text.contains("\"captions\": null"))
        // 手機不用的欄位不寫入
        assertFalse(text.contains("\"window\""))
        assertFalse(text.contains("\"companion\""))
    }

    // 匯入桌面版設定

    @Test
    fun importDesktopSettingsClampsVolumeAndBrightness() {
        val text = """
        {
          "version": 1,
          "window": { "x": 100, "y": 50, "width": 1600, "height": 900, "alwaysOnTop": true },
          "companion": { "width": 480, "height": 760, "tab": "search", "pinned": false },
          "layout": "2x2",
          "ratios": {},
          "brightness": 120,
          "slots": [
            { "url": "$yt", "muted": false, "volume": 150, "brightness": 130, "position": 61 },
            null, null, null, null, null, null, null, null
          ]
        }
        """
        val result = SettingsCodec.parse(text)
        assertFalse(result.corrupt)
        assertEquals(100, result.settings.brightness)
        assertEquals(100, result.settings.slots[0]?.volume)
        assertEquals(100, result.settings.slots[0]?.brightness)
        assertEquals(61.0, result.settings.slots[0]?.position)
    }

    // 設定和格子之間的轉換

    @Test
    fun restoreSlotsStartsPaused() {
        val restored = SettingsBridge.restoreSlots(
            slots(1 to SavedSource(url = yt, muted = true, volume = 40, brightness = 60, position = 180.0)),
        )
        assertEquals(9, restored.size)
        assertNull(restored[0])
        val source = restored[1]
        assertEquals(ParsedSource.YouTube("jfKfPfyJRdk"), source?.parsed)
        assertEquals(false, source?.autoplay)
        assertEquals(false, source?.record)
        assertEquals(true, source?.muted)
        assertEquals(40, source?.volume)
        assertEquals(60, source?.brightness)
        assertEquals(180.0, source?.resume)
    }

    @Test
    fun restoreSlotsUsesYouTubeWebPage() {
        val restored = SettingsBridge.restoreSlots(listOf(SavedSource(url = yt, youtubeWeb = true)))
        assertEquals(9, restored.size)
        assertEquals(yt, restored[0]?.url)
        assertEquals(ParsedSource.Web(yt), restored[0]?.parsed)
    }

    @Test
    fun saveSlotsKeepsPositions() {
        val cells = SlotRules.empty().toMutableList()
        cells[0] = CellSource(url = yt, parsed = ParsedSource.YouTube("jfKfPfyJRdk"), muted = true, volume = 55, brightness = 70)
        cells[2] = CellSource(url = web, parsed = ParsedSource.Web(web), adblock = false)
        val saved = SettingsBridge.saveSlots(cells, mapOf(0 to 95.5, 2 to 0.0, 5 to 10.0))
        assertEquals(9, saved.size)
        assertEquals(SavedSource(url = yt, muted = true, volume = 55, brightness = 70, position = 95.5), saved[0])
        assertEquals(SavedSource(url = web, adblock = false), saved[2])
        assertNull(saved[5])
    }
}
