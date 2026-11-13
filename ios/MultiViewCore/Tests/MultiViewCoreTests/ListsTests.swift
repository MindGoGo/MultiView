import XCTest
@testable import MultiViewCore

/// 最愛、歷史、訂閱（R21–R23、R58、R59、R141、R142）與匯入合併（R144）。
/// 測試案例沿用桌面版 tests/unit/lists.test.ts。
final class ListsTests: XCTestCase {
    private let yt = "https://www.youtube.com/watch?v=jfKfPfyJRdk"
    private let yt2 = "https://www.youtube.com/watch?v=aaaaaaaaaaa"
    private let mp4 = "https://example.com/videos/My%20Clip.mp4"
    private let web = "https://www.twitch.tv/somechannel"
    private let channelID = "UC" + String(repeating: "a", count: 22)

    private func lists(_ result: Result<Lists, ListError>, file: StaticString = #filePath, line: UInt = #line) -> Lists {
        switch result {
        case .success(let lists):
            return lists
        case .failure(let error):
            XCTFail("預期成功，但得到 \(error)", file: file, line: line)
            return Lists()
        }
    }

    private func error(_ result: Result<Lists, ListError>) -> ListError? {
        if case .failure(let error) = result { return error }
        return nil
    }

    // MARK: 網址比對與影片名稱

    func testSameURL() {
        XCTAssertTrue(ListRules.sameURL("  \(yt) ", yt))
        // 同一部影片的不同寫法視為不同
        XCTAssertFalse(ListRules.sameURL(yt, "https://youtu.be/jfKfPfyJRdk"))
    }

    func testDefaultName() {
        XCTAssertEqual(ListRules.defaultName(url: yt, title: "  直播標題 "), "直播標題")
        XCTAssertEqual(ListRules.defaultName(url: mp4, title: nil), "My Clip.mp4")
        XCTAssertEqual(ListRules.defaultName(url: "https://cdn.example.com/live/index.m3u8?token=1", title: ""), "index.m3u8")
        XCTAssertEqual(ListRules.defaultName(url: " \(yt) ", title: "   "), yt)
        XCTAssertEqual(ListRules.defaultName(url: web), web)
    }

    func testGroup() {
        XCTAssertEqual(ListRules.group(of: yt), .youtube)
        XCTAssertEqual(ListRules.group(of: "https://www.youtube.com/@somechannel"), .youtube)
        XCTAssertEqual(ListRules.group(of: web), .other)
        XCTAssertEqual(ListRules.group(of: mp4), .other)
    }

    // MARK: 最愛（R22）

    func testAddFavoriteGoesToTop() {
        var current = lists(ListRules.addFavorite(Lists(), url: yt, name: "A", now: 1))
        current = lists(ListRules.addFavorite(current, url: web, name: "B", now: 2))
        XCTAssertEqual(current.favorites, [
            ListItem(url: web, name: "B", time: 2),
            ListItem(url: yt, name: "A", time: 1)
        ])
    }

    func testIsFavoriteAndRemove() {
        let current = lists(ListRules.addFavorite(Lists(), url: yt, name: "A", now: 1))
        XCTAssertTrue(ListRules.isFavorite(current, url: " \(yt) "))
        XCTAssertFalse(ListRules.isFavorite(current, url: web))
        XCTAssertFalse(ListRules.isFavorite(ListRules.removeFavorite(current, url: yt), url: yt))
    }

    func testFavoriteEmptyNameUsesURL() {
        let current = lists(ListRules.addFavorite(Lists(), url: " \(yt) ", name: "   ", now: 1))
        XCTAssertEqual(current.favorites, [ListItem(url: yt, name: yt, time: 1)])
    }

    func testFavoriteErrors() {
        let current = lists(ListRules.addFavorite(Lists(), url: yt, name: "A", now: 1))
        XCTAssertEqual(error(ListRules.addFavorite(current, url: yt, name: "B", now: 2)), .duplicate)
        XCTAssertEqual(error(ListRules.addFavorite(current, url: "ftp://example.com/a", name: "B", now: 2)), .unsupported)
        XCTAssertEqual(ListError.duplicate.message, "清單中已經有這個網址")
        XCTAssertEqual(ListError.unsupported.message, "不支援的網址")
    }

