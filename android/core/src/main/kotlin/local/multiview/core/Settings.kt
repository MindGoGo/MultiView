package local.multiview.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import local.multiview.core.JsonValues.array
import local.multiview.core.JsonValues.bool
import local.multiview.core.JsonValues.nonEmptyString
import local.multiview.core.JsonValues.number
import local.multiview.core.JsonValues.obj
import local.multiview.core.JsonValues.string

/*
 * 設定檔的資料結構與驗證（桌面版 R10；Android 版 R155）。由 iOS 版的 Settings.swift 改寫。
 * 檔案格式和桌面版相同；手機不用的欄位（視窗位置、置頂、YouTube 小視窗的位置）不寫入，讀到也忽略。
 */

/** 保存在設定檔裡的一個來源。 */
data class SavedSource(
    val url: String,
    val muted: Boolean = false,
    val volume: Int = Volume.DEFAULT,
    /** 廣告阻擋（R17）；舊的設定檔沒有這個欄位時視為開啟。 */
    val adblock: Boolean = true,
    val quality: Quality = Quality.Auto,
    val captions: String? = null,
    val audioLang: String? = null,
    val brightness: Int = Brightness.DEFAULT,
    val youtubeWeb: Boolean = false,
    /** 觀看進度（秒，R55）；null 時從頭開始。 */
    val position: Double? = null,
    val backUrl: String? = null,
    val pageAdblock: Boolean = true,
)

/** 每一組（直播、一般影片）的播放方式（R88）。 */
enum class PlayMethod(val raw: String) { EMBED("embed"), YTDLP("ytdlp") }

data class YouTubeMethods(val live: PlayMethod = PlayMethod.EMBED, val vod: PlayMethod = PlayMethod.EMBED) {
    /** 兩組都是內嵌播放器時不執行 yt-dlp（R88）。 */
    val needsResolve: Boolean get() = live == PlayMethod.YTDLP || vod == PlayMethod.YTDLP
}

/** 其他網站的播放方式（R102）：網頁或 yt-dlp。 */
enum class WebMethod(val raw: String) { WEB("web"), YTDLP("ytdlp") }

/** 清單面板上次的那一邊和分頁（R58）。 */
data class ListTab(val group: ListGroup = ListGroup.YOUTUBE, val tab: Tab = Tab.FAVORITES) {
    enum class Tab(val raw: String) {
        SUBSCRIPTIONS("subscriptions"), FAVORITES("favorites"), HISTORY("history");

        companion object {
            fun fromRaw(raw: String?): Tab? = entries.firstOrNull { it.raw == raw }
        }
    }
}

data class Settings(
    val layout: LayoutId = LayoutId.DEFAULT,
    /** 每種版型各自的分隔線比例；沒有的版型用平均分配。 */
    val ratios: Map<LayoutId, Ratios> = emptyMap(),
    /** 固定 9 個格位。 */
    val slots: List<SavedSource?> = List(SlotRules.COUNT) { null },
    /** 總亮度（R41）。 */
    val brightness: Int = Brightness.DEFAULT,
    /** YouTube 無法嵌入時自動改用網頁播放（R49）。 */
    val autoYoutubeWeb: Boolean = false,
    val youtubeMethods: YouTubeMethods = YouTubeMethods(),
    val webMethod: WebMethod = WebMethod.WEB,
    val listTab: ListTab = ListTab(),
) {
    /** 這個版型目前的比例。 */
    fun ratiosFor(layout: LayoutId): Ratios = ratios[layout] ?: Ratios.defaults(layout)
}

data class ParsedSettings(val settings: Settings, val corrupt: Boolean)

object SettingsCodec {
    const val VERSION = 1

    /**
     * 解析設定檔內容。JSON 錯誤或結構不對時 corrupt 為 true，settings 為預設值。
     * 也用來匯入桌面版的設定檔：超過手機範圍的音量、亮度會改成上限。
     */
    fun parse(text: String): ParsedSettings {
        val settings = normalize(JsonValues.parse(text)) ?: return ParsedSettings(Settings(), true)
        return ParsedSettings(settings, false)
    }

