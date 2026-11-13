import Foundation

/// 格子裡的一個來源（桌面版 `src/lib/slots.ts` 的 Source）。
public struct CellSource: Equatable, Identifiable, Sendable {
    /// 每次放入新網址都換一個 id；畫面以 id 對應播放器，id 不變就不會重新載入。
    public let id: Int
    public var url: String
    public var parsed: ParsedSource
    public var muted: Bool
    public var volume: Int
    /// 載入後是否自動播放；從設定檔還原的來源為 false（R10 AC1）。
    public var autoplay: Bool
    /// 廣告阻擋，只用於網頁來源（R17）；跟著來源移動和保存。
    public var adblock: Bool
    /// 使用者放入的來源，第一次成功載入時記錄到歷史（R23）；自動還原時為 false。不保存。
    public var record: Bool
    /// 畫質（R24）；跟著來源移動和保存。
    public var quality: Quality
    /// 字幕的選擇，只用於 YouTube；nil 為關閉（R31）。
    public var captions: String?
    /// yt-dlp 播放時記住的語音語言；nil 為自動（R95）。
    public var audioLang: String?
    /// 亮度 20–100（%）（R130）。
    public var brightness: Int
    /// 改用 YouTube 網頁播放（R48）。
    public var youtubeWeb: Bool
    /// 載入時要跳到的位置（秒）：上次的觀看進度（R55）；從頭開始時為 nil。
    public var resume: Double?
    /// 從 YouTube 網站開啟時的來源頁面網址（R63）。
    public var backURL: String?
    /// YouTube 網頁模式的廣告阻擋（R70）。
    public var pageAdblock: Bool

    public init(
        id: Int = SourceID.next(),
        url: String,
        parsed: ParsedSource,
        muted: Bool = false,
        volume: Int = Volume.default,
        autoplay: Bool = true,
        adblock: Bool = true,
        record: Bool = false,
        quality: Quality = .auto,
        captions: String? = nil,
        audioLang: String? = nil,
        brightness: Int = Brightness.default,
        youtubeWeb: Bool = false,
        resume: Double? = nil,
        backURL: String? = nil,
        pageAdblock: Bool = true
    ) {
        self.id = id
        self.url = url
        self.parsed = parsed
        self.muted = muted
        self.volume = volume
        self.autoplay = autoplay
        self.adblock = adblock
        self.record = record
        self.quality = quality
        self.captions = captions
        self.audioLang = audioLang
        self.brightness = brightness
        self.youtubeWeb = youtubeWeb
        self.resume = resume
        self.backURL = backURL
        self.pageAdblock = pageAdblock
    }

    /// 取消靜音而且音量大於 0。
    public var isAudible: Bool { !muted && volume > 0 }

    /// 用網頁播放的來源（YouTube 內嵌播放器、網頁）。iOS 不讓兩個網頁同時出聲：
    /// 這類來源同一時間只有一格有聲音（R121 的實測結果、R128）。
    public var usesWebAudio: Bool { parsed.kind == .youtube || parsed.kind == .web }
}

/// 來源的 id：每次呼叫都給一個新的數字。
public enum SourceID {
    private static let lock = NSLock()
    private static var last = 0

    public static func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        last += 1
        return last
    }
}

/// 9 個固定格位（R4、R6）。移除來源時不往前遞補。
public typealias Slots = [CellSource?]

public enum SlotRules {
    public static let count = 9

    public static func empty() -> Slots {
        Array(repeating: nil, count: count)
    }

    /// 是否為顯示中的格位。單格全螢幕時（solo 為放大的格位）只有那一格顯示中，
    /// 其他都視為隱藏的來源（R20 共用定義）。
    public static func isVisible(_ index: Int, layout: LayoutID, solo: Int? = nil) -> Bool {
        if let solo { return index == solo }
        return index < layout.cellCount
    }

    public static func set(_ slots: Slots, _ index: Int, _ source: CellSource?) -> Slots {
        guard slots.indices.contains(index) else { return slots }
        var next = slots
        next[index] = source
        return next
    }

    /// 互換兩個格位的內容（R6）。
    public static func swap(_ slots: Slots, _ a: Int, _ b: Int) -> Slots {
        guard a != b, slots.indices.contains(a), slots.indices.contains(b) else { return slots }
        var next = slots
        next.swapAt(a, b)
        return next
    }

    /// 不在目前版型中、但有來源的格位數（R4 AC4）。
    public static func hiddenCount(_ slots: Slots, layout: LayoutID) -> Int {
        slots.enumerated().filter { index, source in
            source != nil && !isVisible(index, layout: layout)
        }.count
    }

    /// 第一個顯示中的空格（R21、R126）；沒有時回傳 nil。
    public static func firstEmptyVisible(_ slots: Slots, layout: LayoutID, solo: Int? = nil) -> Int? {
        slots.indices.first { slots[$0] == nil && isVisible($0, layout: layout, solo: solo) }
    }
}

/// 聲音規則（R7、R8、R128）。
public enum AudioRules {
    /// 新來源是否靜音：已經有顯示中的來源有聲音時就靜音（R7 AC1）。
    public static func initialMuted(_ slots: Slots, layout: LayoutID, solo: Int? = nil) -> Bool {
        slots.enumerated().contains { index, source in
            guard let source else { return false }
            return SlotRules.isVisible(index, layout: layout, solo: solo) && source.isAudible
        }
    }

    /// 獨占聲音：只有第 index 格取消靜音，其他全部靜音（R7 AC2）。點空白格不影響聲音。
    public static func focus(_ slots: Slots, _ index: Int) -> Slots {
        guard slots.indices.contains(index), slots[index] != nil else { return slots }
        return map(slots) { source, position in
            var next = source
            next.muted = position != index
            return next
        }
    }

    /// 喇叭按鈕：只切換這一格（R7 AC3）。
    /// 例外：用網頁播放的來源取消靜音時，其他用網頁播放的來源會靜音（iOS 的限制，R128）。
    public static func toggleMute(_ slots: Slots, _ index: Int) -> Slots {
        guard slots.indices.contains(index), let target = slots[index] else { return slots }
        let unmuting = target.muted
        return map(slots) { source, position in
            var next = source
            if position == index {
                next.muted.toggle()
            } else if unmuting, target.usesWebAudio, source.usesWebAudio {
                next.muted = true
            }
            return next
        }
    }

    /// 按喇叭取消靜音時，會不會讓其他格子跟著靜音（用來顯示提示）。
    public static func unmutingSilencesOthers(_ slots: Slots, _ index: Int) -> Bool {
        guard slots.indices.contains(index), let target = slots[index], target.muted, target.usesWebAudio else { return false }
        return slots.enumerated().contains { position, source in
            guard let source, position != index else { return false }
            return source.usesWebAudio && !source.muted
        }
    }

    /// 音量 0–100。
    public static func setVolume(_ slots: Slots, _ index: Int, _ volume: Double) -> Slots {
        let value = Volume.clamp(volume)
        return map(slots) { source, position in
            guard position == index else { return source }
            var next = source
            next.volume = value
            return next
        }
    }

    /// 全部靜音，音量設定不變（R8 AC3）。
    public static func muteAll(_ slots: Slots) -> Slots {
        map(slots) { source, _ in
            var next = source
            next.muted = true
            return next
        }
    }

    private static func map(_ slots: Slots, _ transform: (CellSource, Int) -> CellSource) -> Slots {
        slots.enumerated().map { index, source in
            source.map { transform($0, index) }
        }
    }
}
