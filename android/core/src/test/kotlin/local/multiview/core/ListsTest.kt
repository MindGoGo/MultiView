package local.multiview.core

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

/** 最愛、歷史、訂閱（R21–R23、R58、R59、R158）與匯入合併。照搬 iOS 版的 ListsTests.swift。 */
class ListsTest {
    private val yt = "https://www.youtube.com/watch?v=jfKfPfyJRdk"
    private val yt2 = "https://www.youtube.com/watch?v=aaaaaaaaaaa"
    private val mp4 = "https://example.com/videos/My%20Clip.mp4"
    private val web = "https://www.twitch.tv/somechannel"
    private val channelId = "UC" + "a".repeat(22)

    private fun lists(result: Outcome<Lists, ListError>): Lists = when (result) {
        is Outcome.Ok -> result.value
        is Outcome.Err -> fail("預期成功，但得到 ${result.error}")
    }

    private fun error(result: Outcome<Lists, ListError>): ListError? = result.errorOrNull()

    // 網址比對與影片名稱

    @Test
    fun sameUrl() {
        assertTrue(ListRules.sameUrl("  $yt ", yt))
        // 同一部影片的不同寫法視為不同
        assertFalse(ListRules.sameUrl(yt, "https://youtu.be/jfKfPfyJRdk"))
    }

    @Test
    fun defaultName() {
        assertEquals("直播標題", ListRules.defaultName(yt, "  直播標題 "))
        assertEquals("My Clip.mp4", ListRules.defaultName(mp4, null))
        assertEquals("index.m3u8", ListRules.defaultName("https://cdn.example.com/live/index.m3u8?token=1", ""))
        assertEquals(yt, ListRules.defaultName(" $yt ", "   "))
        assertEquals(web, ListRules.defaultName(web))
    }

    @Test
    fun group() {
        assertEquals(ListGroup.YOUTUBE, ListRules.groupOf(yt))
        assertEquals(ListGroup.YOUTUBE, ListRules.groupOf("https://www.youtube.com/@somechannel"))
        assertEquals(ListGroup.OTHER, ListRules.groupOf(web))
        assertEquals(ListGroup.OTHER, ListRules.groupOf(mp4))
    }

    // 最愛（R22）

    @Test
    fun addFavoriteGoesToTop() {
        var current = lists(ListRules.addFavorite(Lists(), yt, "A", 1.0))
        current = lists(ListRules.addFavorite(current, web, "B", 2.0))
        assertEquals(listOf(ListItem(web, "B", 2.0), ListItem(yt, "A", 1.0)), current.favorites)
    }

    @Test
    fun isFavoriteAndRemove() {
        val current = lists(ListRules.addFavorite(Lists(), yt, "A", 1.0))
        assertTrue(ListRules.isFavorite(current, " $yt "))
        assertFalse(ListRules.isFavorite(current, web))
        assertFalse(ListRules.isFavorite(ListRules.removeFavorite(current, yt), yt))
    }

    @Test
    fun favoriteEmptyNameUsesUrl() {
        val current = lists(ListRules.addFavorite(Lists(), " $yt ", "   ", 1.0))
        assertEquals(listOf(ListItem(yt, yt, 1.0)), current.favorites)
    }

    @Test
    fun favoriteErrors() {
        val current = lists(ListRules.addFavorite(Lists(), yt, "A", 1.0))
        assertEquals(ListError.DUPLICATE, error(ListRules.addFavorite(current, yt, "B", 2.0)))
        assertEquals(ListError.UNSUPPORTED, error(ListRules.addFavorite(current, "ftp://example.com/a", "B", 2.0)))
        assertEquals("清單中已經有這個網址", ListError.DUPLICATE.message)
        assertEquals("不支援的網址", ListError.UNSUPPORTED.message)
    }

    // 編輯與刪除（R21）

    private val twoFavorites = Lists(favorites = listOf(ListItem(yt, "A", 2.0), ListItem(web, "B", 1.0)))

    @Test
    fun editItem() {
        val edited = lists(ListRules.editItem(twoFavorites, ListKind.FAVORITES, 1, mp4, " 新名稱 "))
        assertEquals(ListItem(mp4, "新名稱", 1.0), edited.favorites[1])
        assertEquals(twoFavorites.favorites[0], edited.favorites[0])
    }

    @Test
    fun editItemErrors() {
        assertEquals(ListError.UNSUPPORTED, error(ListRules.editItem(twoFavorites, ListKind.FAVORITES, 1, "nope", "B")))
        // 改成清單中另一筆的網址時不儲存；改成自己原本的網址可以
        assertEquals(ListError.DUPLICATE, error(ListRules.editItem(twoFavorites, ListKind.FAVORITES, 1, yt, "B")))
        val same = lists(ListRules.editItem(twoFavorites, ListKind.FAVORITES, 1, web, ""))
        assertEquals(ListItem(web, web, 1.0), same.favorites[1])
    }

