import Foundation

/// 網址解析與分類（桌面版 R2、R12、R57；iOS 版 R126）。由桌面版 `src/lib/source.ts` 改寫。
public enum ParsedSource: Equatable, Sendable {
    case youtube(videoID: String)
    case hls(url: String)
    case mp4(url: String)
    case web(url: String)

    public enum Kind: String, Sendable {
        case youtube, hls, mp4, web
    }

    public var kind: Kind {
        switch self {
        case .youtube: return .youtube
        case .hls: return .hls
        case .mp4: return .mp4
        case .web: return .web
        }
    }

    /// 直接連結與網頁來源的網址；YouTube 影片沒有（用影片代碼）。
    public var url: String? {
        switch self {
        case .youtube: return nil
        case .hls(let url), .mp4(let url), .web(let url): return url
        }
    }
}

public enum SourceParser {
    private static let youtubeHosts: Set<String> = ["youtube.com", "www.youtube.com", "m.youtube.com"]

    /// 解析使用者輸入的網址；不支援時回傳 nil。
    public static func parse(_ input: String) -> ParsedSource? {
        guard let url = WebURL(input) else { return nil }

        if let videoID = youtubeID(url) {
            return .youtube(videoID: videoID)
        }

        let path = url.path.lowercased()
        if path.hasSuffix(".m3u8") { return .hls(url: url.href) }
        if path.hasSuffix(".mp4") { return .mp4(url: url.href) }
        // youtu.be 只有影片網址；youtube.com 的其他頁面（首頁、搜尋、頻道、播放清單、Shorts）當作 YouTube 網站頁面（R57）
        if url.host == "youtu.be" || url.host.hasSuffix(".youtu.be") { return nil }
        return .web(url: url.href)
    }

    /// 格子實際使用的來源：改用 YouTube 網頁播放時（R48），以網頁來源載入這部影片的 YouTube 網頁，
    /// 格子的網址仍是原本的 YouTube 網址。
    public static func resolve(_ input: String, youtubeWeb: Bool) -> ParsedSource? {
        let parsed = parse(input)
        if youtubeWeb, case .youtube(let videoID)? = parsed {
            return .web(url: watchPageURL(videoID: videoID))
        }
        return parsed
    }

    /// YouTube 網站頁面（R57）：youtube.com 網域、但不是單一影片的頁面，以網頁來源的整頁模式瀏覽。
    public static func isYouTubeSite(_ input: String) -> Bool {
        guard case .web(let href)? = parse(input), let url = WebURL(href) else { return false }
        return isYouTubeDomain(url.host)
    }

    /// YouTube 影片代碼：11 個英數、`_`、`-`。
    public static func isVideoID(_ text: String) -> Bool {
        text.utf8.count == 11 && text.utf8.allSatisfy(isIDCharacter)
    }

    public static func watchPageURL(videoID: String) -> String {
        "https://www.youtube.com/watch?v=\(videoID)"
    }

    /// youtube.com、youtu.be 和它們的子網域。
    static func isYouTubeDomain(_ host: String) -> Bool {
        ["youtube.com", "youtu.be"].contains { host == $0 || host.hasSuffix("." + $0) }
    }

    static func isIDCharacter(_ byte: UInt8) -> Bool {
        switch byte {
        case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
             UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "_"), UInt8(ascii: "-"):
            return true
        default:
            return false
        }
    }

    private static func youtubeID(_ url: WebURL) -> String? {
        let segments = url.segments
        var id: String?
        if url.host == "youtu.be" {
            id = segments.count == 1 ? segments[0] : nil
        } else if youtubeHosts.contains(url.host) {
            if segments.count == 1, segments[0] == "watch" {
                id = url.queryValue("v")
            } else if segments.count == 2, segments[0] == "live" || segments[0] == "embed" {
                id = segments[1]
            }
        }
        guard let id, isVideoID(id) else { return nil }
        return id
    }
}

/// http(s) 網址的各個部分，整理成和瀏覽器的 `URL` 相同的寫法：
/// 協定與網域小寫、沒有路徑時補 `/`、省略預設的連接埠。
struct WebURL {
    let scheme: String
    let host: String
    let port: Int?
    /// 百分比編碼後的路徑，至少是 `/`。
    let path: String
    let query: String?
    let fragment: String?
    private let userInfo: String?
    private let queryItems: [URLQueryItem]

    init?(_ input: String) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let components = URLComponents(string: trimmed) else { return nil }
        guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        guard let host = (components.encodedHost ?? components.host)?.lowercased(), !host.isEmpty else { return nil }

        self.scheme = scheme
        self.host = host
        let defaultPort = scheme == "https" ? 443 : 80
        self.port = components.port == defaultPort ? nil : components.port
        let path = components.percentEncodedPath
        self.path = path.isEmpty ? "/" : path
        self.query = components.percentEncodedQuery
        self.fragment = components.percentEncodedFragment
        self.queryItems = components.queryItems ?? []
        if let user = components.percentEncodedUser, !user.isEmpty {
            if let password = components.percentEncodedPassword, !password.isEmpty {
                self.userInfo = "\(user):\(password)"
            } else {
                self.userInfo = user
            }
        } else {
            self.userInfo = nil
        }
    }

    /// 路徑中不是空白的各段。
    var segments: [String] {
        path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }

    /// 路徑的最後一段（可能是空的），例如檔名。
    var lastPathComponent: String {
        guard let index = path.lastIndex(of: "/") else { return path }
        return String(path[path.index(after: index)...])
    }

    /// 第一個同名 query 參數的值。
    func queryValue(_ name: String) -> String? {
        queryItems.first { $0.name == name }?.value
    }

    var href: String {
        var text = "\(scheme)://"
        if let userInfo { text += "\(userInfo)@" }
        text += host
        if let port { text += ":\(port)" }
        text += path
        if let query { text += "?\(query)" }
        if let fragment { text += "#\(fragment)" }
        return text
    }
}
