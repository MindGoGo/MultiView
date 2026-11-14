import Foundation

/// YouTube 訂閱（桌面版 R59–R61；iOS 版 R142）：頻道網址辨識、頻道資訊、頻道摘要的解析。
/// 由 `src/lib/youtubeFeed.ts` 改寫。

/// 頻道摘要裡的一部影片（R59）。
public struct FeedVideo: Equatable, Sendable {
    public var videoID: String
    public var title: String
    /// 發布時間（毫秒）。
    public var published: Double

    public init(videoID: String, title: String, published: Double) {
        self.videoID = videoID
        self.title = title
        self.published = published
    }
}

public enum YouTubeFeed {
    public enum LookupKind: Sendable {
        case channel, video
    }

    /// 名稱旁顯示的新影片：24 小時內發布的（R59）。
    public static let newVideoInterval: Double = 24 * 3600 * 1000
    /// 最新影片多久自動更新一次（面板開著時，R59）。
    public static let refreshInterval: Double = 15 * 60 * 1000

    public static func feedURL(channelID: String) -> String {
        "https://www.youtube.com/feeds/videos.xml?channel_id=\(channelID)"
    }

    public static func liveURL(channelID: String) -> String {
        "https://www.youtube.com/channel/\(channelID)/live"
    }

    /// 加入頻道時貼上的網址（R59）：頻道頁（/@帳號、/channel/UC…、/c/…、/user/…）或影片網址。
    /// 回傳要讀取的網頁網址；不是頻道或影片時回傳 nil。
    public static func channelLookup(_ input: String) -> (page: String, kind: LookupKind)? {
        guard let parsed = SourceParser.parse(input) else { return nil }
        if case .youtube(let videoID) = parsed {
            return (SourceParser.watchPageURL(videoID: videoID), .video)
        }
        guard case .web(let href) = parsed, let url = WebURL(href) else { return nil }
        guard url.host == "youtube.com" || url.host.hasSuffix(".youtube.com") else { return nil }
        let segments = url.segments
        guard let first = segments.first else { return nil }
        let second = segments.count > 1 ? segments[1] : nil
        if first.hasPrefix("@") || first.hasPrefix("%40") {
            return ("https://www.youtube.com/\(first)", .channel)
        }
        if first == "channel", let second, Channel.isID(second) {
            return (Channel.pageURL(id: second), .channel)
        }
        if first == "c" || first == "user", let second {
            return ("https://www.youtube.com/\(first)/\(second)", .channel)
        }
        return nil
    }

