import XCTest
@testable import MultiViewCore

/// SponsorBlock 的規則（R161）。案例照搬 Android 版 android/core/.../SponsorBlockTest.kt。
final class SponsorBlockTests: XCTestCase {
    private let sponsor = SponsorCategory.sponsor

    private func seg(_ start: Double, _ end: Double, _ id: String, _ category: SponsorCategory = .sponsor) -> SponsorSegment {
        SponsorSegment(start: start, end: end, category: category, id: id)
    }

    private func item(
        _ start: Any, _ end: Any, category: String = "sponsor", uuid: String = "u", action: String? = "skip"
    ) -> [String: Any] {
        var out: [String: Any] = [
            "segment": [start, end],
            "category": category,
            "UUID": uuid,
            "videoDuration": 600
        ]
        if let action { out["actionType"] = action }
        return out
    }

    private func response(_ videos: (String, [[String: Any]])...) -> String {
        let list: [[String: Any]] = videos.map { video in
            ["videoID": video.0, "hash": "x", "segments": video.1]
        }
        return JSON.encode(list)
    }

    func testHashPrefixIsFirstFourHexOfSha256() {
        // SHA-256("dQw4w9WgXcQ") = 5f6b0b4e…（用 sha256sum 算的）
        XCTAssertEqual(SponsorBlockRules.hashPrefix("dQw4w9WgXcQ"), "5f6b")
        // SHA-256("abc") = ba7816bf…
        XCTAssertEqual(SponsorBlockRules.hashPrefix("abc"), "ba78")
    }

    func testRequestURL() {
        XCTAssertEqual(
            SponsorBlockRules.requestURL("dQw4w9WgXcQ", categories: [sponsor]),
            "https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%5D"
        )
        // 順序固定（照類別的定義順序），不管傳進來的順序
        XCTAssertEqual(
            SponsorBlockRules.requestURL("dQw4w9WgXcQ", categories: [.intro, sponsor]),
            "https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%2C%22intro%22%5D"
        )
        // 預設要全部的類別
        let all = SponsorBlockRules.requestURL("dQw4w9WgXcQ")
        for category in SponsorCategory.allCases {
            XCTAssertTrue(all.contains("%22\(category.rawValue)%22"))
        }
        XCTAssertNotNil(URL(string: all))
    }

    func testParseKeepsOnlyThisVideoAndSkipSegments() {
        let text = response(
            ("other", [item(1, 50, uuid: "o1")]),
            ("vid", [
                item(30.5, 60.25, uuid: "a"),
                item(100, 120, category: "intro", uuid: "b"),
                item(200, 210, uuid: "c", action: "mute"),
                item(300, 300, category: "poi_highlight", uuid: "d", action: "poi"),
                item(0, 600, category: "sponsor", uuid: "e", action: "full"),
                item(400, 420, category: "exclusive_access", uuid: "f"),
                item(500, 490, uuid: "g"),
                item("x", 10, uuid: "h"),
                item(5, 15, uuid: "i", action: nil)
            ])
        )
        XCTAssertEqual(
            SponsorBlockRules.parse(text, videoID: "vid"),
            [seg(30.5, 60.25, "a"), seg(100, 120, "b", .intro), seg(5, 15, "i")]
        )
        XCTAssertEqual(SponsorBlockRules.parse(text, videoID: "missing"), [])
    }

    func testParseBadResponsesAreEmpty() {
        XCTAssertEqual(SponsorBlockRules.parse("", videoID: "vid"), [])
        XCTAssertEqual(SponsorBlockRules.parse("Not Found", videoID: "vid"), [])
        XCTAssertEqual(SponsorBlockRules.parse("{\"videoID\":\"vid\"}", videoID: "vid"), [])
        XCTAssertEqual(SponsorBlockRules.parse("[{\"videoID\":\"vid\",\"segments\":5}]", videoID: "vid"), [])
    }

