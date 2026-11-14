import Foundation

/// yt-dlp 播放的純邏輯：從解析結果選出要播的串流（桌面版 R89、R103；iOS 版 R135）。
/// 由 `src/lib/ytdlp.ts` 改寫。

/// 解析得到的串流（R89）。
public struct YtStream: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case hls, mp4
    }

    public var kind: Kind
    public var url: String
    public var isLive: Bool
    public var title: String?
    /// 網址的有效期限（毫秒時間）。
    public var expiresAt: Double
    /// 網站要求的請求標頭（其他網站，R103）：只有 Referer、User-Agent。
    public var headers: [String: String]

    public init(kind: Kind, url: String, isLive: Bool, title: String?, expiresAt: Double, headers: [String: String] = [:]) {
        self.kind = kind
        self.url = url
        self.isLive = isLive
        self.title = title
        self.expiresAt = expiresAt
        self.headers = headers
    }
}

public enum YtDlpRules {
    /// 讀不到網址的有效期限時，當作 5 小時後過期。
    public static let defaultExpiry: Double = 5 * 60 * 60 * 1000
    /// 距離過期不到這麼久的串流不再沿用，重新解析。
    public static let expiryMargin: Double = 10 * 60 * 1000

    /// 原生播放器（AVPlayer）能播的容器；webm、avi、mkv、flv 等不能。
    private static let playableExtensions: Set<String> = ["mp4", "m4v", "mov"]

    /// 串流網址的有效期限：query 的 expire= 或路徑中的 /expire/<秒>/。
    public static func expiry(of url: String, now: Double) -> Double {
        for marker in ["?expire=", "&expire=", "/expire/", "/expire="] {
            guard let range = url.range(of: marker) else { continue }
            let digits = url[range.upperBound...].prefix { $0.isASCII && $0.isNumber }
            if digits.count >= 9, let seconds = Double(digits) {
                return seconds * 1000
            }
        }
        return now + defaultExpiry
    }

    /// 這個串流現在還能不能用（快取用）。
    public static func isUsable(_ stream: YtStream, now: Double) -> Bool {
        stream.expiresAt - now > expiryMargin
    }

    /// 從 yt-dlp 的解析結果選出要播的串流（R89、R103）：
    /// - HLS：優先有主清單（manifest_url）的格式（影像、聲音分開的軌道都在主清單裡，播放器會自己組合，也能切換畫質）；
    ///   其他網站沒有主清單時用 HLS 格式本身的網址（有影像的）
    /// - 沒有 HLS：影音合一、播放器能播的容器的 http(s) 格式，YouTube 用 360p（format 18），其他網站用畫質最高的。
    ///   其他網站常常不標示編碼，只排除明確標示「沒有影像」或「沒有聲音」的格式
    /// - 直播只用 HLS；還沒開始的直播、沒有可以播的格式回傳 nil
    public static func pickStream(info rawInfo: Any?, now: Double) -> YtStream? {
        guard let root = JSON.object(rawInfo), let info = firstVideo(root) else { return nil }
        let formats = (JSON.array(info["formats"]) ?? []).compactMap(JSON.object)
        let liveStatus = JSON.string(info["live_status"])
        let isLive = JSON.bool(info["is_live"]) == true || liveStatus == "is_live"
        // 直播的 title 後面會加上日期時間，fulltitle 是原本的名稱
        let title = JSON.nonEmptyString(info["fulltitle"]) ?? JSON.nonEmptyString(info["title"])

        func isHLS(_ format: [String: Any]) -> Bool {
            (JSON.string(format["protocol"]) ?? "").hasPrefix("m3u8")
        }
        func make(_ kind: YtStream.Kind, _ format: [String: Any], _ url: String) -> YtStream {
            YtStream(
                kind: kind, url: url, isLive: isLive, title: title,
                expiresAt: expiry(of: url, now: now), headers: headers(of: format, info: info)
            )
        }

        var hlsStream: YtStream?
        if let format = formats.first(where: { isHLS($0) && JSON.nonEmptyString($0["manifest_url"]) != nil }),
           let url = JSON.nonEmptyString(format["manifest_url"]) {
            hlsStream = make(.hls, format, url)
        } else if let format = formats.last(where: {
            isHLS($0) && JSON.nonEmptyString($0["url"]) != nil && JSON.string($0["vcodec"]) != "none"
        }), let url = JSON.nonEmptyString(format["url"]) {
            hlsStream = make(.hls, format, url)
        }

        if isLive { return hlsStream }
        if liveStatus == "is_upcoming" { return nil }
        if let hlsStream { return hlsStream }

        let muxed = formats.filter { format in
            let proto = JSON.string(format["protocol"]) ?? ""
            return (proto == "http" || proto == "https")
                && JSON.nonEmptyString(format["url"]) != nil
                && JSON.string(format["vcodec"]) != "none"
                && JSON.string(format["acodec"]) != "none"
                && isPlayable(format)
        }
        func height(_ format: [String: Any]) -> Double {
            JSON.number(format["height"]) ?? 0
        }
        // 畫質一樣時用前面的（和桌面版的穩定排序相同）
        let best = muxed.first { JSON.string($0["format_id"]) == "18" }
            ?? muxed.enumerated().max { a, b in
                height(a.element) != height(b.element) ? height(a.element) < height(b.element) : a.offset > b.offset
            }?.element
        guard let best, let url = JSON.nonEmptyString(best["url"]) else { return nil }
        return make(.mp4, best, url)
    }