    /** 把讀到的 JSON 轉成合法設定；整體結構不對時回傳 null（視為損毀）。個別欄位不合法時改用預設值。 */
    internal fun normalize(raw: JsonElement?): Settings? {
        val root = obj(raw) ?: return null
        if (number(root["version"]) != VERSION.toDouble()) return null
        return normalizeView(root)
    }

    /** 只接受合法的版型、比例與來源；其餘換成預設值。 */
    internal fun normalizeView(raw: JsonElement?): Settings {
        val root = obj(raw) ?: JsonObject(emptyMap())
        return Settings(
            layout = LayoutId.fromRaw(string(root["layout"])) ?: LayoutId.DEFAULT,
            ratios = normalizeRatios(root["ratios"]),
            slots = normalizeSlots(root["slots"]),
            brightness = Brightness.normalize(root["brightness"]),
            autoYoutubeWeb = bool(root["autoYoutubeWeb"]) == true,
            youtubeMethods = normalizeMethods(root["youtubeMethods"]),
            webMethod = if (string(root["webMethod"]) == "ytdlp") WebMethod.YTDLP else WebMethod.WEB,
            listTab = normalizeListTab(root["listTab"]),
        )
    }

    /** 輸出成設定檔的文字。 */
    fun encode(settings: Settings): String {
        val ratios = settings.ratios.entries.associate { (layout, value) ->
            layout.raw to JsonObject(
                mapOf(
                    "cols" to JsonArray(value.cols.map(::JsonPrimitive)),
                    "rows" to JsonArray(value.rows.map(::JsonPrimitive)),
                ),
            )
        }
        val slots = (0 until SlotRules.COUNT).map { index ->
            settings.slots.getOrNull(index)?.let(::encodeSource) ?: JsonNull
        }
        return JsonValues.encode(
            JsonObject(
                mapOf(
                    "version" to JsonPrimitive(VERSION),
                    "layout" to JsonPrimitive(settings.layout.raw),
                    "ratios" to JsonObject(ratios),
                    "slots" to JsonArray(slots),
                    "brightness" to JsonPrimitive(settings.brightness),
                    "autoYoutubeWeb" to JsonPrimitive(settings.autoYoutubeWeb),
                    "youtubeMethods" to JsonObject(
                        mapOf(
                            "live" to JsonPrimitive(settings.youtubeMethods.live.raw),
                            "vod" to JsonPrimitive(settings.youtubeMethods.vod.raw),
                        ),
                    ),
                    "webMethod" to JsonPrimitive(settings.webMethod.raw),
                    "listTab" to JsonObject(
                        mapOf(
                            "group" to JsonPrimitive(settings.listTab.group.raw),
                            "tab" to JsonPrimitive(settings.listTab.tab.raw),
                        ),
                    ),
                ),
            ),
        )
    }

    private fun encodeSource(source: SavedSource): JsonObject = JsonObject(
        mapOf(
            "url" to JsonPrimitive(source.url),
            "muted" to JsonPrimitive(source.muted),
            "volume" to JsonPrimitive(source.volume),
            "adblock" to JsonPrimitive(source.adblock),
            "quality" to source.quality.jsonValue,
            "captions" to JsonValues.orNull(source.captions),
            "audioLang" to JsonValues.orNull(source.audioLang),
            "brightness" to JsonPrimitive(source.brightness),
            "youtubeWeb" to JsonPrimitive(source.youtubeWeb),
            "position" to JsonValues.orNull(source.position),
            "backUrl" to JsonValues.orNull(source.backUrl),
            "pageAdblock" to JsonPrimitive(source.pageAdblock),
        ),
    )

    private fun normalizeRatios(raw: JsonElement?): Map<LayoutId, Ratios> {
        val root = obj(raw) ?: return emptyMap()
        val out = mutableMapOf<LayoutId, Ratios>()
        for (layout in LayoutId.entries) {
            val entry = obj(root[layout.raw]) ?: continue
            val cols = numbers(entry["cols"]) ?: continue
            val rows = numbers(entry["rows"]) ?: continue
            val ratios = Ratios(cols, rows)
            if (ratios.isValid(layout)) out[layout] = ratios
        }
        return out
    }

