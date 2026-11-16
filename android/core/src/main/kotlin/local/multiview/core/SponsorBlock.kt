package local.multiview.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.MessageDigest

/*
 * SponsorBlock（R161）：跳過社群標記的業配等片段，只用在 yt-dlp 播放的 YouTube 一般影片。
 * 資料來自 SponsorBlock（https://sponsor.ajay.app），授權 CC BY-NC-SA 4.0。
 * 這個檔案只有規則，不連網路、不碰畫面；iOS 版在 MultiViewCore 的 SponsorBlock.swift 照搬同樣的規則與測試。
 */

/**
 * 片段的類別。raw 是 API 與設定檔用的代碼，label 是提示與設定頁顯示的名稱，
 * color 是進度條色塊的顏色（0xRRGGBB，和 SponsorBlock 官方擴充功能的預設顏色相同）。
 * poi_highlight（精華時間點）不是要跳過的片段，第一版不列出。
 */
enum class SponsorCategory(val raw: String, val label: String, val color: Long) {
    SPONSOR("sponsor", "業配", 0x00D400),
    SELFPROMO("selfpromo", "自我宣傳", 0xFFFF00),
    INTERACTION("interaction", "訂閱提醒", 0xCC00FF),
    INTRO("intro", "開場", 0x00FFFF),
    OUTRO("outro", "片尾", 0x0202ED),
    PREVIEW("preview", "預告與回顧", 0x008FD6),
    FILLER("filler", "離題閒聊", 0x7300FF),
    MUSIC_OFFTOPIC("music_offtopic", "音樂影片的非音樂部分", 0xFF9900),
    ;

    companion object {
        fun fromRaw(raw: String?): SponsorCategory? = entries.firstOrNull { it.raw == raw }
    }
}

/** 一個要跳過的片段：start、end 是秒數；id 是 SponsorBlock 的 UUID（合併的片段用第一個的）。 */
data class SponsorSegment(val start: Double, val end: Double, val category: SponsorCategory, val id: String)

/** 設定（預設開啟，只跳過業配）。 */
data class SponsorBlockSettings(
    val enabled: Boolean = true,
    val categories: Set<SponsorCategory> = setOf(SponsorCategory.SPONSOR),
) {
    /** 要不要跳過任何片段（關閉或一個類別都沒勾時不連 API）。 */
    val active: Boolean get() = enabled && categories.isNotEmpty()
}

/** 自動跳過：跳到 target 秒（片段結尾；片段結尾在影片最後 1 秒內時是影片長度，視為播完）。 */
data class SkipAction(val segment: SponsorSegment, val target: Double)

/**
 * 每一格各自的跳過狀態：已經處理過的片段（自動跳過過、使用者取消、使用者自己跳進去的）不再自動跳過。
 * 不可變；每次改變回傳新的狀態。
 */
data class SkipState(val handled: Set<String> = emptySet()) {
    /** 這個片段處理過了（跳過或取消）。 */
    fun markHandled(segment: SponsorSegment): SkipState = SkipState(handled + segment.id)

    /**
     * 使用者自己跳轉（拖曳進度條、雙擊快轉倒轉、從上次的進度開始）到 time：
     * 落在片段裡面時，這個片段當作處理過，不會馬上又被跳走。
     */
    fun userSeeked(segments: List<SponsorSegment>, time: Double): SkipState {
        val inside = segments.filter { time >= it.start && time < it.end }.map { it.id }
        return if (inside.isEmpty()) this else SkipState(handled + inside)
    }
}

/** 進度條上的一個色塊：start、end 是 0–1 的比例。 */
data class SegmentMark(val start: Double, val end: Double, val category: SponsorCategory)

object SponsorBlockRules {
    const val API_BASE = "https://sponsor.ajay.app/api/skipSegments/"

    /** 請求逾時（毫秒）。逾時或失敗當作沒有片段，不影響播放。 */
    const val TIMEOUT_MS = 5_000

    /** 比這個短（秒）的片段忽略。 */
    const val MIN_SEGMENT_SECONDS = 1.0

    /** 片段結尾在影片最後這幾秒內時，跳到影片結尾（視為播完）。 */
    const val END_MARGIN_SECONDS = 1.0

    /** 播放位置離片段結尾不到這幾秒時不跳（跳了也只省一下子，而且避免剛跳完又判斷到同一段）。 */
    const val MIN_REMAINING_SECONDS = 0.3

    /** 檢查播放位置的間隔（毫秒）。 */
    const val CHECK_INTERVAL_MS = 250L

    /** 跳過提示顯示多久（毫秒）。 */
    const val NOTICE_MS = 5_000L

