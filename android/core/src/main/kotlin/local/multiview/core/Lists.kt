package local.multiview.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import local.multiview.core.JsonValues.array
import local.multiview.core.JsonValues.nonEmptyString
import local.multiview.core.JsonValues.number
import local.multiview.core.JsonValues.obj
import local.multiview.core.JsonValues.string
import java.time.Instant
import java.time.ZoneId

/*
 * 最愛清單、歷史紀錄、訂閱頻道（桌面版 R21–R23、R58、R59；Android 版 R158）。
 * 由 iOS 版的 Lists.swift 改寫，`lists.json` 的格式和桌面版相同。
 */

data class ListItem(
    val url: String,
    val name: String,
    /** 最愛：加入的時間；歷史：最後播放的時間（毫秒）。 */
    val time: Double,
)

/** 訂閱的頻道（R59）。 */
data class Channel(
    /** 頻道代碼：UC 開頭的 24 個字元。 */
    val id: String,
    val name: String,
    /** 頻道頁網址。 */
    val url: String,
    /** 加入的時間（毫秒）。 */
    val time: Double,
) {
    companion object {
        fun isId(text: String): Boolean =
            text.length == 24 && text.startsWith("UC") && text.drop(2).all(SourceParser::isIdCharacter)

        fun pageUrl(id: String): String = "https://www.youtube.com/channel/$id"
    }
}

data class Lists(
    val favorites: List<ListItem> = emptyList(),
    val history: List<ListItem> = emptyList(),
    val channels: List<Channel> = emptyList(),
)

enum class ListKind { FAVORITES, HISTORY }

/** 清單的兩邊（R58）：YouTube 影片與 YouTube 網站頁面、其他網站。 */
enum class ListGroup(val raw: String) {
    YOUTUBE("youtube"), OTHER("other");

    companion object {
        fun fromRaw(raw: String?): ListGroup? = entries.firstOrNull { it.raw == raw }
    }
}

/** 顯示給使用者的訊息和桌面版相同。 */
enum class ListError(val message: String) {
    UNSUPPORTED("不支援的網址"),
    DUPLICATE("清單中已經有這個網址"),
    CHANNEL_DUPLICATE("已經訂閱這個頻道"),
}

data class AddChannelsResult(val lists: Lists, val added: Int, val skipped: Int)

object ListRules {
    /** 歷史最多保留的筆數（R23）；YouTube 和其他網站各自計算（R58）。 */
    const val HISTORY_MAX = 200

    fun groupOf(url: String): ListGroup {
        if (SourceParser.parse(url) is ParsedSource.YouTube) return ListGroup.YOUTUBE
        return if (SourceParser.isYouTubeSite(url)) ListGroup.YOUTUBE else ListGroup.OTHER
    }

    /** 以去掉前後空白後的完整網址比對（共用定義「網址比對」）。 */
    fun sameUrl(a: String, b: String): Boolean = a.trim() == b.trim()

    /** 影片名稱（共用定義）：標題 → mp4 / m3u8 的檔名 → 網址。 */
    fun defaultName(url: String, title: String? = null): String {
        title?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        val parsed = SourceParser.parse(url)
        if (parsed is ParsedSource.Mp4 || parsed is ParsedSource.Hls) {
            val raw = parsed.url?.let(WebUrl::parse)?.lastPathComponent.orEmpty()
            val file = WebUrl.percentDecodeOrNull(raw) ?: raw
            if (file.isNotEmpty()) return file
        }
        return url.trim()
    }

    // 最愛

    /** 加入最愛，排在最上面（R22）。 */
    fun addFavorite(lists: Lists, url: String, name: String, now: Double): Outcome<Lists, ListError> =
        when (val checked = validate(lists.favorites, url, name)) {
            is Outcome.Err -> checked
            is Outcome.Ok -> Outcome.Ok(
                lists.copy(favorites = listOf(ListItem(checked.value.first, checked.value.second, now)) + lists.favorites),
            )
        }

    fun isFavorite(lists: Lists, url: String): Boolean = lists.favorites.any { sameUrl(it.url, url) }

    fun removeFavorite(lists: Lists, url: String): Lists =
        lists.copy(favorites = lists.favorites.filterNot { sameUrl(it.url, url) })

    // 編輯與刪除

    /** 編輯一筆的名稱和網址（R21）。 */
    fun editItem(lists: Lists, kind: ListKind, index: Int, url: String, name: String): Outcome<Lists, ListError> {
        val items = items(lists, kind)
        if (index !in items.indices) return Outcome.Ok(lists)
        return when (val checked = validate(items, url, name, except = index)) {
            is Outcome.Err -> checked
            is Outcome.Ok -> {
                val edited = items.toMutableList()
                edited[index] = edited[index].copy(url = checked.value.first, name = checked.value.second)
                Outcome.Ok(replacing(lists, kind, edited))
            }
        }
    }

