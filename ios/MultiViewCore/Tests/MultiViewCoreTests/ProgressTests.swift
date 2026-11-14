import XCTest
@testable import MultiViewCore

/// 進度條（R19）、快轉倒轉（R51）、記住觀看進度（R55）、全部播放／暫停（R8、R9）。
final class ProgressTests: XCTestCase {
    private func vod(_ current: Double, _ end: Double) -> PlaybackProgress {
        PlaybackProgress(current: current, start: 0, end: end, live: false)
    }

    func testVodView() {
        XCTAssertEqual(ProgressRules.view(vod(30, 120)), ProgressDisplay(kind: .vod, fraction: 0.25, atLive: false))
        XCTAssertEqual(ProgressRules.view(vod(500, 120)).fraction, 1)
        XCTAssertEqual(ProgressRules.view(vod(10, 0)).fraction, 0)
    }

    func testLiveView() {
        // 可回放範圍不到 60 秒：沒有進度條
        let short = PlaybackProgress(current: 100, start: 80, end: 110, live: true)
        XCTAssertEqual(ProgressRules.view(short), ProgressDisplay(kind: .live, fraction: 0, atLive: true))
        // 可回放的直播
        let dvr = PlaybackProgress(current: 400, start: 100, end: 700, live: true)
        XCTAssertEqual(ProgressRules.view(dvr), ProgressDisplay(kind: .dvr, fraction: 0.5, atLive: false))
        let edge = PlaybackProgress(current: 695, start: 100, end: 700, live: true)
        XCTAssertTrue(ProgressRules.view(edge).atLive)
    }

    func testSeekTarget() {
        XCTAssertEqual(ProgressRules.seekTarget(vod(0, 200), fraction: 0.5), 100)
        XCTAssertEqual(ProgressRules.seekTarget(vod(0, 200), fraction: 2), 200)
        XCTAssertEqual(ProgressRules.seekTarget(PlaybackProgress(current: 0, start: 100, end: 700, live: true), fraction: 0.5), 400)
        XCTAssertEqual(ProgressRules.seekTarget(vod(0, 200), fraction: .nan), 0)
    }

    func testSkipTarget() {
        XCTAssertEqual(ProgressRules.skipTarget(vod(30, 120), seconds: 10), 40)
        XCTAssertEqual(ProgressRules.skipTarget(vod(3, 120), seconds: -10), 0)
        XCTAssertEqual(ProgressRules.skipTarget(vod(115, 120), seconds: 10), 120)
        // 沒有回放範圍的直播不能快轉
        XCTAssertNil(ProgressRules.skipTarget(PlaybackProgress(current: 100, start: 80, end: 110, live: true), seconds: 10))
        // 可回放的直播限制在回放範圍內
        XCTAssertEqual(ProgressRules.skipTarget(PlaybackProgress(current: 105, start: 100, end: 700, live: true), seconds: -10), 100)
    }

    func testResumePosition() {
        XCTAssertEqual(ProgressRules.resumePosition(vod(180.04, 600)), 180)
        XCTAssertEqual(ProgressRules.resumePosition(vod(180.26, 600)), 180.3)
        XCTAssertNil(ProgressRules.resumePosition(nil))
        XCTAssertNil(ProgressRules.resumePosition(vod(3, 600))) // 還不到 5 秒
        XCTAssertNil(ProgressRules.resumePosition(vod(597, 600))) // 距離結尾不到 5 秒
        XCTAssertNil(ProgressRules.resumePosition(vod(180, 600), ended: true))
        XCTAssertNil(ProgressRules.resumePosition(PlaybackProgress(current: 400, start: 100, end: 700, live: true)))
    }

