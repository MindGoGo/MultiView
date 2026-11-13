import Foundation

/// App 的名稱與版本文字（R143）。
public enum AppInfo {
    public static let name = "MultiView iOS"

    /// 設定畫面顯示的版本文字，例如「MultiView iOS 0.1.0（yt-dlp 2026.11.01）」。
    /// 版本號是空的時候只顯示名稱；還沒有 yt-dlp 時不顯示括號。
    public static func versionLabel(version: String?, ytdlpVersion: String? = nil) -> String {
        var label = name
        if let version = clean(version) {
            label += " \(version)"
        }
        if let ytdlp = clean(ytdlpVersion) {
            label += "（yt-dlp \(ytdlp)）"
        }
        return label
    }

    /// 發佈用的標籤（`ios-v0.1.0`）對應的版本號；不是 iOS 版的標籤時回傳 nil（R119）。
    public static func version(fromTag tag: String) -> String? {
        let prefix = "ios-v"
        guard tag.hasPrefix(prefix) else { return nil }
        let version = String(tag.dropFirst(prefix.count))
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }) else { return nil }
        return version
    }

    private static func clean(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }
}
