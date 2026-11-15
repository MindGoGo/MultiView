import Foundation

/// YouTube 預覽縮圖（桌面版 R50；iOS 版 R129），照搬 `src/lib/storyboard.ts`（Android 版 `Storyboard.kt`）。
/// YouTube 網頁裡的縮圖資訊（非公開介面）：`<網址樣板>|<等級 0>|<等級 1>|…`，
/// 每個等級是「寬#高#張數#每列張數#每頁列數#每張間隔毫秒#頁面名稱樣板#簽章」。
public struct StoryboardLevel: Equatable, Sendable {
    public var width: Int
    public var height: Int
    public var count: Int
    public var cols: Int
    public var rows: Int
    public var intervalMs: Double
    public var name: String
    public var sigh: String

    public init(width: Int, height: Int, count: Int, cols: Int, rows: Int, intervalMs: Double, name: String, sigh: String) {
        self.width = width
        self.height = height
        self.count = count
        self.cols = cols
        self.rows = rows
        self.intervalMs = intervalMs
        self.name = name
        self.sigh = sigh
    }
}

public struct Storyboard: Equatable, Sendable {
    public var base: String
    public var level: Int
    public var info: StoryboardLevel
}

/// 一張縮圖：在哪一頁圖片的哪個位置（像素）。
public struct StoryboardFrame: Equatable, Sendable {
    public var url: String
    public var x: Int
    public var y: Int
    public var width: Int
    public var height: Int
}

public enum StoryboardRules {
    /// 縮圖寬度不超過這個值的等級中選最大的。
    private static let maxWidth = 320
    private static let specMarker = #""playerStoryboardSpecRenderer":{"spec":""#

    /// 從 YouTube 網頁的 HTML 取出縮圖資訊；直播或找不到時回傳 nil。
    public static func extractSpec(_ html: String) -> String? {
        guard let start = html.range(of: specMarker) else { return nil }
        let rest = html[start.upperBound...]
        guard let end = rest.firstIndex(of: "\""), end > rest.startIndex else { return nil }
        return rest[..<end].replacingOccurrences(of: "\\u0026", with: "&")
    }

    public static func parse(_ spec: String) -> Storyboard? {
        let parts = spec.components(separatedBy: "|")
        guard let base = parts.first, base.hasPrefix("https://") else { return nil }
        var best: Storyboard?
        for (level, part) in parts.dropFirst().enumerated() {
            let fields = part.components(separatedBy: "#")
            guard fields.count >= 8 else { continue }
            let ints = fields.prefix(5).map { Int($0) }
            guard ints.allSatisfy({ ($0 ?? 0) > 0 }), let interval = Double(fields[5]), interval > 0 else { continue }
            let info = StoryboardLevel(
                width: ints[0]!, height: ints[1]!, count: ints[2]!, cols: ints[3]!, rows: ints[4]!,
                intervalMs: interval, name: fields[6], sigh: fields[7]
            )
            if info.width > maxWidth { continue }
            if best == nil || info.width > best!.info.width {
                best = Storyboard(base: base, level: level, info: info)
            }
        }
        return best
    }

    /// 秒數對應的縮圖；duration 是影片長度（秒）。
    public static func frame(_ storyboard: Storyboard, seconds: Double, duration: Double) -> StoryboardFrame {
        let info = storyboard.info
        let time = min(max(seconds.isNaN ? 0 : seconds, 0), max(duration.isNaN ? 0 : duration, 0))
        // 影片長度不明（無限大）時不能換成整數，先限制在張數以內
        let raw = min((time * 1000 / info.intervalMs).rounded(.down), Double(info.count - 1))
        let index = raw.isFinite ? Int(raw) : info.count - 1
        let perSheet = info.cols * info.rows
        let sheet = index / perSheet
        let position = index % perSheet
        let name = info.name.replacingOccurrences(of: "$M", with: String(sheet))
        let url = storyboard.base
            .replacingOccurrences(of: "$L", with: String(storyboard.level))
            .replacingOccurrences(of: "$N", with: name) + "&sigh=" + info.sigh
        return StoryboardFrame(
            url: url, x: (position % info.cols) * info.width, y: (position / info.cols) * info.height,
            width: info.width, height: info.height
        )
    }
}
