import Foundation

/// YouTube 小視窗的純邏輯（桌面版 R78–R83；iOS 版 R140）。由 `src/lib/companion.ts` 改寫。
public enum CompanionTab: String, CaseIterable, Sendable {
    case search, related, comments, chat

    public var label: String {
        switch self {
        case .search: return "搜尋"
        case .related: return "推薦"
        case .comments: return "留言"
        case .chat: return "聊天室"
        }
    }
}

public enum CompanionAction: Equatable, Sendable {
    /// 連結的格子跳到這個時間。
    case seek(seconds: Double)
    /// 播放這部影片。
    case play(url: String)
}

public enum CompanionRules {
    public static let mobileHome = "https://m.youtube.com/"
    /// 推薦、留言、聊天室用桌面版的 YouTube 網頁（樣式是針對桌面版寫的）。
    public static let desktopUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"

    public static func watchPageURL(videoID: String) -> String {
        SourceParser.watchPageURL(videoID: videoID)
    }

    public static func liveChatURL(videoID: String) -> String {
        "https://www.youtube.com/live_chat?v=\(videoID)&is_popout=1"
    }

    /// YouTube 連結的 t 參數（例如 195、195s、3m15s、1h2m3s）換成秒數；不是時間時回傳 nil。
    public static func parseTime(_ raw: String?) -> Double? {
        guard let raw else { return nil }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !text.isEmpty else { return nil }
        let digits = text.hasSuffix("s") ? String(text.dropLast()) : text
        if !digits.isEmpty, digits.allSatisfy({ $0.isASCII && $0.isNumber }) {
            return Double(digits)
        }
        // 1h2m3s：單位要依 h、m、s 的順序，各出現最多一次
        var total = 0.0
        var number = ""
        var units = Array("hms")
        for character in text {
            if character.isASCII, character.isNumber {
                number.append(character)
                continue
            }
            guard let position = units.firstIndex(of: character), let value = Double(number) else { return nil }
            total += value * (character == "h" ? 3600 : character == "m" ? 60 : 1)
            units.removeSubrange(...position)
            number = ""
        }
        return number.isEmpty ? total : nil
    }

    /// 推薦、留言分頁裡點了 YouTube 影片連結（R79、R80）：同一部影片帶時間 → 跳到那個時間；
    /// 同一部影片不帶時間 → 不做事；其他影片 → 播放那部影片。不是 YouTube 影片時回傳 nil。
    public static func linkAction(href: String, currentVideoID: String?) -> CompanionAction? {
        guard case .youtube(let videoID)? = SourceParser.parse(href) else { return nil }
        if videoID == currentVideoID {
            guard let url = WebURL(href), let seconds = parseTime(url.queryValue("t")) else { return nil }
            return .seek(seconds: seconds)
        }
        return .play(url: watchPageURL(videoID: videoID))
    }

    /// 小視窗上方「第 N 格：影片名稱」（R78）。
    public static func header(cell: Int?, title: String?) -> String {
        guard let cell else { return "點一下 YouTube 的格子，這裡會顯示它的推薦影片、留言和聊天室" }
        guard let title, !title.isEmpty else { return "第 \(cell + 1) 格" }
        return "第 \(cell + 1) 格：\(title)"
    }
}