    func testSelectFiltersSortsAndMerges() {
        let raw = [
            seg(100, 130, "late"),
            seg(10, 40, "first"),
            seg(35, 50, "overlap"),
            seg(50, 55, "touching"),
            seg(70, 70.5, "short"),
            seg(80, 90, "intro", .intro),
            seg(12, 20, "inside")
        ]
        // 預設只跳過業配：intro 不要；太短的不要；重疊、相接的合併，id 用最早開始的那一段
        XCTAssertEqual(
            SponsorBlockRules.select(raw, settings: SponsorBlockSettings()),
            [seg(10, 55, "first"), seg(100, 130, "late")]
        )
        XCTAssertEqual(
            SponsorBlockRules.select(raw, settings: SponsorBlockSettings(categories: [sponsor, .intro])),
            [seg(10, 55, "first"), seg(80, 90, "intro", .intro), seg(100, 130, "late")]
        )
        // 不同類別重疊也合併成一段（類別用最早開始的）
        XCTAssertEqual(
            SponsorBlockRules.select(
                [seg(20, 30, "b", .outro), seg(10, 25, "a")],
                settings: SponsorBlockSettings(categories: [sponsor, .outro])
            ),
            [seg(10, 30, "a")]
        )
        XCTAssertEqual(SponsorBlockRules.select(raw, settings: SponsorBlockSettings(enabled: false)), [])
        XCTAssertEqual(SponsorBlockRules.select(raw, settings: SponsorBlockSettings(categories: [])), [])
        // 剛好 1 秒的保留
        XCTAssertEqual(SponsorBlockRules.select([seg(5, 6, "x")], settings: SponsorBlockSettings()).count, 1)
    }

