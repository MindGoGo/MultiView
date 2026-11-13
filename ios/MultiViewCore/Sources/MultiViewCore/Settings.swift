import Foundation

/// 設定檔的資料結構與驗證（桌面版 R10；iOS 版 R134）。由 `src/lib/settings.ts` 改寫。
/// 檔案格式和桌面版相同；iOS 不用的欄位（視窗位置、置頂、YouTube 小視窗的位置）不寫入，讀到也忽略。

/// 保存在設定檔裡的一個來源。
public struct SavedSource: Equatable, Sendable {
    public var url: String
    public var muted: Bool
    public var volume: Int
    /// 廣告阻擋（R17）；舊的設定檔沒有這個欄位時視為開啟。
    public var adblock: Bool
    public var quality: Quality
    public var captions: String?
    public var audioLang: String?
    public var brightness: Int
    public var youtubeWeb: Bool
    /// 觀看進度（秒，R55）；nil 時從頭開始。
    public var position: Double?
    public var backURL: String?
    public var pageAdblock: Bool

    public init(
        url: String,
        muted: Bool = false,
        volume: Int = Volume.default,
        adblock: Bool = true,
        quality: Quality = .auto,
        captions: String? = nil,
        audioLang: String? = nil,
        brightness: Int = Brightness.default,
        youtubeWeb: Bool = false,
        position: Double? = nil,
        backURL: String? = nil,
        pageAdblock: Bool = true
    ) {
        self.url = url
        self.muted = muted
        self.volume = volume
        self.adblock = adblock
        self.quality = quality
        self.captions = captions
        self.audioLang = audioLang
        self.brightness = brightness
        self.youtubeWeb = youtubeWeb
        self.position = position
        self.backURL = backURL
        self.pageAdblock = pageAdblock
    }
}

/// 每一組（直播、一般影片）的播放方式（R88）。
public enum PlayMethod: String, Sendable {
    case embed, ytdlp
}

public struct YouTubeMethods: Equatable, Sendable {
    public var live: PlayMethod
    public var vod: PlayMethod

    public init(live: PlayMethod = .embed, vod: PlayMethod = .embed) {
        self.live = live
        self.vod = vod
    }

    /// 兩組都是內嵌播放器時不執行 yt-dlp（R88）。
    public var needsResolve: Bool { live == .ytdlp || vod == .ytdlp }
}

/// 其他網站的播放方式（R102）：網頁或 yt-dlp。
public enum WebMethod: String, Sendable {
    case web, ytdlp
}

/// 清單面板上次的那一邊和分頁（R58）。
public struct ListTab: Equatable, Sendable {
    public enum Tab: String, Sendable {
        case subscriptions, favorites, history
    }

    public var group: ListGroup
    public var tab: Tab

    public init(group: ListGroup = .youtube, tab: Tab = .favorites) {
        self.group = group
        self.tab = tab
    }
}

public struct Settings: Equatable, Sendable {
    public var layout: LayoutID
    /// 每種版型各自的分隔線比例；沒有的版型用平均分配。
    public var ratios: [LayoutID: Ratios]
    /// 固定 9 個格位。
    public var slots: [SavedSource?]
    /// 總亮度（R41）。
    public var brightness: Int
    /// YouTube 無法嵌入時自動改用網頁播放（R49）。
    public var autoYoutubeWeb: Bool
    public var youtubeMethods: YouTubeMethods
    public var webMethod: WebMethod
    public var listTab: ListTab

    public init(
        layout: LayoutID = .default,
        ratios: [LayoutID: Ratios] = [:],
        slots: [SavedSource?] = Array(repeating: nil, count: SlotRules.count),
        brightness: Int = Brightness.default,
        autoYoutubeWeb: Bool = false,
        youtubeMethods: YouTubeMethods = YouTubeMethods(),
        webMethod: WebMethod = .web,
        listTab: ListTab = ListTab()
    ) {
        self.layout = layout
        self.ratios = ratios
        self.slots = slots
        self.brightness = brightness
        self.autoYoutubeWeb = autoYoutubeWeb
        self.youtubeMethods = youtubeMethods
        self.webMethod = webMethod
        self.listTab = listTab
    }

