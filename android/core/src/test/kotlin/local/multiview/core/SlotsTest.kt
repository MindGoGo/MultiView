package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 格位（R4、R6）、聲音規則（R7、R8、R152）、亮度、音量、畫質。照搬 iOS 版的 SlotsTests.swift。 */
class SlotsTest {
    private fun source(name: String, muted: Boolean = false, volume: Int = 100): CellSource {
        val url = "https://example.com/$name.mp4"
        return CellSource(url = url, parsed = ParsedSource.Mp4(url), muted = muted, volume = volume)
    }

    private fun slots(vararg sources: CellSource?): Slots =
        SlotRules.empty().toMutableList().also { list -> sources.forEachIndexed { index, source -> list[index] = source } }

    @Test
    fun sourceIdsAreUnique() {
        assertEquals(50, List(50) { SourceId.next() }.toSet().size)
        assertNotEquals(source("a").id, source("a").id)
    }

    @Test
    fun emptySlots() {
        assertEquals(9, SlotRules.empty().size)
        assertTrue(SlotRules.empty().all { it == null })
    }

    @Test
    fun visibility() {
        assertTrue(SlotRules.isVisible(3, LayoutId.GRID2))
        assertFalse(SlotRules.isVisible(4, LayoutId.GRID2))
        assertTrue(SlotRules.isVisible(8, LayoutId.GRID3))
        assertFalse(SlotRules.isVisible(1, LayoutId.ONE))
        // 單格全螢幕：只有放大的那一格顯示中（R20）
        assertTrue(SlotRules.isVisible(2, LayoutId.GRID2, solo = 2))
        assertFalse(SlotRules.isVisible(0, LayoutId.GRID2, solo = 2))
    }

    @Test
    fun setAndSwap() {
        val a = source("a")
        val b = source("b")
        var slots = SlotRules.set(SlotRules.empty(), 0, a)
        slots = SlotRules.set(slots, 3, b)
        assertEquals(a, slots[0])
        assertEquals(b, slots[3])

        // 兩格互換，id 不變（不重新載入，R6 AC1）
        val swapped = SlotRules.swap(slots, 0, 3)
        assertEquals(b.id, swapped[0]?.id)
        assertEquals(a.id, swapped[3]?.id)

        // 拖到空白格：來源移過去，原本的格子變成空白（R6 AC2）
        val moved = SlotRules.swap(slots, 0, 1)
        assertNull(moved[0])
        assertEquals(a, moved[1])

        // 放開在原本的格子、不存在的格位：沒有變化（R6 AC3）
        assertEquals(slots, SlotRules.swap(slots, 3, 3))
        assertEquals(slots, SlotRules.swap(slots, 0, 9))
        assertEquals(slots, SlotRules.set(slots, 9, a))
    }

    @Test
    fun removingDoesNotShiftOthers() {
        val slots = slots(source("a"), source("b"), source("c"))
        val next = SlotRules.set(slots, 1, null)
        assertEquals(slots[0], next[0])
        assertNull(next[1])
        assertEquals(slots[2], next[2])
    }

    @Test
    fun hiddenCount() {
        val slots = slots(source("a"), null, source("c"), source("d"), source("e"), null, source("g"))
        assertEquals(0, SlotRules.hiddenCount(slots, LayoutId.GRID3))
        assertEquals(2, SlotRules.hiddenCount(slots, LayoutId.GRID2))
        assertEquals(4, SlotRules.hiddenCount(slots, LayoutId.TWO))
        assertEquals(4, SlotRules.hiddenCount(slots, LayoutId.ONE))
    }

    @Test
    fun firstEmptyVisible() {
        val slots = slots(source("a"), source("b"))
        assertEquals(2, SlotRules.firstEmptyVisible(slots, LayoutId.GRID2))
        assertNull(SlotRules.firstEmptyVisible(slots, LayoutId.TWO))
        assertNull(SlotRules.firstEmptyVisible(slots, LayoutId.GRID2, solo = 0))
        assertEquals(0, SlotRules.firstEmptyVisible(SlotRules.empty(), LayoutId.ONE))
    }

    // 聲音（R7、R8）

    @Test
    fun initialMuted() {
        // 沒有任何顯示中的來源有聲音 → 新來源有聲音（R7 AC1）
        assertFalse(AudioRules.initialMuted(SlotRules.empty(), LayoutId.GRID2))
        assertFalse(AudioRules.initialMuted(slots(source("a", muted = true)), LayoutId.GRID2))
        assertFalse(AudioRules.initialMuted(slots(source("a", volume = 0)), LayoutId.GRID2))
        assertTrue(AudioRules.initialMuted(slots(source("a")), LayoutId.GRID2))
        // 有聲音的來源不在目前的版型裡 → 不算
        val hidden = slots(null, null, null, null, source("e"))
        assertFalse(AudioRules.initialMuted(hidden, LayoutId.GRID2))
        assertTrue(AudioRules.initialMuted(hidden, LayoutId.GRID3))
    }

    @Test
    fun focusAudio() {
        // 格子 1、2 都有聲音，點格子 3 → 只有格子 3 有聲音（R7 AC2）
        val slots = slots(source("a"), source("b"), source("c", muted = true))
        val next = AudioRules.focus(slots, 2)
        assertEquals(listOf(true, true, false), next.take(3).map { it?.muted })
        // 點空白格不影響聲音
        assertEquals(slots, AudioRules.focus(slots, 5))
        assertEquals(slots, AudioRules.focus(slots, 20))
    }

    @Test
    fun toggleMute() {
        // 只有格子 1 有聲音，按格子 2 的喇叭 → 1、2 都有聲音（R7 AC3）
        val slots = slots(source("a"), source("b", muted = true))
        val next = AudioRules.toggleMute(slots, 1)
        assertEquals(listOf(false, false), next.take(2).map { it?.muted })
        assertEquals(listOf(false, true), AudioRules.toggleMute(next, 1).take(2).map { it?.muted })
    }