    // MARK: 編輯與刪除（R21）

    private var twoFavorites: Lists {
        Lists(favorites: [ListItem(url: yt, name: "A", time: 2), ListItem(url: web, name: "B", time: 1)])
    }

    func testEditItem() {
        let edited = lists(ListRules.editItem(twoFavorites, kind: .favorites, index: 1, url: mp4, name: " 新名稱 "))
        XCTAssertEqual(edited.favorites[1], ListItem(url: mp4, name: "新名稱", time: 1))
        XCTAssertEqual(edited.favorites[0], twoFavorites.favorites[0])
    }

    func testEditItemErrors() {
        XCTAssertEqual(error(ListRules.editItem(twoFavorites, kind: .favorites, index: 1, url: "nope", name: "B")), .unsupported)
        // 改成清單中另一筆的網址時不儲存；改成自己原本的網址可以
        XCTAssertEqual(error(ListRules.editItem(twoFavorites, kind: .favorites, index: 1, url: yt, name: "B")), .duplicate)
        let same = lists(ListRules.editItem(twoFavorites, kind: .favorites, index: 1, url: web, name: ""))
        XCTAssertEqual(same.favorites[1], ListItem(url: web, name: web, time: 1))
    }

    func testDeleteItem() {
        XCTAssertEqual(ListRules.deleteItem(twoFavorites, kind: .favorites, index: 0).favorites.map(\.url), [web])
        // 不存在的位置不改變清單
        XCTAssertEqual(ListRules.deleteItem(twoFavorites, kind: .favorites, index: 5), twoFavorites)
        XCTAssertEqual(lists(ListRules.editItem(twoFavorites, kind: .history, index: 0, url: yt, name: "x")), twoFavorites)
    }

    // MARK: 歷史（R23）

    func testRecordHistory() {
        let current = ListRules.recordHistory(Lists(), url: yt, title: "標題", now: 100)
        XCTAssertEqual(current.history, [ListItem(url: yt, name: "標題", time: 100)])
    }

    func testRecordHistoryMovesExistingToTopAndKeepsName() {
        var current = ListRules.recordHistory(Lists(), url: yt, title: "舊標題", now: 100)
        current = ListRules.recordHistory(current, url: web, title: nil, now: 200)
        current = ListRules.recordHistory(current, url: yt, title: "新標題", now: 300)
        XCTAssertEqual(current.history, [
            ListItem(url: yt, name: "舊標題", time: 300),
            ListItem(url: web, name: web, time: 200)
        ])
    }

    func testHistoryIsCappedPerGroup() {
        var current = Lists()
        for index in 0..<205 {
            current = ListRules.recordHistory(current, url: "https://example.com/\(index)", title: nil, now: Double(index))
        }
        current = ListRules.recordHistory(current, url: yt, title: nil, now: 1000)
        // 其他網站 200 筆（刪掉最舊的 5 筆），YouTube 另外計算
        XCTAssertEqual(current.history.count, 201)
        XCTAssertEqual(current.history.first?.url, yt)
        XCTAssertEqual(current.history.last?.url, "https://example.com/5")
    }

    func testClearHistoryOneGroup() {
        var current = ListRules.recordHistory(Lists(), url: yt, title: nil, now: 1)
        current = ListRules.recordHistory(current, url: web, title: nil, now: 2)
        XCTAssertEqual(ListRules.clearHistory(current, group: .youtube).history.map(\.url), [web])
        XCTAssertEqual(ListRules.clearHistory(current, group: .other).history.map(\.url), [yt])
    }

    func testFormatTime() throws {
        let taipei = try XCTUnwrap(TimeZone(identifier: "Asia/Taipei"))
        // 2026-01-05 03:07 UTC = 台北 11:07
        XCTAssertEqual(ListRules.formatTime(1_767_582_420_000, timeZone: taipei), "2026/01/05 11:07")
    }

