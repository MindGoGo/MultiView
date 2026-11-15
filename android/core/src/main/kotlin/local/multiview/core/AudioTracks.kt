package local.multiview.core

import java.util.Locale

/** 播放器提供的一條聲音軌：HLS 主清單 EXT-X-MEDIA 的 LANGUAGE 與 NAME。 */
data class RawAudioTrack(val lang: String?, val name: String)

/** YouTube 在 NAME 結尾標示的種類，例如「zh-Hant - original」「American English - dubbed-auto」。 */
enum class AudioKind(val label: String) { ORIGINAL("（原本的聲音）"), DUBBED_AUTO("（AI 配音）"), DUBBED("（配音）") }

/** 選單裡的一項：index 是播放器聲音軌的位置。 */
data class AudioOption(val index: Int, val lang: String, val kind: AudioKind?, val label: String)

/** yt-dlp 播放的聲音軌（桌面版 R95）：照搬 src/lib/audioTracks.ts 與 tests/unit/audio-tracks.test.ts。 */
object AudioTrackRules {
    private val kindPattern = Regex(" - (original|dubbed-auto|dubbed)\\b", RegexOption.IGNORE_CASE)
    private val hantRegions = setOf("tw", "hk", "mo")
    private val hansRegions = setOf("cn", "sg", "my")

    fun audioKind(name: String): AudioKind? = when (kindPattern.find(name)?.groupValues?.get(1)?.lowercase()) {
        "original" -> AudioKind.ORIGINAL
        "dubbed-auto" -> AudioKind.DUBBED_AUTO
        "dubbed" -> AudioKind.DUBBED
        else -> null
    }

    /** 比對用的語言：中文分繁體、簡體；其他語言只看主要語言。 */
    fun langKey(lang: String?): String {
        val parts = (lang ?: "").lowercase().split('-', '_').filter { it.isNotEmpty() }
        val base = parts.firstOrNull() ?: ""
        if (base != "zh") return base
        if ("hant" in parts || parts.any { it in hantRegions }) return "zh-hant"
        if ("hans" in parts || parts.any { it in hansRegions }) return "zh-hans"
        return "zh"
    }

    private fun sameLang(a: String, b: String) =
        a.isNotEmpty() && (a == b || (a == "zh" && b.startsWith("zh")) || (b == "zh" && a.startsWith("zh")))

    private fun languageName(lang: String): String {
        if (lang.isEmpty()) return "未知語言"
        val name = Locale.forLanguageTag(lang).getDisplayName(Locale.TRADITIONAL_CHINESE)
        return name.ifEmpty { lang }
    }

    /** 不同的聲音軌（語言＋種類相同的只列一次，取第一條），依播放器的順序。 */
    fun options(tracks: List<RawAudioTrack>): List<AudioOption> {
        val seen = mutableSetOf<String>()
        val out = mutableListOf<AudioOption>()
        tracks.forEachIndexed { index, track ->
            val lang = track.lang ?: ""
            val kind = audioKind(track.name)
            if (!seen.add("${lang.lowercase()}|${kind ?: track.name}")) return@forEachIndexed
            out += AudioOption(index, lang, kind, languageName(lang) + (kind?.label ?: ""))
        }
        return out
    }

    /** 播放器目前用的聲音軌對應到選單的哪一項（語言＋種類相同的算同一項）。 */
    fun currentOption(tracks: List<RawAudioTrack>, options: List<AudioOption>, current: Int): Int {
        val track = tracks.getOrNull(current) ?: return -1
        val kind = audioKind(track.name)
        return options.firstOrNull { it.lang == (track.lang ?: "") && it.kind == kind }?.index ?: current
    }

    /**
     * 要用哪一條聲音軌：這一格記住的語言 → 系統語言 → 原本的聲音 → 第一條。
     * 同一種語言有原本的聲音和配音時，優先原本的聲音。沒有聲音軌時回傳 -1。
     */
    fun pick(tracks: List<RawAudioTrack>, saved: String?, system: String): Int {
        if (tracks.isEmpty()) return -1
        fun byLang(lang: String?): Int {
            val key = langKey(lang)
            val matches = tracks.withIndex().filter { sameLang(langKey(it.value.lang), key) }
            if (matches.isEmpty()) return -1
            return (matches.firstOrNull { audioKind(it.value.name) == AudioKind.ORIGINAL } ?: matches[0]).index
        }
        if (!saved.isNullOrEmpty()) byLang(saved).let { if (it >= 0) return it }
        byLang(system).let { if (it >= 0) return it }
        val original = tracks.indexOfFirst { audioKind(it.name) == AudioKind.ORIGINAL }
        return if (original >= 0) original else 0
    }
}
