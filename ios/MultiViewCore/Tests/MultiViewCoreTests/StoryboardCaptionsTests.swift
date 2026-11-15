import XCTest
@testable import MultiViewCore

/// 預覽縮圖（R50，照搬桌面版 tests/unit/storyboard.test.ts）與字幕（R31 的規則、WebVTT）。
/// 對照 Android 版 android/core/src/test/kotlin/local/multiview/core/StoryboardCaptionsTest.kt。
final class StoryboardCaptionsTests: XCTestCase {
    private let base = "https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L$L/$N.jpg?sqp=abc"
    private var spec: String {
        "\(base)|48#27#100#10#10#0#default#rs$AAA|60#45#122#10#10#10000#M$M#rs$BBB|120#90#122#5#5#10000#M$M#rs$CCC"
    }

    func testExtractSpec() {
        let html = #"...,"playerStoryboardSpecRenderer":{"spec":"https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg?sqp=a&b=1|48#27#100#10#10#0#default#rs$A"},..."#
        XCTAssertEqual(
            StoryboardRules.extractSpec(html),
            "https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg?sqp=a&b=1|48#27#100#10#10#0#default#rs$A"
        )
        XCTAssertNil(StoryboardRules.extractSpec(#""playerLiveStoryboardSpecRenderer":{"spec":"x"}"#))
        XCTAssertNil(StoryboardRules.extractSpec("<html></html>"))
    }

    func testParse() throws {
        let storyboard = try XCTUnwrap(StoryboardRules.parse(spec))
        XCTAssertEqual(storyboard.level, 2)
        XCTAssertEqual(
            storyboard.info,
            StoryboardLevel(width: 120, height: 90, count: 122, cols: 5, rows: 5, intervalMs: 10000, name: "M$M", sigh: "rs$CCC")
        )
        // 寬度超過 320 的等級不用
        XCTAssertEqual(StoryboardRules.parse(spec + "|640#360#122#3#3#10000#M$M#rs$DDD")?.level, 2)
        XCTAssertNil(StoryboardRules.parse(""))
        XCTAssertNil(StoryboardRules.parse("not a url|1#2"))
        // 間隔是 0 的等級（影片封面）不能用
        XCTAssertNil(StoryboardRules.parse("\(base)|48#27#100#10#10#0#default#rs$AAA"))
    }

    func testFrame() throws {
        let storyboard = try XCTUnwrap(StoryboardRules.parse(spec))
        let first = StoryboardRules.frame(storyboard, seconds: 0, duration: 1204)
        XCTAssertEqual(first.url, "https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L2/M0.jpg?sqp=abc&sigh=rs$CCC")
        XCTAssertEqual([first.x, first.y, first.width, first.height], [0, 0, 120, 90])
        let middle = StoryboardRules.frame(storyboard, seconds: 362, duration: 1204)
        XCTAssertTrue(middle.url.contains("/storyboard3_L2/M1.jpg"))
        XCTAssertEqual([middle.x, middle.y], [120, 180])
        let last = StoryboardRules.frame(storyboard, seconds: 99999, duration: 1204)
        XCTAssertTrue(last.url.contains("/M4.jpg"))
        XCTAssertEqual([last.x, last.y], [0, 360])
        XCTAssertTrue(StoryboardRules.frame(storyboard, seconds: 5000, duration: 5000).url.contains("/M4.jpg"))
        let before = StoryboardRules.frame(storyboard, seconds: -5, duration: 100)
        XCTAssertEqual([before.x, before.y], [0, 0])
        // 長度不明時不會當掉，用最後一張
        XCTAssertTrue(StoryboardRules.frame(storyboard, seconds: .infinity, duration: .infinity).url.contains("/M4.jpg"))
    }

    private func track(_ key: String) -> CaptionTrack {
        let auto = key.hasPrefix("asr:")
        return CaptionTrack(key: key, languageCode: auto ? String(key.dropFirst(4)) : key, label: key, auto: auto, url: "https://x/\(key).vtt")
    }

    func testFromYtDlpAndFind() {
        let raw = JSON.parse("""
        [{"lang":"zh-Hant","name":"Chinese","url":"https://a","auto":false},
         {"lang":"en","name":"English","url":"https://b","auto":true},
         {"lang":"zh-Hant","url":"https://c","auto":false},{"lang":"","url":"https://d"}]
        """)
        let tracks = CaptionRules.fromYtDlp(raw)
        XCTAssertEqual(tracks.map(\.key), ["zh-Hant", "asr:en"])
        XCTAssertEqual(tracks.map(\.url), ["https://a", "https://b"])
        XCTAssertTrue(tracks[1].label.hasSuffix("（自動產生）"))
        XCTAssertFalse(tracks[0].label.contains("（自動產生）"))
        XCTAssertEqual(CaptionRules.fromYtDlp(nil), [])

        let list = [track("asr:en"), track("en"), track("ja")]
        XCTAssertEqual(CaptionRules.find(list, key: "asr:en")?.key, "asr:en")
        // 同一種語言優先人工字幕
        XCTAssertEqual(CaptionRules.find([track("asr:en"), track("en")], key: "en")?.key, "en")
        XCTAssertEqual(CaptionRules.find([track("asr:en"), track("ja")], key: "en")?.key, "asr:en")
        XCTAssertEqual(CaptionRules.find([track("ja"), track("en")], key: "asr:en")?.key, "en")
        XCTAssertNil(CaptionRules.find(list, key: "fr"))
        XCTAssertNil(CaptionRules.find(list, key: nil))
        XCTAssertNil(CaptionRules.find(list, key: ""))
    }

    func testParseVtt() {
        let vtt = """
        WEBVTT
        Kind: captions

        00:00:01.000 --> 00:00:03.500 align:start position:0%
        Hello &amp; <c.colorE5E5E5>world</c>

        00:00:03.500 --> 00:00:03.510
        Hello & world

        00:00:03.510 --> 00:00:06.000
        Hello & world
        second<00:00:04.000><c> line</c>

        1:00:00.000 --> 1:00:02.000
        late

        """
        let cues = CaptionRules.parseVtt(vtt)
        XCTAssertEqual(cues.count, 3)
        XCTAssertEqual(cues.first, Cue(start: 1, end: 3.5, text: "Hello & world"))
        // 捲動的兩行：上一段的那一行不重複顯示
        XCTAssertEqual(cues.count > 1 ? cues[1] : nil, Cue(start: 3.51, end: 6, text: "second line"))
        XCTAssertEqual(cues.last?.start, 3600)
        XCTAssertEqual(CaptionRules.cueAt(cues, seconds: 2), "Hello & world")
        XCTAssertNil(CaptionRules.cueAt(cues, seconds: 7))
        // Windows 換行、逗號的小數點
        let crlf = CaptionRules.parseVtt("WEBVTT\r\n\r\n00:01,500 --> 00:02,000\r\n一\r\n")
        XCTAssertEqual(crlf, [Cue(start: 1.5, end: 2, text: "一")])
    }
}