    // MARK: 訂閱（R59、R61）

    func testChannelID() {
        XCTAssertTrue(Channel.isID(channelID))
        XCTAssertTrue(Channel.isID("UCabc_def-ghiJKLmnopQRst"))
        XCTAssertFalse(Channel.isID("UCshort"))
        XCTAssertFalse(Channel.isID("XX" + String(repeating: "a", count: 22)))
        XCTAssertFalse(Channel.isID("UC" + String(repeating: "!", count: 22)))
    }

    func testAddAndRemoveChannel() {
        let url = Channel.pageURL(id: channelID)
        let current = lists(ListRules.addChannel(Lists(), id: channelID, name: "頻道", url: url, now: 5))
        XCTAssertEqual(current.channels, [Channel(id: channelID, name: "頻道", url: url, time: 5)])
        XCTAssertEqual(error(ListRules.addChannel(current, id: channelID, name: "x", url: url, now: 6)), .channelDuplicate)
        XCTAssertEqual(ListRules.removeChannel(current, id: channelID).channels, [])
    }

    func testAddChannelsSkipsKnown() {
        let other = "UC" + String(repeating: "b", count: 22)
        let existing = Lists(channels: [Channel(id: channelID, name: "A", url: "u", time: 1)])
        let incoming = [
            Channel(id: channelID, name: "A2", url: "u", time: 0),
            Channel(id: other, name: "B", url: "v", time: 0),
            Channel(id: other, name: "B 重複", url: "v", time: 0)
        ]
        let result = ListRules.addChannels(existing, incoming, now: 9)
        XCTAssertEqual(result.added, 1)
        XCTAssertEqual(result.skipped, 2)
        XCTAssertEqual(result.lists.channels.map(\.name), ["A", "B"])
        XCTAssertEqual(result.lists.channels[1].time, 9)
    }

    // MARK: 清單檔（R21 AC10、AC11）

    func testRoundTrip() {
        let current = Lists(
            favorites: [ListItem(url: yt, name: "A", time: 1_700_000_000_000)],
            history: [ListItem(url: web, name: "B", time: 1_700_000_000_500)],
            channels: [Channel(id: channelID, name: "頻道", url: Channel.pageURL(id: channelID), time: 3)]
        )
        let result = ListsCodec.parse(ListsCodec.encode(current))
        XCTAssertFalse(result.corrupt)
        XCTAssertEqual(result.lists, current)
    }

    func testCorruptFile() {
        for text in ["{ broken", "[]", "null", "\"text\""] {
            let result = ListsCodec.parse(text)
            XCTAssertTrue(result.corrupt, text)
            XCTAssertEqual(result.lists, Lists(), text)
        }
        XCTAssertFalse(ListsCodec.parse("{}").corrupt)
    }

    func testInvalidAndDuplicateItemsAreSkipped() {
        let text = """
        {
          "favorites": [
            { "url": "\(yt)", "name": "A", "time": 1 },
            { "url": " \(yt) ", "name": "重複", "time": 2 },
            { "url": "ftp://example.com/a", "name": "不支援" },
            { "url": "\(web)", "name": "  ", "time": "昨天" },
            "garbage",
            { "name": "沒有網址" }
          ],
          "history": "不是陣列",
          "channels": [
            { "id": "\(channelID)", "name": "頻道" },
            { "id": "\(channelID)", "name": "重複" },
            { "id": "bad" }
          ]
        }
        """
        let result = ListsCodec.parse(text)
        XCTAssertFalse(result.corrupt)
        XCTAssertEqual(result.lists.favorites, [
            ListItem(url: yt, name: "A", time: 1),
            ListItem(url: web, name: web, time: 0)
        ])
        XCTAssertEqual(result.lists.history, [])
        XCTAssertEqual(result.lists.channels, [
            Channel(id: channelID, name: "頻道", url: Channel.pageURL(id: channelID), time: 0)
        ])
    }

