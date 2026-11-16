import CryptoKit
import Foundation

// SponsorBlock（R161）：跳過社群標記的業配等片段，只用在 yt-dlp 播放的 YouTube 一般影片。
// 資料來自 SponsorBlock（https://sponsor.ajay.app），授權 CC BY-NC-SA 4.0。
// 這個檔案只有規則，不連網路、不碰畫面；照搬 Android 版 `android/core/.../SponsorBlock.kt`，
// 測試照搬 `SponsorBlockTest.kt`（SponsorBlockTests.swift）。

/// 片段的類別。rawValue 是 API 與設定檔用的代碼，label 是提示與設定畫面顯示的名稱，
/// color 是進度條色塊的顏色（0xRRGGBB，和 SponsorBlock 官方擴充功能的預設顏色相同）。
/// poi_highlight（精華時間點）不是要跳過的片段，第一版不列出。
public enum SponsorCategory: String, CaseIterable, Sendable {
    case sponsor
    case selfpromo
    case interaction
    case intro
    case outro
    case preview
    case filler
    case musicOfftopic = "music_offtopic"

    public var label: String {
        switch self {
        case .sponsor: return "業配"
        case .selfpromo: return "自我宣傳"
        case .interaction: return "訂閱提醒"
        case .intro: return "開場"
        case .outro: return "片尾"
        case .preview: return "預告與回顧"
        case .filler: return "離題閒聊"
        case .musicOfftopic: return "音樂影片的非音樂部分"
        }
    }

    public var color: UInt32 {
        switch self {
        case .sponsor: return 0x00D400
        case .selfpromo: return 0xFFFF00
        case .interaction: return 0xCC00FF
        case .intro: return 0x00FFFF
        case .outro: return 0x0202ED
        case .preview: return 0x008FD6
        case .filler: return 0x7300FF
        case .musicOfftopic: return 0xFF9900
        }
    }
}

/// 一個要跳過的片段：start、end 是秒數；id 是 SponsorBlock 的 UUID（合併的片段用第一個的）。
public struct SponsorSegment: Equatable, Sendable {
    public var start: Double
    public var end: Double
    public var category: SponsorCategory
    public var id: String

    public init(start: Double, end: Double, category: SponsorCategory, id: String) {
        self.start = start
        self.end = end
        self.category = category
        self.id = id
    }
}

/// 設定（預設開啟，只跳過業配）。
public struct SponsorBlockSettings: Equatable, Sendable {
    public var enabled: Bool
    public var categories: Set<SponsorCategory>

    public init(enabled: Bool = true, categories: Set<SponsorCategory> = [.sponsor]) {
        self.enabled = enabled
        self.categories = categories
    }

    /// 要不要跳過任何片段（關閉或一個類別都沒勾時不連 API）。
    public var active: Bool { enabled && !categories.isEmpty }
}

/// 自動跳過：跳到 target 秒（片段結尾；片段結尾在影片最後 1 秒內時是影片長度，視為播完）。
public struct SkipAction: Equatable, Sendable {
    public var segment: SponsorSegment
    public var target: Double

    public init(segment: SponsorSegment, target: Double) {
        self.segment = segment
        self.target = target
    }
}

/// 每一格各自的跳過狀態：已經處理過的片段（自動跳過過、使用者取消、使用者自己跳進去的）不再自動跳過。
/// 值型別；每次改變回傳新的狀態。
public struct SkipState: Equatable, Sendable {
    public var handled: Set<String>

    public init(handled: Set<String> = []) {
        self.handled = handled
    }

    /// 這個片段處理過了（跳過或取消）。
    public func markHandled(_ segment: SponsorSegment) -> SkipState {
        SkipState(handled: handled.union([segment.id]))
    }

    /// 使用者自己跳轉（拖曳進度條、雙擊快轉倒轉、從上次的進度開始）到 time：
    /// 落在片段裡面時，這個片段當作處理過，不會馬上又被跳走。
    public func userSeeked(_ segments: [SponsorSegment], time: Double) -> SkipState {
        let inside = segments.filter { time >= $0.start && time < $0.end }.map(\.id)
        return inside.isEmpty ? self : SkipState(handled: handled.union(inside))
    }
}