    fun deleteItem(lists: Lists, kind: ListKind, index: Int): Lists {
        val items = items(lists, kind)
        if (index !in items.indices) return lists
        return replacing(lists, kind, items.filterIndexed { position, _ -> position != index })
    }

    // 歷史

    /**
     * 記錄一次播放（R23）：同一個網址只留一筆，移到最上面並更新時間，名稱維持原本的；
     * 超過 200 筆時刪掉最舊的。
     */
    fun recordHistory(lists: Lists, url: String, title: String?, now: Double): Lists {
        val trimmed = url.trim()
        val item = lists.history.firstOrNull { sameUrl(it.url, trimmed) }?.copy(time = now)
            ?: ListItem(trimmed, defaultName(trimmed, title), now)
        val rest = lists.history.filterNot { sameUrl(it.url, trimmed) }
        return lists.copy(history = capPerGroup(listOf(item) + rest, HISTORY_MAX))
    }

    /** 清除一邊的歷史（R58 AC3）。 */
    fun clearHistory(lists: Lists, group: ListGroup): Lists =
        lists.copy(history = lists.history.filterNot { groupOf(it.url) == group })

    // 訂閱

    /** 訂閱頻道（R59）。 */
    fun addChannel(lists: Lists, id: String, name: String, url: String, now: Double): Outcome<Lists, ListError> {
        if (lists.channels.any { it.id == id }) return Outcome.Err(ListError.CHANNEL_DUPLICATE)
        return Outcome.Ok(lists.copy(channels = lists.channels + Channel(id, name, url, now)))
    }

    /** 一次加入多個頻道（R61），已經訂閱的略過。 */
    fun addChannels(lists: Lists, channels: List<Channel>, now: Double): AddChannelsResult {
        val known = lists.channels.map { it.id }.toMutableSet()
        val added = channels.filter { known.add(it.id) }.map { it.copy(time = now) }
        return AddChannelsResult(lists.copy(channels = lists.channels + added), added.size, channels.size - added.size)
    }

    fun removeChannel(lists: Lists, id: String): Lists = lists.copy(channels = lists.channels.filterNot { it.id == id })

    // 顯示

    /** 歷史的最後播放時間：`YYYY/MM/DD HH:mm`（R23）。 */
    fun formatTime(time: Double, zone: ZoneId = ZoneId.systemDefault()): String {
        val date = Instant.ofEpochMilli(time.toLong()).atZone(zone)
        fun pad(value: Int) = value.toString().padStart(2, '0')
        return "${date.year}/${pad(date.monthValue)}/${pad(date.dayOfMonth)} ${pad(date.hour)}:${pad(date.minute)}"
    }

    // 內部

    /** 每一邊只保留最新的 max 筆（清單已依時間由新到舊排列）。 */
    internal fun capPerGroup(items: List<ListItem>, max: Int): List<ListItem> {
        val count = mutableMapOf<ListGroup, Int>()
        return items.filter { item ->
            val group = groupOf(item.url)
            val seen = (count[group] ?: 0) + 1
            count[group] = seen
            seen <= max
        }
    }

    private fun items(lists: Lists, kind: ListKind) = if (kind == ListKind.FAVORITES) lists.favorites else lists.history

    private fun replacing(lists: Lists, kind: ListKind, items: List<ListItem>) =
        if (kind == ListKind.FAVORITES) lists.copy(favorites = items) else lists.copy(history = items)

    /** 驗證網址與名稱；except 是編輯中的那一筆（不和自己比重複）。回傳（網址, 名稱）。 */
    private fun validate(
        items: List<ListItem>,
        url: String,
        name: String,
        except: Int = -1,
    ): Outcome<Pair<String, String>, ListError> {
        val trimmed = url.trim()
        if (SourceParser.parse(trimmed) == null) return Outcome.Err(ListError.UNSUPPORTED)
        val duplicate = items.withIndex().any { (index, item) -> index != except && sameUrl(item.url, trimmed) }
        if (duplicate) return Outcome.Err(ListError.DUPLICATE)
        // 名稱清空時用網址當名稱（R21）
        return Outcome.Ok(trimmed to name.trim().ifEmpty { trimmed })
    }
}

data class ParsedLists(val lists: Lists, val corrupt: Boolean)

object ListsCodec {
    /** 讀取清單檔；JSON 格式錯誤或整體結構不對時視為損毀（R21 AC11）。 */
    fun parse(text: String): ParsedLists {
        val root = obj(JsonValues.parse(text)) ?: return ParsedLists(Lists(), true)
        return ParsedLists(normalize(root), false)
    }

    /** 是不是 MultiView 的清單檔：至少有一個清單欄位是陣列（匯入時用）。 */
    fun looksLikeLists(text: String): Boolean {
        val root = obj(JsonValues.parse(text)) ?: return false
        return listOf("favorites", "history", "channels").any { array(root[it]) != null }
    }

