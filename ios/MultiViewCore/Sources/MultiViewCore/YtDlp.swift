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