    func testCheckSkipsToSegmentEnd() {
        let segments = [seg(10, 40, "a"), seg(100, 130, "b")]
        let state = SkipState()
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 9.9, duration: 600))
        XCTAssertEqual(SponsorBlockRules.check(segments, state: state, time: 10, duration: 600), SkipAction(segment: segments[0], target: 40))
        XCTAssertEqual(SponsorBlockRules.check(segments, state: state, time: 25, duration: 600), SkipAction(segment: segments[0], target: 40))
        // 已經在結尾：不跳
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 39.8, duration: 600))
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 40, duration: 600))
        XCTAssertEqual(SponsorBlockRules.check(segments, state: state, time: 101, duration: 600), SkipAction(segment: segments[1], target: 130))
        // 不知道影片長度：照樣跳到片段結尾
        XCTAssertEqual(SponsorBlockRules.check(segments, state: state, time: 11, duration: .nan), SkipAction(segment: segments[0], target: 40))
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: .nan, duration: 600))
        XCTAssertNil(SponsorBlockRules.check([], state: state, time: 11, duration: 600))
    }

    func testSegmentEndingInLastSecondCountsAsFinished() {
        let outro = seg(570, 599.2, "end")
        XCTAssertEqual(SponsorBlockRules.check([outro], state: SkipState(), time: 580, duration: 600), SkipAction(segment: outro, target: 600))
        // 片段結尾超過影片長度也一樣
        let over = seg(570, 605, "over")
        XCTAssertEqual(SponsorBlockRules.check([over], state: SkipState(), time: 580, duration: 600), SkipAction(segment: over, target: 600))
        // 離結尾還有超過 1 秒：跳到片段結尾
        let before = seg(570, 598.5, "before")
        XCTAssertEqual(SponsorBlockRules.check([before], state: SkipState(), time: 580, duration: 600), SkipAction(segment: before, target: 598.5))
    }

    func testSkippedSegmentIsNotSkippedAgainWhenRewinding() throws {
        let segments = [seg(10, 40, "a")]
        let action = try XCTUnwrap(SponsorBlockRules.check(segments, state: SkipState(), time: 10.2, duration: 600))
        let state = SkipState().markHandled(action.segment)
        // 使用者倒回去看：不再跳
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 12, duration: 600))
        // 取消（跳回片段開頭）也一樣
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 10, duration: 600))
    }

    func testUserSeekIntoSegmentIsNotSkipped() {
        let segments = [seg(10, 40, "a"), seg(100, 130, "b")]
        // 拖曳到片段裡面：這個片段不跳
        let state = SkipState().userSeeked(segments, time: 20)
        XCTAssertEqual(state.handled, ["a"])
        XCTAssertNil(SponsorBlockRules.check(segments, state: state, time: 20.25, duration: 600))
        // 其他片段照樣跳
        XCTAssertEqual(SponsorBlockRules.check(segments, state: state, time: 100.1, duration: 600)?.segment.id, segments[1].id)
        // 跳到片段外面：不影響
        let outside = SkipState().userSeeked(segments, time: 50)
        XCTAssertEqual(outside, SkipState())
        // 跳到片段前面，播放進入片段：照樣跳
        let before = SkipState().userSeeked(segments, time: 5)
        XCTAssertEqual(SponsorBlockRules.check(segments, state: before, time: 10.1, duration: 600), SkipAction(segment: segments[0], target: 40))
    }

    func testCellsKeepSeparateStates() {
        let segments = [seg(10, 40, "a")]
        let cell1 = SkipState().markHandled(segments[0])
        let cell2 = SkipState()
        XCTAssertNil(SponsorBlockRules.check(segments, state: cell1, time: 12, duration: 600))
        XCTAssertEqual(SponsorBlockRules.check(segments, state: cell2, time: 12, duration: 600)?.target, 40)
    }

    func testLabelsAndSegmentAt() {
        XCTAssertEqual(SponsorBlockRules.skippedLabel(.sponsor), "已跳過業配")
        XCTAssertEqual(SponsorBlockRules.skippedLabel(.intro), "已跳過開場")
        let segments = [seg(10, 40, "a"), seg(100, 130, "b")]
        XCTAssertEqual(SponsorBlockRules.segment(at: 100, in: segments)?.id, "b")
        XCTAssertNil(SponsorBlockRules.segment(at: 40, in: segments))
        XCTAssertNil(SponsorBlockRules.segment(at: 5, in: segments))
    }

    func testMarks() {
        let segments = [seg(0, 60, "a"), seg(150, 300, "b", .outro), seg(310, 400, "c")]
        XCTAssertEqual(
            SponsorBlockRules.marks(segments, duration: 300),
            [SegmentMark(start: 0, end: 0.2, category: sponsor), SegmentMark(start: 0.5, end: 1, category: .outro)]
        )
        XCTAssertEqual(SponsorBlockRules.marks(segments, duration: .nan), [])
        XCTAssertEqual(SponsorBlockRules.marks(segments, duration: 0), [])
    }

    func testSettingsDefaultsAndNormalization() {
        XCTAssertEqual(SponsorBlockRules.normalizeSettings(nil), SponsorBlockSettings(enabled: true, categories: [sponsor]))
        XCTAssertEqual(SponsorBlockRules.normalizeSettings("x"), SponsorBlockSettings(enabled: true, categories: [sponsor]))
        XCTAssertEqual(
            SponsorBlockRules.normalizeSettings(JSON.parse(#"{"enabled": false, "categories": ["filler", "intro", "bogus", 3]}"#)),
            SponsorBlockSettings(enabled: false, categories: [.intro, .filler])
        )
        // 欄位不合法時各自用預設值；空的類別清單保留（使用者全部取消勾選）
        XCTAssertEqual(
            SponsorBlockRules.normalizeSettings(JSON.parse(#"{"enabled": "no", "categories": []}"#)),
            SponsorBlockSettings(enabled: true, categories: [])
        )
        // NSNumber 的 0、1 不是布林值
        XCTAssertEqual(SponsorBlockRules.normalizeSettings(JSON.parse(#"{"enabled": 0}"#)).enabled, true)
        XCTAssertTrue(SponsorBlockSettings().active)
        XCTAssertFalse(SponsorBlockSettings(categories: []).active)
    }

    func testSettingsFileRoundTrip() {
        var settings = Settings()
        settings.sponsorBlock = SponsorBlockSettings(enabled: false, categories: [.outro, sponsor])
        let text = SettingsCodec.encode(settings)
        XCTAssertTrue(text.contains("\"sponsorBlock\""))
        XCTAssertEqual(SettingsCodec.parse(text).settings.sponsorBlock, settings.sponsorBlock)
        XCTAssertEqual(SettingsCodec.parse(text).settings, settings)
        // 舊的設定檔沒有這個欄位：預設開啟、只跳過業配
        XCTAssertEqual(SettingsCodec.parse("{\"version\":1}").settings.sponsorBlock, SponsorBlockSettings())
        XCTAssertEqual(
            SponsorBlockRules.encodeSettings(settings.sponsorBlock)["categories"] as? [String],
            ["sponsor", "outro"]
        )
    }

    func testCategoryCodesMatchApi() {
        XCTAssertEqual(
            SponsorCategory.allCases.map(\.rawValue),
            ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler", "music_offtopic"]
        )
        XCTAssertNil(SponsorCategory(rawValue: "poi_highlight"))
    }
}