    /** 全部都是數字的陣列，否則 null。 */
    private fun numbers(raw: JsonElement?): List<Double>? {
        val list = array(raw) ?: return null
        return list.map { number(it) ?: return null }
    }

    private fun normalizeSource(raw: JsonElement?): SavedSource? {
        val root = obj(raw) ?: return null
        val url = string(root["url"]) ?: return null
        if (SourceParser.parse(url) == null) return null
        return SavedSource(
            url = url,
            muted = bool(root["muted"]) == true,
            volume = Volume.normalize(root["volume"]),
            adblock = bool(root["adblock"]) != false,
            quality = Quality.normalize(root["quality"]),
            captions = nonEmptyString(root["captions"]),
            audioLang = nonEmptyString(root["audioLang"]),
            brightness = Brightness.normalize(root["brightness"]),
            youtubeWeb = bool(root["youtubeWeb"]) == true,
            position = number(root["position"])?.takeIf { it > 0 },
            backUrl = string(root["backUrl"])?.takeIf(SourceParser::isYouTubeSite),
            pageAdblock = bool(root["pageAdblock"]) != false,
        )
    }

    private fun normalizeSlots(raw: JsonElement?): List<SavedSource?> {
        val list = array(raw).orEmpty()
        return (0 until SlotRules.COUNT).map { index -> list.getOrNull(index)?.let(::normalizeSource) }
    }

    private fun normalizeMethods(raw: JsonElement?): YouTubeMethods {
        val root = obj(raw) ?: JsonObject(emptyMap())
        return YouTubeMethods(
            live = if (string(root["live"]) == "ytdlp") PlayMethod.YTDLP else PlayMethod.EMBED,
            vod = if (string(root["vod"]) == "ytdlp") PlayMethod.YTDLP else PlayMethod.EMBED,
        )
    }

    private fun normalizeListTab(raw: JsonElement?): ListTab {
        val root = obj(raw) ?: return ListTab()
        val group = ListGroup.fromRaw(string(root["group"])) ?: return ListTab()
        val tab = ListTab.Tab.fromRaw(string(root["tab"])) ?: return ListTab()
        // 訂閱只在 YouTube 那一邊（R59）
        if (tab == ListTab.Tab.SUBSCRIPTIONS && group != ListGroup.YOUTUBE) return ListTab()
        return ListTab(group, tab)
    }
}

/** 設定和格子之間的轉換（R155）。 */
object SettingsBridge {
    /** 從設定檔還原格子：所有來源載入後維持暫停（R10 AC1），從上次的觀看進度開始（R55）。 */
    fun restoreSlots(saved: List<SavedSource?>): Slots = (0 until SlotRules.COUNT).map { index ->
        val source = saved.getOrNull(index) ?: return@map null
        val parsed = SourceParser.resolve(source.url, source.youtubeWeb) ?: return@map null
        CellSource(
            url = source.url,
            parsed = parsed,
            muted = source.muted,
            volume = source.volume,
            autoplay = false,
            adblock = source.adblock,
            record = false,
            quality = source.quality,
            captions = source.captions,
            audioLang = source.audioLang,
            brightness = source.brightness,
            youtubeWeb = source.youtubeWeb,
            resume = source.position,
            backUrl = source.backUrl,
            pageAdblock = source.pageAdblock,
        )
    }

    /** 把格子轉成要保存的來源。positions 是每一格目前的觀看進度（秒）；沒有的格子不保存進度。 */
    fun saveSlots(slots: Slots, positions: Map<Int, Double> = emptyMap()): List<SavedSource?> =
        (0 until SlotRules.COUNT).map { index ->
            val source = slots.getOrNull(index) ?: return@map null
            SavedSource(
                url = source.url,
                muted = source.muted,
                volume = source.volume,
                adblock = source.adblock,
                quality = source.quality,
                captions = source.captions,
                audioLang = source.audioLang,
                brightness = source.brightness,
                youtubeWeb = source.youtubeWeb,
                position = positions[index]?.takeIf { it > 0 && it.isFinite() },
                backUrl = source.backUrl,
                pageAdblock = source.pageAdblock,
            )
        }
}
