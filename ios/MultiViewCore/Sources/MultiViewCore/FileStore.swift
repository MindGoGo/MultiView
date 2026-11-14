import Foundation

/// 設定檔與清單檔的讀寫（桌面版 R10、R21；iOS 版 R134、R141）。
/// 寫入先寫暫存檔再改名，避免寫到一半被系統結束造成檔案損毀。
public enum FileStore {
    public static let settingsFileName = "settings.json"
    public static let listsFileName = "lists.json"

    /// 沒有設定檔時用預設值；損毀時改名成 `.bak` 保留，用預設值（R10 AC2）。
    public static func loadSettings(at url: URL) -> Settings {
        guard let text = read(url) else { return Settings() }
        let result = SettingsCodec.parse(text)
        if result.corrupt { keepAsBackup(url) }
        return result.settings
    }

    public static func saveSettings(_ settings: Settings, to url: URL) throws {
        try write(SettingsCodec.encode(settings), to: url)
    }

    /// 沒有清單檔時是空的；損毀時改名成 `.bak` 保留，清單從空的開始（R21 AC11）。
    public static func loadLists(at url: URL) -> Lists {
        guard let text = read(url) else { return Lists() }
        let result = ListsCodec.parse(text)
        if result.corrupt { keepAsBackup(url) }
        return result.lists
    }

    public static func saveLists(_ lists: Lists, to url: URL) throws {
        try write(ListsCodec.encode(lists), to: url)
    }

    static func read(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        // 不是 UTF-8 的檔案也當作有內容（之後會被判定為損毀）
        return String(data: data, encoding: .utf8) ?? ""
    }

    static func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    /// 損毀的檔案改名保留。改名失敗也不影響啟動，下次寫入會覆蓋。
    static func keepAsBackup(_ url: URL) {
        let backup = url.appendingPathExtension("bak")
        try? FileManager.default.removeItem(at: backup)
        try? FileManager.default.moveItem(at: url, to: backup)
    }
}