    func testFormatTime() {
        XCTAssertEqual(ProgressRules.formatTime(0), "0:00")
        XCTAssertEqual(ProgressRules.formatTime(65.9), "1:05")
        XCTAssertEqual(ProgressRules.formatTime(3600), "1:00:00")
        XCTAssertEqual(ProgressRules.formatTime(3725), "1:02:05")
        XCTAssertEqual(ProgressRules.formatTime(-5), "0:00")
        XCTAssertEqual(ProgressRules.formatTime(.nan), "0:00")
        XCTAssertEqual(ProgressRules.formatBehind(83), "-1:23")
    }

    func testFromMedia() {
        // 還沒載入
        XCTAssertNil(ProgressRules.fromMedia(MediaInfo(duration: .nan, currentTime: 0)))
        XCTAssertNil(ProgressRules.fromMedia(MediaInfo(duration: 0, currentTime: 0)))
        // 一般影片
        XCTAssertEqual(ProgressRules.fromMedia(MediaInfo(duration: 120, currentTime: 30)), vod(30, 120))
        // 直播：長度無限大或極大
        XCTAssertEqual(
            ProgressRules.fromMedia(MediaInfo(duration: .infinity, currentTime: 500, seekable: [100...300, 300...700])),
            PlaybackProgress(current: 500, start: 100, end: 700, live: true)
        )
        XCTAssertEqual(
            ProgressRules.fromMedia(MediaInfo(duration: 9_999_999, currentTime: 50)),
            PlaybackProgress(current: 50, start: 50, end: 50, live: true)
        )
        // 已知是直播時不看長度
        XCTAssertEqual(
            ProgressRules.fromMedia(MediaInfo(duration: .nan, currentTime: 5, seekable: [0...90], live: true)),
            PlaybackProgress(current: 5, start: 0, end: 90, live: true)
        )
        XCTAssertEqual(ProgressRules.fromMedia(MediaInfo(duration: 120, currentTime: 30, live: false)), vod(30, 120))
    }

    // MARK: 全部播放／暫停（R8、R9）

    private func slots(count: Int) -> Slots {
        var slots = SlotRules.empty()
        for index in 0..<count {
            let url = "https://example.com/\(index).mp4"
            slots[index] = CellSource(url: url, parsed: .mp4(url: url))
        }
        return slots
    }

    func testPlayStatusShowsPause() {
        XCTAssertTrue(PlayStatus.playing.showsPause)
        XCTAssertTrue(PlayStatus.loading.showsPause)
        XCTAssertFalse(PlayStatus.paused.showsPause)
        XCTAssertFalse(PlayStatus.ended.showsPause)
        XCTAssertFalse(PlayStatus.error.showsPause)
    }

    func testControllableIndices() {
        let slots = self.slots(count: 6)
        var statuses: [Int: PlayStatus] = [:]
        statuses[slots[1]!.id] = .error
        // 2×2 只有前 4 格顯示中；錯誤狀態的不算
        XCTAssertEqual(PlaybackRules.controllableIndices(slots, layout: .grid2, statuses: statuses), [0, 2, 3])
        // 單格全螢幕只有放大的那一格
        XCTAssertEqual(PlaybackRules.controllableIndices(slots, layout: .grid2, statuses: statuses, solo: 2), [2])
    }

    func testToggleAllAction() {
        let slots = self.slots(count: 6)
        var statuses: [Int: PlayStatus] = [:]
        XCTAssertEqual(PlaybackRules.toggleAllAction(slots, layout: .grid2, statuses: statuses), .play)
        statuses[slots[0]!.id] = .paused
        XCTAssertEqual(PlaybackRules.toggleAllAction(slots, layout: .grid2, statuses: statuses), .play)
        statuses[slots[3]!.id] = .playing
        XCTAssertEqual(PlaybackRules.toggleAllAction(slots, layout: .grid2, statuses: statuses), .pause)
        // 在播放的格子不在目前的版型裡 → 不算
        statuses[slots[3]!.id] = .paused
        statuses[slots[5]!.id] = .playing
        XCTAssertEqual(PlaybackRules.toggleAllAction(slots, layout: .grid2, statuses: statuses), .play)
    }
}