    /// 解析 mv_bridge.resolve 回傳的文字，選出串流；失敗時回傳錯誤訊息。
    public static func stream(fromResolveOutput text: String, now: Double) -> Result<YtStream, ResolveError> {
        guard let result = JSON.object(JSON.parse(text)) else {
            return .failure(ResolveError(message: "無法讀取 yt-dlp 的結果"))
        }
        guard JSON.bool(result["ok"]) == true else {
            return .failure(ResolveError(message: JSON.nonEmptyString(result["error"]) ?? "yt-dlp 解析失敗"))
        }
        guard let stream = pickStream(info: result["info"], now: now) else {
            return .failure(ResolveError(message: "沒有可以播放的格式"))
        }
        return .success(stream)
    }

    public struct ResolveError: Error, Equatable, Sendable {
        public var message: String

        public init(message: String) {
            self.message = message
        }
    }

    private static func isPlayable(_ format: [String: Any]) -> Bool {
        guard let ext = JSON.string(format["ext"]) else { return true }
        return playableExtensions.contains(ext.lowercased())
    }

    /// 串流需要帶的請求標頭：只留 Referer、User-Agent（不帶 Cookie，R103）。
    private static func headers(of format: [String: Any], info: [String: Any]) -> [String: String] {
        guard let raw = JSON.object(format["http_headers"]) ?? JSON.object(info["http_headers"]) else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in raw {
            let name = key.lowercased()
            if name == "referer" || name == "user-agent", let text = JSON.string(value) {
                out[key] = text
            }
        }
        return out
    }

    /// 一個網頁有多部影片（yt-dlp 回傳清單）時用第一部有格式的（R103）。
    private static func firstVideo(_ info: [String: Any]) -> [String: Any]? {
        guard JSON.string(info["_type"]) == "playlist" else { return info }
        return (JSON.array(info["entries"]) ?? []).compactMap(JSON.object).first { JSON.array($0["formats"]) != nil }
    }
}

/// yt-dlp 的版本與自動更新的判斷（桌面版 R91–R93；iOS 版 R136）。
public enum YtDlpVersion {
    /// 日期格式的版本號（2026.10.26、2026.10.26.123456）：取出可比較的版本，不是時回傳 nil。
    public static func parse(_ text: String) -> String? {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { !($0.isASCII && $0.isNumber) && $0 != "." })
        for candidate in parts {
            let numbers = candidate.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
            guard numbers.count >= 3, numbers.count <= 4, numbers.allSatisfy({ !$0.isEmpty }),
                  numbers[0].count == 4, numbers[1].count <= 2, numbers[2].count <= 2
            else { continue }
            var out = [numbers[0], pad(numbers[1]), pad(numbers[2])]
            if numbers.count == 4 { out.append(numbers[3]) }
            return out.joined(separator: ".")
        }
        return nil
    }

    /// a 比 b 新回傳正數、一樣回傳 0、比較舊回傳負數。
    public static func compare(_ a: String, _ b: String) -> Int {
        let left = a.split(separator: ".").map { Int($0) ?? 0 }
        let right = b.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let difference = (index < left.count ? left[index] : 0) - (index < right.count ? right[index] : 0)
            if difference != 0 { return difference }
        }
        return 0
    }

    private static func pad(_ text: String) -> String {
        text.count < 2 ? "0" + text : text
    }
}