    @Test
    fun deleteItem() {
        assertEquals(listOf(web), ListRules.deleteItem(twoFavorites, ListKind.FAVORITES, 0).favorites.map { it.url })
        // 不存在的位置不改變清單
        assertEquals(twoFavorites, ListRules.deleteItem(twoFavorites, ListKind.FAVORITES, 5))
        assertEquals(twoFavorites, lists(ListRules.editItem(twoFavorites, ListKind.HISTORY, 0, yt, "x")))
    }

    // 歷史（R23）

    @Test
    fun recordHistory() {
        val current = ListRules.recordHistory(Lists(), yt, "標題", 100.0)
        assertEquals(listOf(ListItem(yt, "標題", 100.0)), current.history)
    }

    @Test
    fun recordHistoryMovesExistingToTopAndKeepsName() {
        var current = ListRules.recordHistory(Lists(), yt, "舊標題", 100.0)
        current = ListRules.recordHistory(current, web, null, 200.0)
        current = ListRules.recordHistory(current, yt, "新標題", 300.0)
        assertEquals(listOf(ListItem(yt, "舊標題", 300.0), ListItem(web, web, 200.0)), current.history)
    }

    @Test
    fun historyIsCappedPerGroup() {
        var current = Lists()
        for (index in 0 until 205) {
            current = ListRules.recordHistory(current, "https://example.com/$index", null, index.toDouble())
        }
        current = ListRules.recordHistory(current, yt, null, 1000.0)
        // 其他網站 200 筆（刪掉最舊的 5 筆），YouTube 另外計算
        assertEquals(201, current.history.size)
        assertEquals(yt, current.history.first().url)
        assertEquals("https://example.com/5", current.history.last().url)
    }

    @Test
    fun clearHistoryOneGroup() {
        var current = ListRules.recordHistory(Lists(), yt, null, 1.0)
        current = ListRules.recordHistory(current, web, null, 2.0)
        assertEquals(listOf(web), ListRules.clearHistory(current, ListGroup.YOUTUBE).history.map { it.url })
        assertEquals(listOf(yt), ListRules.clearHistory(current, ListGroup.OTHER).history.map { it.url })
    }

    @Test
    fun formatTime() {
        // 2026-01-05 03:07 UTC = 台北 11:07
        assertEquals("2026/01/05 11:07", ListRules.formatTime(1_767_582_420_000.0, ZoneId.of("Asia/Taipei")))
    }

    // 訂閱（R59、R61）

    @Test
    fun channelId() {
        assertTrue(Channel.isId(channelId))
        assertTrue(Channel.isId("UCabc_def-ghiJKLmnopQRst"))
        assertFalse(Channel.isId("UCshort"))
        assertFalse(Channel.isId("XX" + "a".repeat(22)))
        assertFalse(Channel.isId("UC" + "!".repeat(22)))
    }

    @Test
    fun addAndRemoveChannel() {
        val url = Channel.pageUrl(channelId)
        val current = lists(ListRules.addChannel(Lists(), channelId, "頻道", url, 5.0))
        assertEquals(listOf(Channel(channelId, "頻道", url, 5.0)), current.channels)
        assertEquals(ListError.CHANNEL_DUPLICATE, error(ListRules.addChannel(current, channelId, "x", url, 6.0)))
        assertEquals(emptyList(), ListRules.removeChannel(current, channelId).channels)
    }

    @Test
    fun addChannelsSkipsKnown() {
        val other = "UC" + "b".repeat(22)
        val existing = Lists(channels = listOf(Channel(channelId, "A", "u", 1.0)))
        val incoming = listOf(
            Channel(channelId, "A2", "u", 0.0),
            Channel(other, "B", "v", 0.0),
            Channel(other, "B 重複", "v", 0.0),
        )
        val result = ListRules.addChannels(existing, incoming, 9.0)
        assertEquals(1, result.added)
        assertEquals(2, result.skipped)
        assertEquals(listOf("A", "B"), result.lists.channels.map { it.name })
        assertEquals(9.0, result.lists.channels[1].time)
    }

    // 清單檔（R21 AC10、AC11）

    @Test
    fun roundTrip() {
        val current = Lists(
            favorites = listOf(ListItem(yt, "A", 1_700_000_000_000.0)),
            history = listOf(ListItem(web, "B", 1_700_000_000_500.0)),
            channels = listOf(Channel(channelId, "頻道", Channel.pageUrl(channelId), 3.0)),
        )
        val text = ListsCodec.encode(current)
        // 時間寫成整數，桌面版讀得回去
        assertTrue(text.contains("1700000000000"), text)
        val result = ListsCodec.parse(text)
        assertFalse(result.corrupt)
        assertEquals(current, result.lists)
    }

    @Test
    fun corruptFile() {
        for (text in listOf("{ broken", "[]", "null", "\"text\"")) {
            val result = ListsCodec.parse(text)
            assertTrue(result.corrupt, text)
            assertEquals(Lists(), result.lists, text)
        }
        assertFalse(ListsCodec.parse("{}").corrupt)
    }