/// 進度條上的一個色塊：start、end 是 0–1 的比例。
public struct SegmentMark: Equatable, Sendable {
    public var start: Double
    public var end: Double
    public var category: SponsorCategory

    public init(start: Double, end: Double, category: SponsorCategory) {
        self.start = start
        self.end = end
        self.category = category
    }
}

public enum SponsorBlockRules {
    public static let apiBase = "https://sponsor.ajay.app/api/skipSegments/"

    /// 請求逾時（秒）。逾時或失敗當作沒有片段，不影響播放。
    public static let timeoutSeconds: Double = 5

    /// 比這個短（秒）的片段忽略。
    public static let minSegmentSeconds: Double = 1

    /// 片段結尾在影片最後這幾秒內時，跳到影片結尾（視為播完）。
    public static let endMarginSeconds: Double = 1

    /// 播放位置離片段結尾不到這幾秒時不跳（跳了也只省一下子，而且避免剛跳完又判斷到同一段）。
    public static let minRemainingSeconds: Double = 0.3

    /// 檢查播放位置的間隔（秒）。
    public static let checkIntervalSeconds: Double = 0.25

    /// 跳過提示顯示多久（秒）。
    public static let noticeSeconds: Double = 5

    /// 影片 ID 的 SHA-256（十六進位小寫）的前 4 碼：隱私版 API 只送前綴，不讓伺服器知道在看哪一部。
    public static func hashPrefix(_ videoID: String) -> String {
        let digest = SHA256.hash(data: Data(videoID.utf8))
        return digest.prefix(2).map { String(format: "%02x", $0) }.joined()
    }

    /// 請求網址：`<apiBase><雜湊前綴>?categories=[...]`（JSON 陣列，網址編碼）。
    /// App 一律要全部的類別（只有幾 KB），在本機依設定過濾：改設定時不用重新抓。
    public static func requestURL(_ videoID: String, categories: [SponsorCategory] = SponsorCategory.allCases) -> String {
        let list = SponsorCategory.allCases.filter { categories.contains($0) }
            .map { "%22\($0.rawValue)%22" }
            .joined(separator: "%2C")
        return apiBase + hashPrefix(videoID) + "?categories=%5B" + list + "%5D"
    }

    /// 解析 API 的回應（HTTP 200 的內容；404 代表沒有片段，App 直接當作空的）：
    /// 回應裡有很多部影片，只取 videoID 相同的；只要 actionType 是 skip（沒有這個欄位也當作 skip）、
    /// 起訖合理、類別認得的片段。格式不對時回傳空的。順序照 API，還沒過濾、合併（見 select）。
    public static func parse(_ text: String, videoID: String) -> [SponsorSegment] {
        guard let videos = JSON.array(JSON.parse(text)) else { return [] }
        var out: [SponsorSegment] = []
        for video in videos.compactMap(JSON.object) {
            guard JSON.string(video["videoID"]) == videoID else { continue }
            for item in (JSON.array(video["segments"]) ?? []).compactMap(JSON.object) {
                let action = JSON.string(item["actionType"]) ?? "skip"
                guard action == "skip",
                      let category = JSON.string(item["category"]).flatMap(SponsorCategory.init(rawValue:)),
                      let range = JSON.array(item["segment"]), range.count >= 2,
                      let start = JSON.number(range[0]),
                      let end = JSON.number(range[1]),
                      start.isFinite, end.isFinite, end > start
                else { continue }
                let id = JSON.nonEmptyString(item["UUID"]) ?? "\(category.rawValue)@\(start)"
                out.append(SponsorSegment(start: max(0, start), end: end, category: category, id: id))
            }
        }
        return out
    }