    fun encode(lists: Lists): String {
        fun item(item: ListItem) = JsonObject(
            mapOf("url" to JsonPrimitive(item.url), "name" to JsonPrimitive(item.name), "time" to JsonValues.num(item.time)),
        )
        return JsonValues.encode(
            JsonObject(
                mapOf(
                    "favorites" to JsonArray(lists.favorites.map(::item)),
                    "history" to JsonArray(lists.history.map(::item)),
                    "channels" to JsonArray(
                        lists.channels.map { channel ->
                            JsonObject(
                                mapOf(
                                    "id" to JsonPrimitive(channel.id),
                                    "name" to JsonPrimitive(channel.name),
                                    "url" to JsonPrimitive(channel.url),
                                    "time" to JsonValues.num(channel.time),
                                ),
                            )
                        },
                    ),
                ),
            ),
        )
    }

    /** 只留下合法的項目（網址必須支援、不重複）；歷史每一邊最多 200 筆。 */
    internal fun normalize(root: JsonObject): Lists = Lists(
        favorites = normalizeItems(root["favorites"]),
        history = ListRules.capPerGroup(normalizeItems(root["history"]), ListRules.HISTORY_MAX),
        channels = normalizeChannels(root["channels"]),
    )

    private fun normalizeItems(raw: JsonElement?): List<ListItem> {
        val out = mutableListOf<ListItem>()
        for (entry in array(raw).orEmpty()) {
            val item = obj(entry) ?: continue
            val rawUrl = string(item["url"]) ?: continue
            if (SourceParser.parse(rawUrl) == null || out.any { ListRules.sameUrl(it.url, rawUrl) }) continue
            val url = rawUrl.trim()
            val name = string(item["name"])?.trim().orEmpty()
            out += ListItem(url, name.ifEmpty { url }, number(item["time"]) ?: 0.0)
        }
        return out
    }

    /** 只留下合法、不重複的頻道（舊的清單檔沒有訂閱時為空）。 */
    private fun normalizeChannels(raw: JsonElement?): List<Channel> {
        val out = mutableListOf<Channel>()
        for (entry in array(raw).orEmpty()) {
            val channel = obj(entry) ?: continue
            val id = string(channel["id"]) ?: continue
            if (!Channel.isId(id) || out.any { it.id == id }) continue
            val name = string(channel["name"])?.trim().orEmpty()
            out += Channel(
                id = id,
                name = name.ifEmpty { id },
                url = nonEmptyString(channel["url"]) ?: Channel.pageUrl(id),
                time = number(channel["time"]) ?: 0.0,
            )
        }
        return out
    }
}

/** 匯入桌面版的清單（R158）：合併進目前的清單。 */
object ListsImport {
    data class Summary(val favoritesAdded: Int = 0, val historyAdded: Int = 0, val channelsAdded: Int = 0) {
        /** 例如「最愛新增 12 筆、歷史新增 30 筆、訂閱新增 5 個頻道」。 */
        val message: String get() = "最愛新增 $favoritesAdded 筆、歷史新增 $historyAdded 筆、訂閱新增 $channelsAdded 個頻道"
    }

    data class Merged(val lists: Lists, val summary: Summary)

    fun merge(current: Lists, imported: Lists): Merged {
        // 最愛：網址相同的視為同一筆，保留目前的名稱；其他的加在最後面。
        val favorites = current.favorites.toMutableList()
        var favoritesAdded = 0
        for (item in imported.favorites) {
            if (favorites.none { ListRules.sameUrl(it.url, item.url) }) {
                favorites += item
                favoritesAdded++
            }
        }

        // 歷史：網址相同的保留最後播放時間比較新的那一筆，依時間重新排序，每一邊最多 200 筆。
        val history = current.history.toMutableList()
        var historyAdded = 0
        for (item in imported.history) {
            val index = history.indexOfFirst { ListRules.sameUrl(it.url, item.url) }
            if (index >= 0) {
                if (item.time > history[index].time) history[index] = item
            } else {
                history += item
                historyAdded++
            }
        }
        // sortedByDescending 是穩定排序：時間相同時維持原本的先後
        val sorted = history.sortedByDescending { it.time }

        // 訂閱：頻道代碼相同的視為同一個，其他的加入。
        val channels = current.channels.toMutableList()
        var channelsAdded = 0
        for (channel in imported.channels) {
            if (channels.none { it.id == channel.id }) {
                channels += channel
                channelsAdded++
            }
        }
        return Merged(
            Lists(favorites, ListRules.capPerGroup(sorted, ListRules.HISTORY_MAX), channels),
            Summary(favoritesAdded, historyAdded, channelsAdded),
        )
    }
}
