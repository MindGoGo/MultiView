import XCTest
@testable import MultiViewCore

/// yt-dlp 播放的聲音軌（R95、R135）。照搬桌面版 tests/unit/audio-tracks.test.ts。
final class AudioTracksTests: XCTestCase {
    private let tracks = [
        RawAudioTrack(lang: "en-US", name: "American English - dubbed-auto"),
        RawAudioTrack(lang: "zh-Hant", name: "zh-Hant - original"),
    ]
    private var bothGroups: [RawAudioTrack] { tracks + tracks }

    func testAudioKind() {
        XCTAssertEqual(AudioTrackRules.audioKind("zh-Hant - original"), .original)
        XCTAssertEqual(AudioTrackRules.audioKind("American English - dubbed-auto"), .dubbedAuto)
        XCTAssertEqual(AudioTrackRules.audioKind("日本語 - dubbed"), .dubbed)
        XCTAssertEqual(AudioTrackRules.audioKind("English - Original"), .original)
        XCTAssertNil(AudioTrackRules.audioKind("Default"))
        XCTAssertNil(AudioTrackRules.audioKind("English - originals"))
    }

    func testLangKey() {
        let cases: [(String, String)] = [
            ("zh-TW", "zh-hant"), ("zh-HK", "zh-hant"), ("zh-Hant", "zh-hant"), ("zh-Hant-TW", "zh-hant"),
            ("zh-CN", "zh-hans"), ("zh-Hans", "zh-hans"), ("zh", "zh"), ("en-US", "en"), ("en-GB", "en"),
        ]
        for (lang, key) in cases {
            XCTAssertEqual(AudioTrackRules.langKey(lang), key, lang)
        }
        XCTAssertEqual(AudioTrackRules.langKey(nil), "")
    }

    func testPick() {
        // 系統是繁體中文 → 中文原聲，不是排在前面的英文配音
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: nil, system: "zh-TW"), 1)
        // iOS 的系統語言寫成 zh-Hant-TW
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: nil, system: "zh-Hant-TW"), 1)
        // 記住的語言優先於系統語言
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: "en-US", system: "zh-TW"), 0)
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: "en-GB", system: "zh-TW"), 0)
        // 記住的語言影片沒有 → 系統語言 → 原本的聲音
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: "ja", system: "zh-TW"), 1)
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: "ja", system: "ko-KR"), 1)
        XCTAssertEqual(AudioTrackRules.pick(tracks, saved: nil, system: "en-US"), 0)

        let zh = [
            RawAudioTrack(lang: "zh-Hans", name: "zh-Hans - dubbed-auto"),
            RawAudioTrack(lang: "ja", name: "ja - original"),
            RawAudioTrack(lang: "zh-Hant", name: "zh-Hant - dubbed-auto"),
        ]
        XCTAssertEqual(AudioTrackRules.pick(zh, saved: nil, system: "zh-CN"), 0)
        XCTAssertEqual(AudioTrackRules.pick(zh, saved: nil, system: "zh-TW"), 2)
        XCTAssertEqual(AudioTrackRules.pick(zh, saved: nil, system: "fr-FR"), 1)

        let en = [RawAudioTrack(lang: "en-US", name: "English - dubbed"), RawAudioTrack(lang: "en", name: "English - original")]
        XCTAssertEqual(AudioTrackRules.pick(en, saved: nil, system: "en-US"), 1)

        XCTAssertEqual(AudioTrackRules.pick([RawAudioTrack(lang: "ja", name: "a"), RawAudioTrack(lang: "ko", name: "b")], saved: nil, system: "zh-TW"), 0)
        XCTAssertEqual(AudioTrackRules.pick([], saved: nil, system: "zh-TW"), -1)
    }

    func testOptions() {
        let options = AudioTrackRules.options(bothGroups)
        XCTAssertEqual(options.map(\.index), [0, 1])
        XCTAssertEqual(options[0].kind, .dubbedAuto)
        XCTAssertTrue(options[0].label.hasSuffix("（AI 配音）"))
        XCTAssertTrue(options[1].label.hasSuffix("（原本的聲音）"))
        XCTAssertEqual(AudioTrackRules.currentOption(bothGroups, options, current: 3), 1)
        XCTAssertEqual(AudioTrackRules.currentOption(bothGroups, options, current: 0), 0)
        XCTAssertEqual(AudioTrackRules.currentOption(bothGroups, options, current: 9), -1)
        // 沒有語言時顯示「未知語言」
        XCTAssertEqual(AudioTrackRules.options([RawAudioTrack(lang: nil, name: "Default")]).first?.label, "未知語言")
    }
}
