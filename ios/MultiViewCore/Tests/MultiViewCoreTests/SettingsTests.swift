import XCTest
@testable import MultiViewCore

/// 設定檔驗證與讀寫（R10、R134）、匯入桌面版設定（R144）。測試案例沿用桌面版 tests/unit/settings.test.ts。
final class SettingsTests: XCTestCase {
    private let yt = "https://www.youtube.com/watch?v=jfKfPfyJRdk"
    private let web = "https://www.twitch.tv/somechannel"

    /// 只有 slots 欄位的設定內容。
    private func view(slots: [[String: Any]]) -> Settings {
        SettingsCodec.normalizeView(["slots": slots])
    }

    func testDefaults() {
        let settings = Settings()
        XCTAssertEqual(settings.layout, .grid2)
        XCTAssertEqual(settings.slots.count, 9)
        XCTAssertTrue(settings.slots.allSatisfy { $0 == nil })
        XCTAssertEqual(settings.brightness, 100)
        XCTAssertEqual(settings.youtubeMethods, YouTubeMethods(live: .embed, vod: .embed))
        XCTAssertEqual(settings.webMethod, .web)
        XCTAssertEqual(settings.listTab, ListTab(group: .youtube, tab: .favorites))
        XCTAssertEqual(settings.ratios(for: .grid2), Ratios(cols: [0.5, 0.5], rows: [0.5, 0.5]))
    }

    func testRoundTrip() {
        var settings = Settings()
        settings.layout = .grid3
        settings.ratios = [.two: Ratios(cols: [0.7, 0.3], rows: [1])]
        settings.slots[0] = SavedSource(url: yt, muted: false, volume: 40)
        settings.slots[4] = SavedSource(
            url: web, muted: true, volume: 30, adblock: false, quality: .height(720), captions: "zh-TW",
            audioLang: "ja", brightness: 60, youtubeWeb: false, position: 183.5,
            backURL: "https://www.youtube.com/@somechannel", pageAdblock: false
        )
        settings.brightness = 80
        settings.autoYoutubeWeb = true
        settings.youtubeMethods = YouTubeMethods(live: .ytdlp, vod: .embed)
        settings.webMethod = .ytdlp
        settings.listTab = ListTab(group: .other, tab: .history)

        let result = SettingsCodec.parse(SettingsCodec.encode(settings))
        XCTAssertFalse(result.corrupt)
        XCTAssertEqual(result.settings, settings)
    }

    func testBrokenJSONIsCorrupt() {
        let result = SettingsCodec.parse("{ not json")
        XCTAssertTrue(result.corrupt)
        XCTAssertEqual(result.settings, Settings())
    }

    func testWrongStructureIsCorrupt() {
        XCTAssertTrue(SettingsCodec.parse("[]").corrupt)
        XCTAssertTrue(SettingsCodec.parse("null").corrupt)
        XCTAssertTrue(SettingsCodec.parse("{\"version\":2}").corrupt)
        XCTAssertTrue(SettingsCodec.parse("{\"version\":true}").corrupt)
        XCTAssertTrue(SettingsCodec.parse("隨便的文字").corrupt)
        XCTAssertFalse(SettingsCodec.parse("{\"version\":1}").corrupt)
    }

    func testInvalidFieldsAreReplacedIndividually() {
        let text = """
        {
          "version": 1,
          "window": { "width": "big", "height": 500, "x": 10 },
          "layout": "4x4",
          "ratios": {
            "2": { "cols": [0.9, 0.9], "rows": [1] },
            "2x2": { "cols": [0.6, 0.4], "rows": [0.5, 0.5] }
          },
          "slots": [
            { "url": "ftp://example.com/a.mp4", "muted": false },
            { "url": "\(yt)", "volume": 250 },
            "garbage"
          ]
        }
        """
        let result = SettingsCodec.parse(text)
        XCTAssertFalse(result.corrupt)
        let settings = result.settings
        XCTAssertEqual(settings.layout, .grid2)
        XCTAssertEqual(settings.ratios, [.grid2: Ratios(cols: [0.6, 0.4], rows: [0.5, 0.5])])
        XCTAssertNil(settings.slots[0]) // 不支援的網址
        // 桌面版音量可以到 200，iOS 版最高 100（R128、R144）
        XCTAssertEqual(settings.slots[1], SavedSource(url: yt, muted: false, volume: 100))
        XCTAssertNil(settings.slots[2])
        XCTAssertEqual(settings.slots.count, 9)
    }