    /// 依設定挑出要跳過的片段：只留勾選的類別、忽略太短的，依開始時間排序，重疊或相接的合併成一段
    /// （合併後的類別與 id 用最早開始的那一段）。關閉時回傳空的。
    public static func select(_ segments: [SponsorSegment], settings: SponsorBlockSettings) -> [SponsorSegment] {
        guard settings.active else { return [] }
        let sorted = segments
            .filter { settings.categories.contains($0.category) && $0.end - $0.start >= minSegmentSeconds }
            .enumerated()
            // 開始、結束都相同時維持原本的順序（和 Kotlin 的 sortedWith 一樣是穩定排序）
            .sorted { lhs, rhs in
                if lhs.element.start != rhs.element.start { return lhs.element.start < rhs.element.start }
                if lhs.element.end != rhs.element.end { return lhs.element.end < rhs.element.end }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
        var merged: [SponsorSegment] = []
        for segment in sorted {
            if let last = merged.last, segment.start <= last.end {
                if segment.end > last.end {
                    merged[merged.count - 1].end = segment.end
                }
            } else {
                merged.append(segment)
            }
        }
        return merged
    }

    /// 定時檢查：播放位置 time 在還沒處理過的片段裡面時，回傳要跳到哪裡；不用跳時回傳 nil。
    /// duration 是影片長度（秒；不知道時傳 .nan）。跳過之後由呼叫的一方把片段標成處理過（SkipState.markHandled）。
    /// 使用者自己跳進片段裡時，呼叫的一方先用 SkipState.userSeeked 標成處理過，這裡就不會跳。
    public static func check(_ segments: [SponsorSegment], state: SkipState, time: Double, duration: Double) -> SkipAction? {
        guard time.isFinite else { return nil }
        guard let segment = segments.first(where: {
            !state.handled.contains($0.id) && time >= $0.start && time < $0.end - minRemainingSeconds
        }) else { return nil }
        let known = duration.isFinite && duration > 0
        let target = known && segment.end >= duration - endMarginSeconds ? duration : segment.end
        return SkipAction(segment: segment, target: target)
    }

    /// 跳過提示的文字，例如「已跳過業配」。
    public static func skippedLabel(_ category: SponsorCategory) -> String {
        "已跳過\(category.label)"
    }

    /// 這個時間在哪一個片段裡（進度條預覽顯示類別用）；不在任何片段裡時回傳 nil。
    public static func segment(at time: Double, in segments: [SponsorSegment]) -> SponsorSegment? {
        segments.first { time >= $0.start && time < $0.end }
    }

    /// 進度條色塊的比例位置；影片長度不知道時沒有色塊。超出影片長度的部分截掉。
    public static func marks(_ segments: [SponsorSegment], duration: Double) -> [SegmentMark] {
        guard duration.isFinite, duration > 0 else { return [] }
        return segments.compactMap { segment in
            let start = min(1, max(0, segment.start / duration))
            let end = min(1, max(0, segment.end / duration))
            return end > start ? SegmentMark(start: start, end: end, category: segment.category) : nil
        }
    }

    // MARK: 設定檔（settings.json 的 sponsorBlock 欄位）

    /// 讀設定；沒有這個欄位或格式不對時用預設值，不認得的類別忽略。
    public static func normalizeSettings(_ raw: Any?) -> SponsorBlockSettings {
        let defaults = SponsorBlockSettings()
        guard let object = JSON.object(raw) else { return defaults }
        let categories = JSON.array(object["categories"]).map { list in
            Set(list.compactMap { JSON.string($0).flatMap(SponsorCategory.init(rawValue:)) })
        }
        return SponsorBlockSettings(
            enabled: JSON.bool(object["enabled"]) ?? defaults.enabled,
            categories: categories ?? defaults.categories
        )
    }

    /// 類別依定義的順序輸出。
    public static func encodeSettings(_ settings: SponsorBlockSettings) -> [String: Any] {
        [
            "enabled": settings.enabled,
            "categories": SponsorCategory.allCases.filter { settings.categories.contains($0) }.map(\.rawValue)
        ]
    }
}
