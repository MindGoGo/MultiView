package local.multiview.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 進度條（R19）、快轉倒轉（R51）、記住觀看進度（R55）、全部播放／暫停（R8、R9）。照搬 iOS 版的 ProgressTests.swift。 */
class ProgressTest {
    private fun vod(current: Double, end: Double) = PlaybackProgress(current, 0.0, end, false)

    @Test
    fun vodView() {
        assertEquals(ProgressDisplay(ProgressKind.VOD, 0.25, false), ProgressRules.view(vod(30.0, 120.0)))
        assertEquals(1.0, ProgressRules.view(vod(500.0, 120.0)).fraction)
        assertEquals(0.0, ProgressRules.view(vod(10.0, 0.0)).fraction)
    }

    @Test
    fun liveView() {
        // 可回放範圍不到 60 秒：沒有進度條
        val short = PlaybackProgress(100.0, 80.0, 110.0, true)
        assertEquals(ProgressDisplay(ProgressKind.LIVE, 0.0, true), ProgressRules.view(short))
        // 可回放的直播
        val dvr = PlaybackProgress(400.0, 100.0, 700.0, true)
        assertEquals(ProgressDisplay(ProgressKind.DVR, 0.5, false), ProgressRules.view(dvr))
        assertTrue(ProgressRules.view(PlaybackProgress(695.0, 100.0, 700.0, true)).atLive)
    }

    @Test
    fun seekTarget() {
        assertEquals(100.0, ProgressRules.seekTarget(vod(0.0, 200.0), 0.5))
        assertEquals(200.0, ProgressRules.seekTarget(vod(0.0, 200.0), 2.0))
        assertEquals(400.0, ProgressRules.seekTarget(PlaybackProgress(0.0, 100.0, 700.0, true), 0.5))
        assertEquals(0.0, ProgressRules.seekTarget(vod(0.0, 200.0), Double.NaN))
    }

    @Test
    fun skipTarget() {
        assertEquals(40.0, ProgressRules.skipTarget(vod(30.0, 120.0), 10.0))
        assertEquals(0.0, ProgressRules.skipTarget(vod(3.0, 120.0), -10.0))
        assertEquals(120.0, ProgressRules.skipTarget(vod(115.0, 120.0), 10.0))
        // 沒有回放範圍的直播不能快轉
        assertNull(ProgressRules.skipTarget(PlaybackProgress(100.0, 80.0, 110.0, true), 10.0))
        // 可回放的直播限制在回放範圍內
        assertEquals(100.0, ProgressRules.skipTarget(PlaybackProgress(105.0, 100.0, 700.0, true), -10.0))
    }

    @Test
    fun resumePosition() {
        assertEquals(180.0, ProgressRules.resumePosition(vod(180.04, 600.0)))
        assertEquals(180.3, ProgressRules.resumePosition(vod(180.26, 600.0)))
        assertNull(ProgressRules.resumePosition(null))
        assertNull(ProgressRules.resumePosition(vod(3.0, 600.0))) // 還不到 5 秒
        assertNull(ProgressRules.resumePosition(vod(597.0, 600.0))) // 距離結尾不到 5 秒
        assertNull(ProgressRules.resumePosition(vod(180.0, 600.0), ended = true))
        assertNull(ProgressRules.resumePosition(PlaybackProgress(400.0, 100.0, 700.0, true)))
    }

    @Test
    fun formatTime() {
        assertEquals("0:00", ProgressRules.formatTime(0.0))
        assertEquals("1:05", ProgressRules.formatTime(65.9))
        assertEquals("1:00:00", ProgressRules.formatTime(3600.0))
        assertEquals("1:02:05", ProgressRules.formatTime(3725.0))
        assertEquals("0:00", ProgressRules.formatTime(-5.0))
        assertEquals("0:00", ProgressRules.formatTime(Double.NaN))
        assertEquals("-1:23", ProgressRules.formatBehind(83.0))
    }

    @Test
    fun fromMedia() {
        // 還沒載入
        assertNull(ProgressRules.fromMedia(MediaInfo(Double.NaN, 0.0)))
        assertNull(ProgressRules.fromMedia(MediaInfo(0.0, 0.0)))
        // 一般影片
        assertEquals(vod(30.0, 120.0), ProgressRules.fromMedia(MediaInfo(120.0, 30.0)))
        // 直播：長度無限大或極大
        assertEquals(
            PlaybackProgress(500.0, 100.0, 700.0, true),
            ProgressRules.fromMedia(MediaInfo(Double.POSITIVE_INFINITY, 500.0, listOf(100.0..300.0, 300.0..700.0))),
        )
        assertEquals(PlaybackProgress(50.0, 50.0, 50.0, true), ProgressRules.fromMedia(MediaInfo(9_999_999.0, 50.0)))
        // 已知是直播時不看長度
        assertEquals(
            PlaybackProgress(5.0, 0.0, 90.0, true),
            ProgressRules.fromMedia(MediaInfo(Double.NaN, 5.0, listOf(0.0..90.0), live = true)),
        )
        assertEquals(vod(30.0, 120.0), ProgressRules.fromMedia(MediaInfo(120.0, 30.0, live = false)))
    }

    // 全部播放／暫停（R8、R9）

    private fun slots(count: Int): Slots = SlotRules.empty().toMutableList().also { list ->
        for (index in 0 until count) {
            val url = "https://example.com/$index.mp4"
            list[index] = CellSource(url = url, parsed = ParsedSource.Mp4(url))
        }
    }

    @Test
    fun playStatusShowsPause() {
        assertTrue(PlayStatus.PLAYING.showsPause)
        assertTrue(PlayStatus.LOADING.showsPause)
        assertFalse(PlayStatus.PAUSED.showsPause)
        assertFalse(PlayStatus.ENDED.showsPause)
        assertFalse(PlayStatus.ERROR.showsPause)
    }

    @Test
    fun controllableIndices() {
        val slots = slots(6)
        val statuses = mapOf(slots[1]!!.id to PlayStatus.ERROR)
        // 2×2 只有前 4 格顯示中；錯誤狀態的不算
        assertEquals(listOf(0, 2, 3), PlaybackRules.controllableIndices(slots, LayoutId.GRID2, statuses))
        // 單格全螢幕只有放大的那一格
        assertEquals(listOf(2), PlaybackRules.controllableIndices(slots, LayoutId.GRID2, statuses, solo = 2))
    }

    @Test
    fun toggleAllAction() {
        val slots = slots(6)
        val statuses = mutableMapOf<Int, PlayStatus>()
        assertEquals(PlaybackRules.ToggleAction.PLAY, PlaybackRules.toggleAllAction(slots, LayoutId.GRID2, statuses))
        statuses[slots[0]!!.id] = PlayStatus.PAUSED
        assertEquals(PlaybackRules.ToggleAction.PLAY, PlaybackRules.toggleAllAction(slots, LayoutId.GRID2, statuses))
        statuses[slots[3]!!.id] = PlayStatus.PLAYING
        assertEquals(PlaybackRules.ToggleAction.PAUSE, PlaybackRules.toggleAllAction(slots, LayoutId.GRID2, statuses))
        // 在播放的格子不在目前的版型裡 → 不算
        statuses[slots[3]!!.id] = PlayStatus.PAUSED
        statuses[slots[5]!!.id] = PlayStatus.PLAYING
        assertEquals(PlaybackRules.ToggleAction.PLAY, PlaybackRules.toggleAllAction(slots, LayoutId.GRID2, statuses))
    }
}
