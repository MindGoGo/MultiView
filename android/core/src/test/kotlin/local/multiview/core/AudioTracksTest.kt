package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** yt-dlp 播放的聲音軌（R95）。照搬桌面版 tests/unit/audio-tracks.test.ts。 */
class AudioTracksTest {
    private val tracks = listOf(
        RawAudioTrack("en-US", "American English - dubbed-auto"),
        RawAudioTrack("zh-Hant", "zh-Hant - original"),
    )
    private val bothGroups = tracks + tracks

    @Test
    fun audioKind() {
        assertEquals(AudioKind.ORIGINAL, AudioTrackRules.audioKind("zh-Hant - original"))
        assertEquals(AudioKind.DUBBED_AUTO, AudioTrackRules.audioKind("American English - dubbed-auto"))
        assertEquals(AudioKind.DUBBED, AudioTrackRules.audioKind("日本語 - dubbed"))
        assertNull(AudioTrackRules.audioKind("Default"))
    }

    @Test
    fun langKey() {
        for ((lang, key) in listOf(
            "zh-TW" to "zh-hant", "zh-HK" to "zh-hant", "zh-Hant" to "zh-hant", "zh-Hant-TW" to "zh-hant",
            "zh-CN" to "zh-hans", "zh-Hans" to "zh-hans", "zh" to "zh", "en-US" to "en", "en-GB" to "en",
        )) assertEquals(key, AudioTrackRules.langKey(lang), lang)
        assertEquals("", AudioTrackRules.langKey(null))
    }

    @Test
    fun pick() {
        // 系統是繁體中文 → 中文原聲，不是排在前面的英文配音
        assertEquals(1, AudioTrackRules.pick(tracks, null, "zh-TW"))
        // 記住的語言優先於系統語言
        assertEquals(0, AudioTrackRules.pick(tracks, "en-US", "zh-TW"))
        assertEquals(0, AudioTrackRules.pick(tracks, "en-GB", "zh-TW"))
        // 記住的語言影片沒有 → 系統語言 → 原本的聲音
        assertEquals(1, AudioTrackRules.pick(tracks, "ja", "zh-TW"))
        assertEquals(1, AudioTrackRules.pick(tracks, "ja", "ko-KR"))
        assertEquals(0, AudioTrackRules.pick(tracks, null, "en-US"))

        val zh = listOf(
            RawAudioTrack("zh-Hans", "zh-Hans - dubbed-auto"),
            RawAudioTrack("ja", "ja - original"),
            RawAudioTrack("zh-Hant", "zh-Hant - dubbed-auto"),
        )
        assertEquals(0, AudioTrackRules.pick(zh, null, "zh-CN"))
        assertEquals(2, AudioTrackRules.pick(zh, null, "zh-TW"))
        assertEquals(1, AudioTrackRules.pick(zh, null, "fr-FR"))

        val en = listOf(RawAudioTrack("en-US", "English - dubbed"), RawAudioTrack("en", "English - original"))
        assertEquals(1, AudioTrackRules.pick(en, null, "en-US"))

        assertEquals(0, AudioTrackRules.pick(listOf(RawAudioTrack("ja", "a"), RawAudioTrack("ko", "b")), null, "zh-TW"))
        assertEquals(-1, AudioTrackRules.pick(emptyList(), null, "zh-TW"))
    }

    @Test
    fun options() {
        val options = AudioTrackRules.options(bothGroups)
        assertEquals(listOf(0, 1), options.map { it.index })
        assertEquals(AudioKind.DUBBED_AUTO, options[0].kind)
        assertEquals("（原本的聲音）", options[1].label.takeLast(7))
        assertEquals(1, AudioTrackRules.currentOption(bothGroups, options, 3))
        assertEquals(0, AudioTrackRules.currentOption(bothGroups, options, 0))
        assertEquals(-1, AudioTrackRules.currentOption(bothGroups, options, 9))
    }
}
