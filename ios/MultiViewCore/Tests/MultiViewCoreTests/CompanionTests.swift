import XCTest
@testable import MultiViewCore

/// YouTube 小視窗的連結處理（R79、R80、R140）。
final class CompanionTests: XCTestCase {
    private let id = "jfKfPfyJRdk"

    func testParseTime() {
        XCTAssertEqual(CompanionRules.parseTime("195"), 195)
        XCTAssertEqual(CompanionRules.parseTime("195s"), 195)
        XCTAssertEqual(CompanionRules.parseTime("3m15s"), 195)
        XCTAssertEqual(CompanionRules.parseTime("1h2m3s"), 3723)
        XCTAssertEqual(CompanionRules.parseTime("2m"), 120)
        XCTAssertEqual(CompanionRules.parseTime(" 1H "), 3600)
        XCTAssertNil(CompanionRules.parseTime(nil))
        XCTAssertNil(CompanionRules.parseTime(""))
        XCTAssertNil(CompanionRules.parseTime("abc"))
        XCTAssertNil(CompanionRules.parseTime("3s2m")) // 順序不對
        XCTAssertNil(CompanionRules.parseTime("1m2"))
        XCTAssertNil(CompanionRules.parseTime("m"))
    }

    func testLinkAction() {
        // 其他影片 → 播放
        XCTAssertEqual(
            CompanionRules.linkAction(href: "https://www.youtube.com/watch?v=aaaaaaaaaaa&pp=xyz", currentVideoID: id),
            .play(url: "https://www.youtube.com/watch?v=aaaaaaaaaaa")
        )
        XCTAssertEqual(
            CompanionRules.linkAction(href: "https://youtu.be/aaaaaaaaaaa", currentVideoID: nil),
            .play(url: "https://www.youtube.com/watch?v=aaaaaaaaaaa")
        )
        // 同一部影片帶時間 → 跳到那個時間（留言裡的時間連結）
        XCTAssertEqual(
            CompanionRules.linkAction(href: "https://www.youtube.com/watch?v=\(id)&t=3m15s", currentVideoID: id),
            .seek(seconds: 195)
        )
        // 同一部影片不帶時間 → 不做事
        XCTAssertNil(CompanionRules.linkAction(href: "https://www.youtube.com/watch?v=\(id)", currentVideoID: id))
        // 不是影片
        XCTAssertNil(CompanionRules.linkAction(href: "https://www.youtube.com/@channel", currentVideoID: id))
        XCTAssertNil(CompanionRules.linkAction(href: "https://example.com/", currentVideoID: id))
    }

    func testHeaderAndURLs() {
        XCTAssertEqual(CompanionRules.header(cell: 1, title: "標題"), "第 2 格：標題")
        XCTAssertEqual(CompanionRules.header(cell: 0, title: nil), "第 1 格")
        XCTAssertTrue(CompanionRules.header(cell: nil, title: "x").contains("點一下"))
        XCTAssertEqual(CompanionRules.liveChatURL(videoID: id), "https://www.youtube.com/live_chat?v=\(id)&is_popout=1")
        XCTAssertEqual(CompanionTab.allCases.map(\.label), ["搜尋", "推薦", "留言", "聊天室"])
    }
}
