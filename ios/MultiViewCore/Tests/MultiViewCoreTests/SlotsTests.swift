import XCTest
@testable import MultiViewCore

/// 格位（R4、R6）、聲音規則（R7、R8、R128）、亮度（R130）、音量、畫質。
final class SlotsTests: XCTestCase {
    private func source(_ name: String, muted: Bool = false, volume: Int = 100) -> CellSource {
        let url = "https://example.com/\(name).mp4"
        return CellSource(url: url, parsed: .mp4(url: url), muted: muted, volume: volume)
    }

    private func slots(_ sources: CellSource?...) -> Slots {
        var slots = SlotRules.empty()
        for (index, source) in sources.enumerated() {
            slots[index] = source
        }
        return slots
    }

    func testSourceIDsAreUnique() {
        let ids = (0..<50).map { _ in SourceID.next() }
        XCTAssertEqual(Set(ids).count, 50)
        XCTAssertNotEqual(source("a").id, source("a").id)
    }

    func testEmptySlots() {
        XCTAssertEqual(SlotRules.empty().count, 9)
        XCTAssertTrue(SlotRules.empty().allSatisfy { $0 == nil })
    }

    func testVisibility() {
        XCTAssertTrue(SlotRules.isVisible(3, layout: .grid2))
        XCTAssertFalse(SlotRules.isVisible(4, layout: .grid2))
        XCTAssertTrue(SlotRules.isVisible(8, layout: .grid3))
        XCTAssertFalse(SlotRules.isVisible(1, layout: .one))
        // 單格全螢幕：只有放大的那一格顯示中（R20）
        XCTAssertTrue(SlotRules.isVisible(2, layout: .grid2, solo: 2))
        XCTAssertFalse(SlotRules.isVisible(0, layout: .grid2, solo: 2))
    }

    func testSetAndSwap() {
        let a = source("a")
        let b = source("b")
        var slots = SlotRules.set(SlotRules.empty(), 0, a)
        slots = SlotRules.set(slots, 3, b)
        XCTAssertEqual(slots[0], a)
        XCTAssertEqual(slots[3], b)

        // 兩格互換，id 不變（不重新載入，R6 AC1）
        let swapped = SlotRules.swap(slots, 0, 3)
        XCTAssertEqual(swapped[0]?.id, b.id)
        XCTAssertEqual(swapped[3]?.id, a.id)

        // 拖到空白格：來源移過去，原本的格子變成空白（R6 AC2）
        let moved = SlotRules.swap(slots, 0, 1)
        XCTAssertNil(moved[0])
        XCTAssertEqual(moved[1], a)

        // 放開在原本的格子、不存在的格位：沒有變化（R6 AC3）
        XCTAssertEqual(SlotRules.swap(slots, 3, 3), slots)
        XCTAssertEqual(SlotRules.swap(slots, 0, 9), slots)
        XCTAssertEqual(SlotRules.set(slots, 9, a), slots)
    }

    func testRemovingDoesNotShiftOthers() {
        let slots = self.slots(source("a"), source("b"), source("c"))
        let next = SlotRules.set(slots, 1, nil)
        XCTAssertEqual(next[0], slots[0])
        XCTAssertNil(next[1])
        XCTAssertEqual(next[2], slots[2])
    }

    func testHiddenCount() {
        let slots = self.slots(source("a"), nil, source("c"), source("d"), source("e"), nil, source("g"))
        XCTAssertEqual(SlotRules.hiddenCount(slots, layout: .grid3), 0)
        XCTAssertEqual(SlotRules.hiddenCount(slots, layout: .grid2), 2)
        XCTAssertEqual(SlotRules.hiddenCount(slots, layout: .two), 4)
        XCTAssertEqual(SlotRules.hiddenCount(slots, layout: .one), 4)
    }

    func testFirstEmptyVisible() {
        let slots = self.slots(source("a"), source("b"))
        XCTAssertEqual(SlotRules.firstEmptyVisible(slots, layout: .grid2), 2)
        XCTAssertNil(SlotRules.firstEmptyVisible(slots, layout: .two))
        XCTAssertNil(SlotRules.firstEmptyVisible(slots, layout: .grid2, solo: 0))
        XCTAssertEqual(SlotRules.firstEmptyVisible(SlotRules.empty(), layout: .one), 0)
    }

    // MARK: 聲音（R7、R8）

    func testInitialMuted() {
        // 沒有任何顯示中的來源有聲音 → 新來源有聲音（R7 AC1）
        XCTAssertFalse(AudioRules.initialMuted(SlotRules.empty(), layout: .grid2))
        XCTAssertFalse(AudioRules.initialMuted(slots(source("a", muted: true)), layout: .grid2))
        XCTAssertFalse(AudioRules.initialMuted(slots(source("a", volume: 0)), layout: .grid2))
        XCTAssertTrue(AudioRules.initialMuted(slots(source("a")), layout: .grid2))
        // 有聲音的來源不在目前的版型裡 → 不算
        let hidden = slots(nil, nil, nil, nil, source("e"))
        XCTAssertFalse(AudioRules.initialMuted(hidden, layout: .grid2))
        XCTAssertTrue(AudioRules.initialMuted(hidden, layout: .grid3))
    }