    @Test
    fun webAudioIsExclusive() {
        // WebView 不讓兩個網頁同時出聲：YouTube 內嵌、網頁來源同一時間只有一格有聲音（R152）
        val yt1 = CellSource(url = "https://youtu.be/aaaaaaaaaaa", parsed = ParsedSource.YouTube("aaaaaaaaaaa"))
        val yt2 = CellSource(url = "https://youtu.be/bbbbbbbbbbb", parsed = ParsedSource.YouTube("bbbbbbbbbbb"), muted = true)
        val web = CellSource(url = "https://example.com/", parsed = ParsedSource.Web("https://example.com/"))
        val native = source("n")
        val slots = slots(yt1, yt2, web, native)

        assertTrue(yt1.usesWebAudio)
        assertTrue(web.usesWebAudio)
        assertFalse(native.usesWebAudio)

        // 第 2 格（YouTube）取消靜音 → 其他網頁播放的格子靜音，原生播放器不受影響
        assertTrue(AudioRules.unmutingSilencesOthers(slots, 1))
        val next = AudioRules.toggleMute(slots, 1)
        assertEquals(listOf(true, false, true, false), next.take(4).map { it?.muted })

        // 靜音不影響其他格子
        assertFalse(AudioRules.unmutingSilencesOthers(slots, 0))
        assertEquals(listOf(true, true, false, false), AudioRules.toggleMute(slots, 0).take(4).map { it?.muted })

        // 原生播放器取消靜音不影響網頁播放的格子
        val muted = slots(yt1, source("m", muted = true))
        assertFalse(AudioRules.unmutingSilencesOthers(muted, 1))
        assertEquals(listOf(false, false), AudioRules.toggleMute(muted, 1).take(2).map { it?.muted })

        // YouTube 用 yt-dlp 播放時是原生播放器：由 App 告知不是網頁聲音，就不互相靜音
        assertFalse(AudioRules.unmutingSilencesOthers(slots, 1) { false })
        assertEquals(
            listOf(false, false, false, false),
            AudioRules.toggleMute(slots, 1) { false }.take(4).map { it?.muted },
        )

        // 空白格、不存在的格位
        assertEquals(slots, AudioRules.toggleMute(slots, 6))
        assertFalse(AudioRules.unmutingSilencesOthers(slots, 6))
    }

    @Test
    fun setVolume() {
        val slots = slots(source("a"), source("b"))
        val next = AudioRules.setVolume(slots, 1, 40.0)
        assertEquals(listOf(100, 40), next.take(2).map { it?.volume })
        // 最高 100%
        assertEquals(100, AudioRules.setVolume(slots, 0, 150.0)[0]?.volume)
        assertEquals(0, AudioRules.setVolume(slots, 0, -5.0)[0]?.volume)
        assertEquals(34, AudioRules.setVolume(slots, 0, 33.6)[0]?.volume)
    }

    @Test
    fun muteAllKeepsVolumes() {
        val slots = slots(source("a", volume = 30), source("b", muted = true, volume = 80))
        val next = AudioRules.muteAll(slots)
        assertEquals(listOf(true, true), next.take(2).map { it?.muted })
        assertEquals(listOf(30, 80), next.take(2).map { it?.volume })
    }

    @Test
    fun isAudible() {
        assertTrue(source("a").isAudible)
        assertFalse(source("a", muted = true).isAudible)
        assertFalse(source("a", volume = 0).isAudible)
    }

    // 亮度、音量、畫質

    @Test
    fun brightnessNormalize() {
        assertEquals(100, Brightness.normalize(null))
        assertEquals(100, Brightness.normalize(j("50")))
        assertEquals(50, Brightness.normalize(j(50)))
        assertEquals(50, Brightness.normalize(j(52)))
        assertEquals(55, Brightness.normalize(j(53)))
        assertEquals(20, Brightness.normalize(j(5)))
        assertEquals(100, Brightness.normalize(j(150))) // 桌面版最高 150，手機最高 100
        assertEquals(100, Brightness.normalize(j(true)))
    }

    @Test
    fun effectiveBrightness() {
        // 總亮度 80%、某一格 50% → 40%
        assertEquals(40.0, Brightness.effective(50, 80))
        assertEquals(0.6, Brightness.dimOpacity(50, 80), 1e-9)
        assertEquals(0.0, Brightness.dimOpacity(100, 100))
    }

    @Test
    fun volumeNormalize() {
        assertEquals(100, Volume.normalize(null))
        assertEquals(100, Volume.normalize(j("40")))
        assertEquals(40, Volume.normalize(j(40)))
        assertEquals(41, Volume.normalize(j(40.5)))
        assertEquals(0, Volume.normalize(j(-3)))
        assertEquals(100, Volume.normalize(j(200)))
        assertEquals(0.4, Volume.fraction(40), 1e-9)
        assertEquals(1.0, Volume.fraction(100))
    }

    @Test
    fun qualityNormalize() {
        assertEquals(Quality.Auto, Quality.normalize(j("auto")))
        assertEquals(Quality.Auto, Quality.normalize(null))
        assertEquals(Quality.Height(1080), Quality.normalize(j("high")))
        assertEquals(Quality.Height(720), Quality.normalize(j(720)))
        assertEquals(Quality.Auto, Quality.normalize(j(50)))
        assertEquals(Quality.Auto, Quality.normalize(j(20000)))
        assertEquals(Quality.Auto, Quality.normalize(j(720.5)))
        assertEquals("自動", Quality.Auto.label)
        assertEquals("1080p", Quality.Height(1080).label)
    }
}