    /// 這個版型目前的比例。
    public func ratios(for layout: LayoutID) -> Ratios {
        ratios[layout] ?? Ratios.defaults(for: layout)
    }
}

public enum SettingsCodec {
    public static let version = 1

    /// 解析設定檔內容。JSON 錯誤或結構不對時 corrupt 為 true，settings 為預設值。
    /// 也用來匯入桌面版的設定檔（R144）：超過 iOS 範圍的音量、亮度會改成 iOS 的上限。
    public static func parse(_ text: String) -> (settings: Settings, corrupt: Bool) {
        guard let settings = normalize(JSON.parse(text)) else {
            return (Settings(), true)
        }
        return (settings, false)
    }

    /// 把讀到的 JSON 轉成合法設定；整體結構不對時回傳 nil（視為損毀）。個別欄位不合法時改用預設值。
    static func normalize(_ raw: Any?) -> Settings? {
        guard let object = JSON.object(raw), JSON.number(object["version"]) == Double(version) else { return nil }
        return normalizeView(object)
    }

    /// 只接受合法的版型、比例與來源；其餘換成預設值。
    static func normalizeView(_ raw: Any?) -> Settings {
        let object = JSON.object(raw) ?? [:]
        return Settings(
            layout: JSON.string(object["layout"]).flatMap(LayoutID.init(rawValue:)) ?? .default,
            ratios: normalizeRatios(object["ratios"]),
            slots: normalizeSlots(object["slots"]),
            brightness: Brightness.normalize(object["brightness"]),
            autoYoutubeWeb: JSON.bool(object["autoYoutubeWeb"]) == true,
            youtubeMethods: normalizeMethods(object["youtubeMethods"]),
            webMethod: JSON.string(object["webMethod"]) == "ytdlp" ? .ytdlp : .web,
            listTab: normalizeListTab(object["listTab"])
        )
    }

    /// 輸出成設定檔的文字。
    public static func encode(_ settings: Settings) -> String {
        var ratios: [String: Any] = [:]
        for (layout, value) in settings.ratios {
            ratios[layout.rawValue] = ["cols": value.cols, "rows": value.rows]
        }
        let slots: [Any] = (0..<SlotRules.count).map { index -> Any in
            guard index < settings.slots.count, let source = settings.slots[index] else { return NSNull() }
            return encodeSource(source)
        }
        let object: [String: Any] = [
            "version": version,
            "layout": settings.layout.rawValue,
            "ratios": ratios,
            "slots": slots,
            "brightness": settings.brightness,
            "autoYoutubeWeb": settings.autoYoutubeWeb,
            "youtubeMethods": ["live": settings.youtubeMethods.live.rawValue, "vod": settings.youtubeMethods.vod.rawValue],
            "webMethod": settings.webMethod.rawValue,
            "listTab": ["group": settings.listTab.group.rawValue, "tab": settings.listTab.tab.rawValue]
        ]
        return JSON.encode(object)
    }

    private static func encodeSource(_ source: SavedSource) -> [String: Any] {
        [
            "url": source.url,
            "muted": source.muted,
            "volume": source.volume,
            "adblock": source.adblock,
            "quality": source.quality.jsonValue,
            "captions": JSON.orNull(source.captions),
            "audioLang": JSON.orNull(source.audioLang),
            "brightness": source.brightness,
            "youtubeWeb": source.youtubeWeb,
            "position": JSON.orNull(source.position),
            "backUrl": JSON.orNull(source.backURL),
            "pageAdblock": source.pageAdblock
        ]
    }

    private static func normalizeRatios(_ raw: Any?) -> [LayoutID: Ratios] {
        guard let object = JSON.object(raw) else { return [:] }
        var out: [LayoutID: Ratios] = [:]
        for layout in LayoutID.allCases {
            guard let entry = JSON.object(object[layout.rawValue]),
                  let cols = numbers(entry["cols"]),
                  let rows = numbers(entry["rows"])
            else { continue }
            let ratios = Ratios(cols: cols, rows: rows)
            if ratios.isValid(for: layout) {
                out[layout] = ratios
            }
        }
        return out
    }

    /// 全部都是數字的陣列，否則 nil。
    private static func numbers(_ raw: Any?) -> [Double]? {
        guard let list = JSON.array(raw) else { return nil }
        var out: [Double] = []
        for item in list {
            guard let value = JSON.number(item) else { return nil }
            out.append(value)
        }
        return out
    }