    func testSlotsArePaddedOrTruncatedToNine() {
        XCTAssertEqual(SettingsCodec.normalizeView(["slots": [Any]()]).slots.count, 9)
        let many: [[String: Any]] = Array(repeating: ["url": yt], count: 20)
        let truncated = view(slots: many)
        XCTAssertEqual(truncated.slots.count, 9)
        XCTAssertTrue(truncated.slots.allSatisfy { $0?.url == yt })
        XCTAssertEqual(SettingsCodec.normalizeView(nil).layout, .grid2)
    }

    func testFirstVersionSettingsFile() {
        // 第一版的設定檔沒有 adblock 等欄位：廣告阻擋視為開啟（R12 AC7）
        let text = """
        {
          "version": 1,
          "window": { "width": 1280, "height": 720, "alwaysOnTop": false },
          "layout": "2x2",
          "ratios": {},
          "slots": [{ "url": "\(yt)", "muted": false, "volume": 40 }, null, null, null, null, null, null, null, null]
        }
        """
        let result = SettingsCodec.parse(text)
        XCTAssertFalse(result.corrupt)
        XCTAssertEqual(result.settings.layout, .grid2)
        XCTAssertEqual(result.settings.slots[0], SavedSource(
            url: yt, muted: false, volume: 40, adblock: true, quality: .auto, captions: nil, audioLang: nil,
            brightness: 100, youtubeWeb: false, position: nil, backURL: nil, pageAdblock: true
        ))
    }

    func testAdblockIsOffOnlyWhenExplicitlyFalse() {
        let result = view(slots: [
            ["url": web, "adblock": "no"],
            ["url": web, "adblock": 0],
            ["url": web, "adblock": false]
        ])
        XCTAssertEqual(result.slots.prefix(3).map { $0?.adblock }, [true, true, false])
    }

    func testMutedIsOnOnlyWhenExplicitlyTrue() {
        let result = view(slots: [
            ["url": web, "muted": 1],
            ["url": web, "muted": "true"],
            ["url": web, "muted": true]
        ])
        XCTAssertEqual(result.slots.prefix(3).map { $0?.muted }, [false, false, true])
    }

    func testSourceFieldNormalization() {
        let result = view(slots: [
            ["url": yt, "quality": "high", "captions": "", "position": -5, "backUrl": "https://example.com/"],
            ["url": yt, "quality": 720, "captions": "en", "position": 12.5, "backUrl": "https://www.youtube.com/"],
            ["url": yt, "quality": 720.5, "brightness": 130, "volume": true]
        ])
        XCTAssertEqual(result.slots[0]?.quality, .height(1080))
        XCTAssertNil(result.slots[0]?.captions)
        XCTAssertNil(result.slots[0]?.position)
        XCTAssertNil(result.slots[0]?.backURL) // 不是 YouTube 網站頁面
        XCTAssertEqual(result.slots[1]?.quality, .height(720))
        XCTAssertEqual(result.slots[1]?.captions, "en")
        XCTAssertEqual(result.slots[1]?.position, 12.5)
        XCTAssertEqual(result.slots[1]?.backURL, "https://www.youtube.com/")
        XCTAssertEqual(result.slots[2]?.quality, .auto)
        XCTAssertEqual(result.slots[2]?.brightness, 100) // 桌面版 130% → iOS 最高 100%
        XCTAssertEqual(result.slots[2]?.volume, 100) // true 不是數字
    }

    func testListTabNormalization() {
        func tab(_ group: Any, _ tab: Any) -> ListTab {
            SettingsCodec.normalizeView(["listTab": ["group": group, "tab": tab] as [String: Any]]).listTab
        }
        XCTAssertEqual(tab("other", "history"), ListTab(group: .other, tab: .history))
        XCTAssertEqual(tab("youtube", "subscriptions"), ListTab(group: .youtube, tab: .subscriptions))
        // 訂閱只在 YouTube 那一邊
        XCTAssertEqual(tab("other", "subscriptions"), ListTab())
        XCTAssertEqual(tab("x", "favorites"), ListTab())
        XCTAssertEqual(tab("youtube", 3), ListTab())
    }