/// 更新紀錄 update.json（R136）。
public struct YtDlpUpdateRecord: Equatable, Sendable {
    /// 上次自動更新檢查的時間（毫秒）；沒有時為 0。
    public var lastCheck: Double
    /// 上次開啟時的 App 版本；沒有時為空字串。
    public var appVersion: String

    public init(lastCheck: Double = 0, appVersion: String = "") {
        self.lastCheck = lastCheck
        self.appVersion = appVersion
    }

    /// 讀不到或格式錯誤時當作從來沒檢查過、App 版本不同。
    public static func parse(_ text: String?) -> YtDlpUpdateRecord {
        let object = text.flatMap { JSON.object(JSON.parse($0)) } ?? [:]
        return YtDlpUpdateRecord(
            lastCheck: JSON.number(object["lastCheck"]) ?? 0,
            appVersion: JSON.string(object["appVersion"]) ?? ""
        )
    }

    public func encoded() -> String {
        JSON.encode(["lastCheck": lastCheck, "appVersion": appVersion] as [String: Any])
    }
}

public enum YtDlpUpdateRules {
    /// 開啟時的自動更新：距離上次檢查超過 24 小時（R92 時機 1）。
    public static let autoUpdateInterval: Double = 24 * 60 * 60 * 1000
    /// 因為解析失敗而觸發的更新，至少間隔這麼久（R92：10 分鐘內不重複）。
    public static let failureUpdateInterval: Double = 10 * 60 * 1000

    public static func shouldAutoUpdate(_ record: YtDlpUpdateRecord, now: Double) -> Bool {
        now - record.lastCheck >= autoUpdateInterval || record.lastCheck > now
    }

    /// 看起來是 yt-dlp 太舊、無法解析 YouTube 頁面的錯誤（R92 時機 2）。
    public static func isOutdatedError(_ message: String) -> Bool {
        let text = message.lowercased()
        if notOutdatedPatterns.contains(where: { text.contains($0) }) { return false }
        return outdatedPatterns.contains(where: { text.contains($0) })
    }

    /// 從官方的 SHA2-256SUMS 找出某個檔案的雜湊值（小寫十六進位）。
    public static func checksum(for fileName: String, in sums: String) -> String? {
        for line in sums.split(whereSeparator: \.isNewline) {
            let fields = line.split(separator: " ", omittingEmptySubsequences: true)
            guard fields.count == 2 else { continue }
            // 檔名前面可能有表示二進位模式的 *
            let name = fields[1].hasPrefix("*") ? fields[1].dropFirst() : fields[1]
            if name == fileName, fields[0].count == 64, fields[0].allSatisfy(\.isHexDigit) {
                return fields[0].lowercased()
            }
        }
        return nil
    }

    private static let outdatedPatterns = [
        "unable to extract", "nsig", "n challenge", "failed to extract any player response", "player response",
        "signature extraction failed", "please report this issue", "confirm you are on the latest version"
    ]

    /// 確定不是 yt-dlp 的問題（影片本身、登入、網路），不需要更新。
    private static let notOutdatedPatterns = [
        "private video", "video unavailable", "has been removed", "not available", "sign in to confirm",
        "members-only", "age-restricted", "age restricted", "confirm your age", "this live event will begin",
        "premieres in", "getaddrinfo", "timed out", "unable to download", "unsupported url", "cloudflare",
        "nodename nor servname", "network is unreachable", "offline"
    ]
}