    /// 從頻道頁或影片頁的 HTML 取出頻道代碼與名稱；取不到時回傳 nil。
    public static func extractChannelInfo(html: String, kind: LookupKind) -> (id: String, name: String)? {
        switch kind {
        case .video:
            guard let id = firstMatch(#""channelId":"(UC[\w-]{22})""#, in: html),
                  let name = firstMatch(#""ownerChannelName":"((?:[^"\\]|\\.)*)""#, in: html)
                    ?? firstMatch(#""author":"((?:[^"\\]|\\.)*)""#, in: html)
            else { return nil }
            return (id, decodeJSONString(name))
        case .channel:
            guard let id = firstMatch(#""externalId":"(UC[\w-]{22})""#, in: html)
                    ?? firstMatch(#"<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})""#, in: html),
                  let name = firstMatch(#"<meta property="og:title" content="([^"]*)""#, in: html)
            else { return nil }
            return (id, decodeEntities(name))
        }
    }

    /// 解析頻道摘要（Atom XML），新的在上面；格式不對時回傳 nil。
    public static func parseFeed(xml: String) -> [FeedVideo]? {
        guard xml.contains("<feed") else { return nil }
        var videos: [FeedVideo] = []
        for entry in allMatches(#"<entry>([\s\S]*?)</entry>"#, in: xml) {
            guard let videoID = firstMatch(#"<yt:videoId>([^<]+)</yt:videoId>"#, in: entry),
                  let title = firstMatch(#"<title>([^<]*)</title>"#, in: entry),
                  let published = firstMatch(#"<published>([^<]+)</published>"#, in: entry).flatMap(parseDate)
            else { continue }
            videos.append(FeedVideo(videoID: videoID, title: decodeEntities(title), published: published))
        }
        // 發布時間一樣時維持摘要裡的順序
        return videos.enumerated().sorted { a, b in
            a.element.published != b.element.published ? a.element.published > b.element.published : a.offset < b.offset
        }.map(\.element)
    }

    /// 頻道直播頁的 HTML → 正在直播的影片代碼（R60）。
    /// 正在直播時直播頁指向那場直播的影片，並標示直播中；已排程、還沒開始的直播不算。判斷不了時回傳 nil。
    public static func parseLiveStatus(html: String) -> String? {
        guard let id = firstMatch(#"<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})""#, in: html),
              html.contains(#""isLive":true"#), !html.contains(#""isUpcoming":true"#)
        else { return nil }
        return id
    }

    /// Google Takeout 匯出的 YouTube 訂閱檔（subscriptions.csv，R61）。
    /// 不同語言的欄位名稱不同，所以用內容辨識：頻道代碼欄、網址欄，其餘的是名稱。
    /// 找不到任何頻道時回傳 nil（不是訂閱檔）。回傳的頻道加入時間是 0。
    public static func parseTakeoutCSV(_ text: String) -> [Channel]? {
        var out: [Channel] = []
        // 去掉檔案開頭的 BOM，Windows 與 Unix 的換行都可以
        let content = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        for line in content.split(whereSeparator: \.isNewline) {
            let cells = splitCSVLine(String(line))
            guard let id = cells.first(where: Channel.isID), !out.contains(where: { $0.id == id }) else { continue }
            let name = cells.first { !$0.isEmpty && $0 != id && !isWebAddress($0) } ?? id
            out.append(Channel(id: id, name: name, url: Channel.pageURL(id: id), time: 0))
        }
        return out.isEmpty ? nil : out
    }

    public static func countNew(_ videos: [FeedVideo], now: Double) -> Int {
        videos.filter { now - $0.published < newVideoInterval }.count
    }

    /// 發布時間的簡短說明，例如「3 小時前」「2 天前」。
    public static func formatAgo(published: Double, now: Double) -> String {
        let minutes = max(0, Int(((now - published) / 60000).rounded(.down)))
        if minutes < 60 { return "\(max(minutes, 1)) 分鐘前" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours) 小時前" }
        let days = hours / 24
        if days < 30 { return "\(days) 天前" }
        let months = days / 30
        return months < 12 ? "\(months) 個月前" : "\(months / 12) 年前"
    }

    /// 解碼 HTML／XML 的字元參照。
    public static func decodeEntities(_ text: String) -> String {
        var out = ""
        var rest = Substring(text)
        while let start = rest.firstIndex(of: "&") {
            out += rest[..<start]
            let tail = rest[start...]
            guard let end = tail.firstIndex(of: ";"), tail.distance(from: tail.startIndex, to: end) <= 10 else {
                out += "&"
                rest = tail.dropFirst()
                continue
            }
            let name = tail[tail.index(after: tail.startIndex)..<end]
            if let decoded = decodeEntity(name) {
                out += decoded
                rest = tail[tail.index(after: end)...]
            } else {
                out += "&"
                rest = tail.dropFirst()
            }
        }
        return out + rest
    }

    // MARK: 內部

    private static func decodeEntity(_ name: Substring) -> String? {
        switch name {
        case "quot": return "\""
        case "apos": return "'"
        case "lt": return "<"
        case "gt": return ">"
        case "amp": return "&"
        default:
            guard name.hasPrefix("#") else { return nil }
            let digits = name.dropFirst()
            let value: UInt32?
            if digits.hasPrefix("x") || digits.hasPrefix("X") {
                value = UInt32(digits.dropFirst(), radix: 16)
            } else {
                value = UInt32(digits, radix: 10)
            }
            guard let value, let scalar = Unicode.Scalar(value) else { return nil }
            return String(Character(scalar))
        }
    }

    /// JSON 字串內容的跳脫字元（例如 &、\"）。
    private static func decodeJSONString(_ text: String) -> String {
        JSON.string(JSON.parse("\"\(text)\"")) ?? text
    }

    private static func parseDate(_ text: String) -> Double? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: text) {
            return date.timeIntervalSince1970 * 1000
        }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text).map { $0.timeIntervalSince1970 * 1000 }
    }

    private static func isWebAddress(_ text: String) -> Bool {
        let lower = text.lowercased()
        return lower.hasPrefix("http://") || lower.hasPrefix("https://")
    }

    /// 拆開一行 CSV（支援引號、引號內的逗號與 "" 跳脫）。
    static func splitCSVLine(_ line: String) -> [String] {
        var out: [String] = []
        var current = ""
        var quoted = false
        let characters = Array(line)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if quoted {
                if character == "\"", index + 1 < characters.count, characters[index + 1] == "\"" {
                    current.append("\"")
                    index += 1
                } else if character == "\"" {
                    quoted = false
                } else {
                    current.append(character)
                }
            } else if character == "\"" {
                quoted = true
            } else if character == "," {
                out.append(current)
                current = ""
            } else {
                current.append(character)
            }
            index += 1
        }
        out.append(current)
        return out.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// 第一個符合的地方的第一個括號內容。
    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[range])
    }

    private static func allMatches(_ pattern: String, in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[range])
        }
    }
}