    private static func normalizeSource(_ raw: Any?) -> SavedSource? {
        guard let object = JSON.object(raw),
              let url = JSON.string(object["url"]),
              SourceParser.parse(url) != nil
        else { return nil }
        let position = JSON.number(object["position"]).flatMap { $0 > 0 ? $0 : nil }
        let backURL = JSON.string(object["backUrl"]).flatMap { SourceParser.isYouTubeSite($0) ? $0 : nil }
        return SavedSource(
            url: url,
            muted: JSON.bool(object["muted"]) == true,
            volume: Volume.normalize(object["volume"]),
            adblock: JSON.bool(object["adblock"]) != false,
            quality: Quality.normalize(object["quality"]),
            captions: JSON.nonEmptyString(object["captions"]),
            audioLang: JSON.nonEmptyString(object["audioLang"]),
            brightness: Brightness.normalize(object["brightness"]),
            youtubeWeb: JSON.bool(object["youtubeWeb"]) == true,
            position: position,
            backURL: backURL,
            pageAdblock: JSON.bool(object["pageAdblock"]) != false
        )
    }

    private static func normalizeSlots(_ raw: Any?) -> [SavedSource?] {
        let list = JSON.array(raw) ?? []
        return (0..<SlotRules.count).map { index in
            index < list.count ? normalizeSource(list[index]) : nil
        }
    }

    private static func normalizeMethods(_ raw: Any?) -> YouTubeMethods {
        let object = JSON.object(raw) ?? [:]
        return YouTubeMethods(
            live: JSON.string(object["live"]) == "ytdlp" ? .ytdlp : .embed,
            vod: JSON.string(object["vod"]) == "ytdlp" ? .ytdlp : .embed
        )
    }

    private static func normalizeListTab(_ raw: Any?) -> ListTab {
        guard let object = JSON.object(raw),
              let group = JSON.string(object["group"]).flatMap(ListGroup.init(rawValue:)),
              let tab = JSON.string(object["tab"]).flatMap(ListTab.Tab.init(rawValue:))
        else { return ListTab() }
        // 訂閱只在 YouTube 那一邊（R59）
        if tab == .subscriptions, group != .youtube { return ListTab() }
        return ListTab(group: group, tab: tab)
    }
}

/// 設定和格子之間的轉換（R134）。
public enum SettingsBridge {
    /// 從設定檔還原格子：所有來源載入後維持暫停（R10 AC1），從上次的觀看進度開始（R55）。
    public static func restoreSlots(_ saved: [SavedSource?]) -> Slots {
        (0..<SlotRules.count).map { index -> CellSource? in
            guard index < saved.count, let source = saved[index],
                  let parsed = SourceParser.resolve(source.url, youtubeWeb: source.youtubeWeb)
            else { return nil }
            return CellSource(
                url: source.url,
                parsed: parsed,
                muted: source.muted,
                volume: source.volume,
                autoplay: false,
                adblock: source.adblock,
                record: false,
                quality: source.quality,
                captions: source.captions,
                audioLang: source.audioLang,
                brightness: source.brightness,
                youtubeWeb: source.youtubeWeb,
                resume: source.position,
                backURL: source.backURL,
                pageAdblock: source.pageAdblock
            )
        }
    }

    /// 把格子轉成要保存的來源。positions 是每一格目前的觀看進度（秒）；沒有的格子不保存進度。
    public static func saveSlots(_ slots: Slots, positions: [Int: Double] = [:]) -> [SavedSource?] {
        (0..<SlotRules.count).map { index -> SavedSource? in
            guard index < slots.count, let source = slots[index] else { return nil }
            let position = positions[index].flatMap { $0 > 0 && $0.isFinite ? $0 : nil }
            return SavedSource(
                url: source.url,
                muted: source.muted,
                volume: source.volume,
                adblock: source.adblock,
                quality: source.quality,
                captions: source.captions,
                audioLang: source.audioLang,
                brightness: source.brightness,
                youtubeWeb: source.youtubeWeb,
                position: position,
                backURL: source.backURL,
                pageAdblock: source.pageAdblock
            )
        }
    }
}
