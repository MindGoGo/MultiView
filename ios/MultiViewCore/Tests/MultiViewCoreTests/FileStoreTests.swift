import XCTest
@testable import MultiViewCore

/// 設定檔與清單檔的讀寫（R10、R21、R134、R141）。
final class FileStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("multiview-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private var settingsFile: URL { directory.appendingPathComponent(FileStore.settingsFileName) }
    private var listsFile: URL { directory.appendingPathComponent(FileStore.listsFileName) }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func testMissingSettingsFileUsesDefaults() {
        XCTAssertEqual(FileStore.loadSettings(at: settingsFile), Settings())
        XCTAssertFalse(exists(settingsFile))
    }

    func testSettingsRoundTrip() throws {
        var settings = Settings()
        settings.layout = .onePlusThree
        settings.slots[0] = SavedSource(url: "https://youtu.be/jfKfPfyJRdk", volume: 40)
        try FileStore.saveSettings(settings, to: settingsFile)
        XCTAssertEqual(FileStore.loadSettings(at: settingsFile), settings)
    }

    func testSaveCreatesDirectory() throws {
        let nested = directory.appendingPathComponent("a/b/settings.json")
        try FileStore.saveSettings(Settings(), to: nested)
        XCTAssertTrue(exists(nested))
    }

    func testCorruptSettingsFileIsKeptAsBackup() throws {
        try Data("{ broken".utf8).write(to: settingsFile)
        XCTAssertEqual(FileStore.loadSettings(at: settingsFile), Settings())
        XCTAssertFalse(exists(settingsFile))
        let backup = settingsFile.appendingPathExtension("bak")
        XCTAssertEqual(try String(contentsOf: backup, encoding: .utf8), "{ broken")
    }

    func testCorruptFileReplacesOlderBackup() throws {
        let backup = settingsFile.appendingPathExtension("bak")
        try Data("舊的備份".utf8).write(to: backup)
        try Data("[]".utf8).write(to: settingsFile)
        _ = FileStore.loadSettings(at: settingsFile)
        XCTAssertEqual(try String(contentsOf: backup, encoding: .utf8), "[]")
    }

    func testListsRoundTrip() throws {
        let lists = Lists(favorites: [ListItem(url: "https://www.twitch.tv/abc", name: "A", time: 5)])
        try FileStore.saveLists(lists, to: listsFile)
        XCTAssertEqual(FileStore.loadLists(at: listsFile), lists)
    }

    func testMissingAndCorruptListsFile() throws {
        XCTAssertEqual(FileStore.loadLists(at: listsFile), Lists())
        try Data("{ broken".utf8).write(to: listsFile)
        XCTAssertEqual(FileStore.loadLists(at: listsFile), Lists())
        XCTAssertFalse(exists(listsFile))
        XCTAssertTrue(exists(listsFile.appendingPathExtension("bak")))
    }

    func testSettingsAndListsAreIndependent() throws {
        // 其中一個損毀不影響另一個
        try FileStore.saveLists(Lists(favorites: [ListItem(url: "https://example.com/", name: "E", time: 1)]), to: listsFile)
        try Data("{ broken".utf8).write(to: settingsFile)
        _ = FileStore.loadSettings(at: settingsFile)
        XCTAssertEqual(FileStore.loadLists(at: listsFile).favorites.count, 1)
    }
}