    /** 影片 ID 的 SHA-256（十六進位小寫）的前 4 碼：隱私版 API 只送前綴，不讓伺服器知道在看哪一部。 */
    fun hashPrefix(videoId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(videoId.toByteArray(Charsets.UTF_8))
        return digest.take(2).joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    /**
     * 請求網址：`<API_BASE><雜湊前綴>?categories=[...]`（JSON 陣列，網址編碼）。
     * App 一律要全部的類別（只有幾 KB），在本機依設定過濾：改設定時不用重新抓。
     */
    fun requestUrl(videoId: String, categories: Collection<SponsorCategory> = SponsorCategory.entries): String {
        val list = SponsorCategory.entries.filter { it in categories }.joinToString("%2C") { "%22${it.raw}%22" }
        return API_BASE + hashPrefix(videoId) + "?categories=%5B" + list + "%5D"
    }

    /**
     * 解析 API 的回應（HTTP 200 的內容；404 代表沒有片段，App 直接當作空的）：
     * 回應裡有很多部影片，只取 videoID 相同的；只要 actionType 是 skip（沒有這個欄位也當作 skip）、
     * 起訖合理、類別認得的片段。格式不對時回傳空的。順序照 API，還沒過濾、合併（見 [select]）。
     */
    fun parse(text: String, videoId: String): List<SponsorSegment> {
        val videos = JsonValues.array(JsonValues.parse(text)) ?: return emptyList()
        val out = mutableListOf<SponsorSegment>()
        for (video in videos.mapNotNull(JsonValues::obj)) {
            if (JsonValues.string(video["videoID"]) != videoId) continue
            for (item in JsonValues.array(video["segments"]).orEmpty().mapNotNull(JsonValues::obj)) {
                val action = JsonValues.string(item["actionType"]) ?: "skip"
                if (action != "skip") continue
                val category = SponsorCategory.fromRaw(JsonValues.string(item["category"])) ?: continue
                val range = JsonValues.array(item["segment"]) ?: continue
                val start = JsonValues.number(range.getOrNull(0)) ?: continue
                val end = JsonValues.number(range.getOrNull(1)) ?: continue
                if (!start.isFinite() || !end.isFinite() || end <= start) continue
                val id = JsonValues.nonEmptyString(item["UUID"]) ?: "${category.raw}@$start"
                out += SponsorSegment(start.coerceAtLeast(0.0), end, category, id)
            }
        }
        return out
    }

    /**
     * 依設定挑出要跳過的片段：只留勾選的類別、忽略太短的，依開始時間排序，重疊或相接的合併成一段
     * （合併後的類別與 id 用最早開始的那一段）。關閉時回傳空的。
     */
    fun select(segments: List<SponsorSegment>, settings: SponsorBlockSettings): List<SponsorSegment> {
        if (!settings.active) return emptyList()
        val sorted = segments
            .filter { it.category in settings.categories && it.end - it.start >= MIN_SEGMENT_SECONDS }
            .sortedWith(compareBy({ it.start }, { it.end }))
        val merged = mutableListOf<SponsorSegment>()
        for (segment in sorted) {
            val last = merged.lastOrNull()
            if (last != null && segment.start <= last.end) {
                if (segment.end > last.end) merged[merged.size - 1] = last.copy(end = segment.end)
            } else {
                merged += segment
            }
        }
        return merged
    }

    /**
     * 定時檢查：播放位置 time 在還沒處理過的片段裡面時，回傳要跳到哪裡；不用跳時回傳 null。
     * duration 是影片長度（秒；不知道時傳 NaN）。跳過之後由呼叫的一方把片段標成處理過（[SkipState.markHandled]）。
     * 使用者自己跳進片段裡時，呼叫的一方先用 [SkipState.userSeeked] 標成處理過，這裡就不會跳。
     */
    fun check(segments: List<SponsorSegment>, state: SkipState, time: Double, duration: Double): SkipAction? {
        if (!time.isFinite()) return null
        val segment = segments.firstOrNull {
            it.id !in state.handled && time >= it.start && time < it.end - MIN_REMAINING_SECONDS
        } ?: return null
        val known = duration.isFinite() && duration > 0
        val target = if (known && segment.end >= duration - END_MARGIN_SECONDS) duration else segment.end
        return SkipAction(segment, target)
    }

    /** 跳過提示的文字，例如「已跳過業配」。 */
    fun skippedLabel(category: SponsorCategory): String = "已跳過${category.label}"

    /** 這個時間在哪一個片段裡（進度條預覽顯示類別用）；不在任何片段裡時回傳 null。 */
    fun segmentAt(segments: List<SponsorSegment>, time: Double): SponsorSegment? =
        segments.firstOrNull { time >= it.start && time < it.end }

    /** 進度條色塊的比例位置；影片長度不知道時沒有色塊。超出影片長度的部分截掉。 */
    fun marks(segments: List<SponsorSegment>, duration: Double): List<SegmentMark> {
        if (!duration.isFinite() || duration <= 0) return emptyList()
        return segments.mapNotNull {
            val start = (it.start / duration).coerceIn(0.0, 1.0)
            val end = (it.end / duration).coerceIn(0.0, 1.0)
            if (end > start) SegmentMark(start, end, it.category) else null
        }
    }

    // 設定檔（settings.json 的 sponsorBlock 欄位）

    /** 讀設定；沒有這個欄位或格式不對時用預設值，不認得的類別忽略。 */
    fun normalizeSettings(raw: JsonElement?): SponsorBlockSettings {
        val root = JsonValues.obj(raw) ?: return SponsorBlockSettings()
        val defaults = SponsorBlockSettings()
        val list = JsonValues.array(root["categories"])
        return SponsorBlockSettings(
            enabled = JsonValues.bool(root["enabled"]) ?: defaults.enabled,
            categories = list?.mapNotNull { SponsorCategory.fromRaw(JsonValues.string(it)) }?.toSet() ?: defaults.categories,
        )
    }

    fun encodeSettings(settings: SponsorBlockSettings): JsonObject = JsonObject(
        mapOf(
            "enabled" to JsonPrimitive(settings.enabled),
            "categories" to JsonArray(SponsorCategory.entries.filter { it in settings.categories }.map { JsonPrimitive(it.raw) }),
        ),
    )
}