    func testLooksLikeLists() {
        XCTAssertTrue(ListsCodec.looksLikeLists("{\"favorites\":[]}"))
        XCTAssertTrue(ListsCodec.looksLikeLists("{\"channels\":[],\"other\":1}"))
        XCTAssertFalse(ListsCodec.looksLikeLists("{\"version\":1,\"layout\":\"2x2\"}")) // 這是設定檔
        XCTAssertFalse(ListsCodec.looksLikeLists("{\"favorites\":\"x\"}"))
        XCTAssertFalse(ListsCodec.looksLikeLists("隨便的文字"))
    }

    // MARK: 匯入桌面版的清單（R144）

    func testMergeFavoritesKeepsCurrentNamesAndAppendsNew() {
        // iPad 和桌面版的最愛各有 3 筆，其中 1 筆網址相同 → 5 筆，新增 2 筆（R144 AC3）
        let current = Lists(favorites: [
            ListItem(url: yt, name: "iPad 上的名稱", time: 30),
            ListItem(url: web, name: "W", time: 20),
            ListItem(url: mp4, name: "M", time: 10)
        ])
        let imported = Lists(favorites: [
            ListItem(url: yt, name: "桌面版的名稱", time: 99),
            ListItem(url: yt2, name: "Y2", time: 98),
            ListItem(url: "https://example.com/", name: "E", time: 97)
        ])
        let result = ListsImport.merge(current: current, imported: imported)
        XCTAssertEqual(result.summary.favoritesAdded, 2)
        XCTAssertEqual(result.lists.favorites.map(\.name), ["iPad 上的名稱", "W", "M", "Y2", "E"])
    }

    func testMergeHistoryKeepsNewerAndSortsByTime() {
        let current = Lists(history: [
            ListItem(url: yt, name: "iPad", time: 300),
            ListItem(url: web, name: "W 舊", time: 100)
        ])
        let imported = Lists(history: [
            ListItem(url: web, name: "W 新", time: 400),
            ListItem(url: yt, name: "桌面版", time: 200),
            ListItem(url: mp4, name: "M", time: 350)
        ])
        let result = ListsImport.merge(current: current, imported: imported)
        XCTAssertEqual(result.summary.historyAdded, 1)
        XCTAssertEqual(result.lists.history, [
            ListItem(url: web, name: "W 新", time: 400),
            ListItem(url: mp4, name: "M", time: 350),
            ListItem(url: yt, name: "iPad", time: 300)
        ])
    }

    func testMergeHistoryIsCapped() {
        let current = Lists(history: (0..<150).map {
            ListItem(url: "https://a.example.com/\($0)", name: "a", time: Double(1000 - $0))
        })
        let imported = Lists(history: (0..<150).map {
            ListItem(url: "https://b.example.com/\($0)", name: "b", time: Double(2000 - $0))
        })
        let result = ListsImport.merge(current: current, imported: imported)
        XCTAssertEqual(result.summary.historyAdded, 150)
        XCTAssertEqual(result.lists.history.count, 200)
        // 最舊的被刪掉
        XCTAssertEqual(result.lists.history.first?.url, "https://b.example.com/0")
        XCTAssertEqual(result.lists.history.last?.url, "https://a.example.com/49")
    }

    func testMergeChannels() {
        let other = "UC" + String(repeating: "b", count: 22)
        let current = Lists(channels: [Channel(id: channelID, name: "A", url: "u", time: 1)])
        let imported = Lists(channels: [
            Channel(id: channelID, name: "A 桌面版", url: "u", time: 2),
            Channel(id: other, name: "B", url: "v", time: 3)
        ])
        let result = ListsImport.merge(current: current, imported: imported)
        XCTAssertEqual(result.summary.channelsAdded, 1)
        XCTAssertEqual(result.lists.channels.map(\.name), ["A", "B"])
        XCTAssertEqual(result.summary.message, "最愛新增 0 筆、歷史新增 0 筆、訂閱新增 1 個頻道")
    }

    func testMergeEmptyImportChangesNothing() {
        let result = ListsImport.merge(current: twoFavorites, imported: Lists())
        XCTAssertEqual(result.lists, twoFavorites)
        XCTAssertEqual(result.summary, ListsImport.Summary())
    }
}