    @Test
    fun invalidAndDuplicateItemsAreSkipped() {
        val text = """
        {
          "favorites": [
            { "url": "$yt", "name": "A", "time": 1 },
            { "url": " $yt ", "name": "重複", "time": 2 },
            { "url": "ftp://example.com/a", "name": "不支援" },
            { "url": "$web", "name": "  ", "time": "昨天" },
            "garbage",
            { "name": "沒有網址" }
          ],
          "history": "不是陣列",
          "channels": [
            { "id": "$channelId", "name": "頻道" },
            { "id": "$channelId", "name": "重複" },
            { "id": "bad" }
          ]
        }
        """
        val result = ListsCodec.parse(text)
        assertFalse(result.corrupt)
        assertEquals(listOf(ListItem(yt, "A", 1.0), ListItem(web, web, 0.0)), result.lists.favorites)
        assertEquals(emptyList(), result.lists.history)
        assertEquals(listOf(Channel(channelId, "頻道", Channel.pageUrl(channelId), 0.0)), result.lists.channels)
    }

    @Test
    fun looksLikeLists() {
        assertTrue(ListsCodec.looksLikeLists("{\"favorites\":[]}"))
        assertTrue(ListsCodec.looksLikeLists("{\"channels\":[],\"other\":1}"))
        assertFalse(ListsCodec.looksLikeLists("{\"version\":1,\"layout\":\"2x2\"}")) // 這是設定檔
        assertFalse(ListsCodec.looksLikeLists("{\"favorites\":\"x\"}"))
        assertFalse(ListsCodec.looksLikeLists("隨便的文字"))
    }

    // 匯入桌面版的清單

    @Test
    fun mergeFavoritesKeepsCurrentNamesAndAppendsNew() {
        // 手機和桌面版的最愛各有 3 筆，其中 1 筆網址相同 → 5 筆，新增 2 筆
        val current = Lists(
            favorites = listOf(ListItem(yt, "手機上的名稱", 30.0), ListItem(web, "W", 20.0), ListItem(mp4, "M", 10.0)),
        )
        val imported = Lists(
            favorites = listOf(ListItem(yt, "桌面版的名稱", 99.0), ListItem(yt2, "Y2", 98.0), ListItem("https://example.com/", "E", 97.0)),
        )
        val result = ListsImport.merge(current, imported)
        assertEquals(2, result.summary.favoritesAdded)
        assertEquals(listOf("手機上的名稱", "W", "M", "Y2", "E"), result.lists.favorites.map { it.name })
    }

    @Test
    fun mergeHistoryKeepsNewerAndSortsByTime() {
        val current = Lists(history = listOf(ListItem(yt, "手機", 300.0), ListItem(web, "W 舊", 100.0)))
        val imported = Lists(
            history = listOf(ListItem(web, "W 新", 400.0), ListItem(yt, "桌面版", 200.0), ListItem(mp4, "M", 350.0)),
        )
        val result = ListsImport.merge(current, imported)
        assertEquals(1, result.summary.historyAdded)
        assertEquals(
            listOf(ListItem(web, "W 新", 400.0), ListItem(mp4, "M", 350.0), ListItem(yt, "手機", 300.0)),
            result.lists.history,
        )
    }

    @Test
    fun mergeHistoryIsCapped() {
        val current = Lists(history = (0 until 150).map { ListItem("https://a.example.com/$it", "a", (1000 - it).toDouble()) })
        val imported = Lists(history = (0 until 150).map { ListItem("https://b.example.com/$it", "b", (2000 - it).toDouble()) })
        val result = ListsImport.merge(current, imported)
        assertEquals(150, result.summary.historyAdded)
        assertEquals(200, result.lists.history.size)
        // 最舊的被刪掉
        assertEquals("https://b.example.com/0", result.lists.history.first().url)
        assertEquals("https://a.example.com/49", result.lists.history.last().url)
    }

    @Test
    fun mergeChannels() {
        val other = "UC" + "b".repeat(22)
        val current = Lists(channels = listOf(Channel(channelId, "A", "u", 1.0)))
        val imported = Lists(channels = listOf(Channel(channelId, "A 桌面版", "u", 2.0), Channel(other, "B", "v", 3.0)))
        val result = ListsImport.merge(current, imported)
        assertEquals(1, result.summary.channelsAdded)
        assertEquals(listOf("A", "B"), result.lists.channels.map { it.name })
        assertEquals("最愛新增 0 筆、歷史新增 0 筆、訂閱新增 1 個頻道", result.summary.message)
    }

    @Test
    fun mergeEmptyImportChangesNothing() {
        val result = ListsImport.merge(twoFavorites, Lists())
        assertEquals(twoFavorites, result.lists)
        assertEquals(ListsImport.Summary(), result.summary)
    }
}
