package local.multiview.core

import kotlinx.serialization.json.JsonElement
import java.util.Locale

/**
 * 字幕（桌面版 R31 的規則；Android 版 R156 用在 yt-dlp 播放）。
 * key 是保存在設定檔的代碼（和桌面版相同）：語言代碼；自動產生的字幕前面加 `asr:`。
 */
data class CaptionTrack(val key: String, val languageCode: String, val label: String, val auto: Boolean, val url: String)

/** 一段字幕：start、end 是秒數。 */
data class Cue(val start: Double, val end: Double, val text: String)

object CaptionRules {
    /** mv_bridge 的 captions 欄位（[{"lang", "name", "url", "auto"}]）轉成字幕清單；重複的只留第一個。 */
    fun fromYtDlp(raw: JsonElement?): List<CaptionTrack> {
        val out = mutableListOf<CaptionTrack>()
        for (item in JsonValues.array(raw).orEmpty().mapNotNull(JsonValues::obj)) {
            val lang = JsonValues.nonEmptyString(item["lang"]) ?: continue
            val url = JsonValues.nonEmptyString(item["url"]) ?: continue
            val auto = JsonValues.bool(item["auto"]) == true
            val key = (if (auto) "asr:" else "") + lang
            if (out.any { it.key == key }) continue
            val name = languageName(lang)
            out += CaptionTrack(key, lang, if (auto) "$name（自動產生）" else name, auto, url)
        }
        return out
    }

    private fun languageName(lang: String): String =
        Locale.forLanguageTag(lang).getDisplayName(Locale.TRADITIONAL_CHINESE).ifEmpty { lang }

    /**
     * 保存的選擇在這部影片要用哪一軌（桌面版 R31）：先找完全相同的，再找同一種語言的（優先人工字幕）；
     * 沒有就回傳 null（關閉）。
     */
    fun find(tracks: List<CaptionTrack>, key: String?): CaptionTrack? {
        if (key.isNullOrEmpty()) return null
        tracks.firstOrNull { it.key == key }?.let { return it }
        val code = key.removePrefix("asr:")
        return tracks.firstOrNull { it.languageCode == code && !it.auto } ?: tracks.firstOrNull { it.languageCode == code }
    }

    private val timing = Regex("^\\s*((?:\\d+:)?\\d{1,2}:\\d{2}[.,]\\d{1,3})\\s+-->\\s+((?:\\d+:)?\\d{1,2}:\\d{2}[.,]\\d{1,3})")
    private val tag = Regex("<[^>]*>")

    /**
     * 讀取 WebVTT。去掉樣式標籤（YouTube 自動字幕每個字的時間 `<00:00:01.000><c>…</c>`）；
     * YouTube 自動字幕是兩行捲動顯示，前一段的最後一行會在下一段重複，所以每段只留這段新出現的行。
     */
    fun parseVtt(text: String): List<Cue> {
        val cues = mutableListOf<Cue>()
        val lines = text.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        var i = 0
        var previous = emptyList<String>()
        while (i < lines.size) {
            val match = timing.find(lines[i])
            if (match == null) {
                i++
                continue
            }
            val start = seconds(match.groupValues[1])
            val end = seconds(match.groupValues[2])
            i++
            val body = mutableListOf<String>()
            while (i < lines.size && lines[i].isNotBlank()) {
                body += decode(tag.replace(lines[i], "")).trim()
                i++
            }
            val shown = body.filter { it.isNotEmpty() }
            // 很短的過渡段（YouTube 自動字幕約 0.01 秒）只是重複上一段，略過
            if (shown.isEmpty() || end - start < 0.05) continue
            val fresh = shown.dropWhile { it in previous }.ifEmpty { shown }
            previous = shown
            cues += Cue(start, end, fresh.joinToString("\n"))
        }
        return cues
    }

    /** 這個時間要顯示的字幕；沒有時回傳 null。 */
    fun cueAt(cues: List<Cue>, seconds: Double): String? {
        val showing = cues.filter { seconds >= it.start && seconds < it.end }
        return if (showing.isEmpty()) null else showing.joinToString("\n") { it.text }
    }

    private fun seconds(value: String): Double {
        val parts = value.replace(',', '.').split(':')
        return parts.fold(0.0) { total, part -> total * 60 + (part.toDoubleOrNull() ?: 0.0) }
    }

    private fun decode(text: String): String =
        text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&quot;", "\"")
}