    func testMethodsNormalization() {
        let raw: [String: Any] = ["youtubeMethods": ["live": "ytdlp", "vod": "other"], "webMethod": "ytdlp"]
        let view = SettingsCodec.normalizeView(raw)
        XCTAssertEqual(view.youtubeMethods, YouTubeMethods(live: .ytdlp, vod: .embed))
        XCTAssertTrue(view.youtubeMethods.needsResolve)
        XCTAssertEqual(view.webMethod, .ytdlp)
        XCTAssertFalse(YouTubeMethods().needsResolve)
    }

    func testEncodedFileHasDesktopFieldNames() {
        var settings = Settings()
        settings.slots[0] = SavedSource(url: yt, backURL: "https://www.youtube.com/")
        let text = SettingsCodec.encode(settings)
        XCTAssertTrue(text.contains("\"version\" : 1"))
        XCTAssertTrue(text.contains("\"backUrl\""))
        XCTAssertTrue(text.contains("\"pageAdblock\" : true"))
        XCTAssertTrue(text.contains("\"quality\" : \"auto\""))
        XCTAssertTrue(text.contains("\"captions\" : null"))
        // iOS 不用的欄位不寫入
        XCTAssertFalse(text.contains("\"window\""))
        XCTAssertFalse(text.contains("\"companion\""))
    }

    // MARK: 匯入桌面版設定（R144）

    func testImportDesktopSettingsClampsVolumeAndBrightness() {
        let text = """
        {
          "version": 1,
          "window": { "x": 100, "y": 50, "width": 1600, "height": 900, "alwaysOnTop": true },
          "companion": { "width": 480, "height": 760, "tab": "search", "pinned": false },
          "layout": "2x2",
          "ratios": {},
          "brightness": 120,
          "slots": [
            { "url": "\(yt)", "muted": false, "volume": 150, "brightness": 130, "position": 61 },
            null, null, null, null, null, null, null, null
          ]
        }
        """
        let result = SettingsCodec.parse(text)
        XCTAssertFalse(result.corrupt)
        XCTAssertEqual(result.settings.brightness, 100)
        XCTAssertEqual(result.settings.slots[0]?.volume, 100)
        XCTAssertEqual(result.settings.slots[0]?.brightness, 100)
        XCTAssertEqual(result.settings.slots[0]?.position, 61)
    }

    // MARK: 設定和格子之間的轉換（R134）

    func testRestoreSlotsStartsPaused() {
        var saved: [SavedSource?] = Array(repeating: nil, count: 9)
        saved[1] = SavedSource(url: yt, muted: true, volume: 40, brightness: 60, position: 180)
        let slots = SettingsBridge.restoreSlots(saved)
        XCTAssertEqual(slots.count, 9)
        XCTAssertNil(slots[0])
        let source = slots[1]
        XCTAssertEqual(source?.parsed, .youtube(videoID: "jfKfPfyJRdk"))
        XCTAssertEqual(source?.autoplay, false)
        XCTAssertEqual(source?.record, false)
        XCTAssertEqual(source?.muted, true)
        XCTAssertEqual(source?.volume, 40)
        XCTAssertEqual(source?.brightness, 60)
        XCTAssertEqual(source?.resume, 180)
    }

    func testRestoreSlotsUsesYouTubeWebPage() {
        let slots = SettingsBridge.restoreSlots([SavedSource(url: yt, youtubeWeb: true)])
        XCTAssertEqual(slots.count, 9)
        XCTAssertEqual(slots[0]?.url, yt)
        XCTAssertEqual(slots[0]?.parsed, .web(url: yt))
    }

    func testSaveSlotsKeepsPositions() {
        var slots = SlotRules.empty()
        slots[0] = CellSource(url: yt, parsed: .youtube(videoID: "jfKfPfyJRdk"), muted: true, volume: 55, brightness: 70)
        slots[2] = CellSource(url: web, parsed: .web(url: web), adblock: false)
        let saved = SettingsBridge.saveSlots(slots, positions: [0: 95.5, 2: 0, 5: 10])
        XCTAssertEqual(saved.count, 9)
        XCTAssertEqual(saved[0], SavedSource(url: yt, muted: true, volume: 55, brightness: 70, position: 95.5))
        XCTAssertEqual(saved[2], SavedSource(url: web, adblock: false))
        XCTAssertNil(saved[5])
    }
}