    func testFocusAudio() {
        // 格子 1、2 都有聲音，點格子 3 → 只有格子 3 有聲音（R7 AC2）
        let slots = self.slots(source("a"), source("b"), source("c", muted: true))
        let next = AudioRules.focus(slots, 2)
        XCTAssertEqual(next.prefix(3).map { $0?.muted }, [true, true, false])
        // 點空白格不影響聲音
        XCTAssertEqual(AudioRules.focus(slots, 5), slots)
        XCTAssertEqual(AudioRules.focus(slots, 20), slots)
    }

    func testToggleMute() {
        // 只有格子 1 有聲音，按格子 2 的喇叭 → 1、2 都有聲音（R7 AC3）
        let slots = self.slots(source("a"), source("b", muted: true))
        let next = AudioRules.toggleMute(slots, 1)
        XCTAssertEqual(next.prefix(2).map { $0?.muted }, [false, false])
        XCTAssertEqual(AudioRules.toggleMute(next, 1).prefix(2).map { $0?.muted }, [false, true])
    }

    func testSetVolume() {
        let slots = self.slots(source("a"), source("b"))
        let next = AudioRules.setVolume(slots, 1, 40)
        XCTAssertEqual(next.prefix(2).map { $0?.volume }, [100, 40])
        // iOS 版最高 100%
        XCTAssertEqual(AudioRules.setVolume(slots, 0, 150)[0]?.volume, 100)
        XCTAssertEqual(AudioRules.setVolume(slots, 0, -5)[0]?.volume, 0)
        XCTAssertEqual(AudioRules.setVolume(slots, 0, 33.6)[0]?.volume, 34)
    }

    func testMuteAllKeepsVolumes() {
        let slots = self.slots(source("a", volume: 30), source("b", muted: true, volume: 80))
        let next = AudioRules.muteAll(slots)
        XCTAssertEqual(next.prefix(2).map { $0?.muted }, [true, true])
        XCTAssertEqual(next.prefix(2).map { $0?.volume }, [30, 80])
    }

    func testIsAudible() {
        XCTAssertTrue(source("a").isAudible)
        XCTAssertFalse(source("a", muted: true).isAudible)
        XCTAssertFalse(source("a", volume: 0).isAudible)
    }

    // MARK: 亮度、音量、畫質

    func testBrightnessNormalize() {
        XCTAssertEqual(Brightness.normalize(nil), 100)
        XCTAssertEqual(Brightness.normalize("50"), 100)
        XCTAssertEqual(Brightness.normalize(50), 50)
        XCTAssertEqual(Brightness.normalize(52), 50)
        XCTAssertEqual(Brightness.normalize(53), 55)
        XCTAssertEqual(Brightness.normalize(5), 20)
        XCTAssertEqual(Brightness.normalize(150), 100) // 桌面版最高 150，iOS 版最高 100
        XCTAssertEqual(Brightness.normalize(true), 100)
    }

    func testEffectiveBrightness() {
        // 總亮度 80%、某一格 50% → 40%（R130 AC2）
        XCTAssertEqual(Brightness.effective(cell: 50, master: 80), 40)
        XCTAssertEqual(Brightness.dimOpacity(cell: 50, master: 80), 0.6, accuracy: 1e-9)
        XCTAssertEqual(Brightness.dimOpacity(cell: 100, master: 100), 0)
    }

    func testVolumeNormalize() {
        XCTAssertEqual(Volume.normalize(nil), 100)
        XCTAssertEqual(Volume.normalize("40"), 100)
        XCTAssertEqual(Volume.normalize(40), 40)
        XCTAssertEqual(Volume.normalize(40.5), 41)
        XCTAssertEqual(Volume.normalize(-3), 0)
        XCTAssertEqual(Volume.normalize(200), 100)
        XCTAssertEqual(Volume.fraction(40), 0.4, accuracy: 1e-9)
        XCTAssertEqual(Volume.fraction(100), 1)
    }

    func testQualityNormalize() {
        XCTAssertEqual(Quality.normalize("auto"), .auto)
        XCTAssertEqual(Quality.normalize(nil), .auto)
        XCTAssertEqual(Quality.normalize("high"), .height(1080))
        XCTAssertEqual(Quality.normalize(720), .height(720))
        XCTAssertEqual(Quality.normalize(50), .auto)
        XCTAssertEqual(Quality.normalize(20000), .auto)
        XCTAssertEqual(Quality.normalize(720.5), .auto)
        XCTAssertEqual(Quality.auto.label, "自動")
        XCTAssertEqual(Quality.height(1080).label, "1080p")
    }
}
