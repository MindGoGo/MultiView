import Foundation

/// 最愛清單、歷史紀錄、訂閱頻道（桌面版 R21–R23、R58、R59；iOS 版 R141、R142）。
/// 由 `src/lib/lists.ts` 改寫，`lists.json` 的格式和桌面版相同。

public struct ListItem: Equatable, Sendable {
    public var url: String
    public var name: String
    /// 最愛：加入的時間；歷史：最後播放的時間（毫秒）。
    public var time: Double

    public init(url: String, name: String, time: Double) {
        self.url = url
        self.name = name
        self.time = time
    }
}

/// 訂閱的頻道（R59）。
public struct Channel: Equatable, Sendable {
    /// 頻道代碼：UC 開頭的 24 個字元。
    public var id: String
    public var name: String
    /// 頻道頁網址。
    public var url: String
    /// 加入的時間（毫秒）。
    public var time: Double

    public init(id: String, name: String, url: String, time: Double) {
        self.id = id
        self.name = name
        self.url = url
        self.time = time
    }

    public static func isID(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard bytes.count == 24, bytes[0] == UInt8(ascii: "U"), bytes[1] == UInt8(ascii: "C") else { return false }
        return bytes.dropFirst(2).allSatisfy(SourceParser.isIDCharacter)
    }

    public static func pageURL(id: String) -> String {
        "https://www.youtube.com/channel/\(id)"
    }
}

public struct Lists: Equatable, Sendable {
    public var favorites: [ListItem]
    public var history: [ListItem]
    public var channels: [Channel]

    public init(favorites: [ListItem] = [], history: [ListItem] = [], channels: [Channel] = []) {
        self.favorites = favorites
        self.history = history
        self.channels = channels
    }
}

public enum ListKind: Sendable {
    case favorites, history
}

/// 清單的兩邊（R58）：YouTube 影片與 YouTube 網站頁面、其他網站。
public enum ListGroup: String, Sendable {
    case youtube, other
}

public enum ListError: Error, Equatable, Sendable {
    case unsupported
    case duplicate
    case channelDuplicate

    /// 顯示給使用者的訊息（和桌面版相同）。
    public var message: String {
        switch self {
        case .unsupported: return "不支援的網址"
        case .duplicate: return "清單中已經有這個網址"
        case .channelDuplicate: return "已經訂閱這個頻道"
        }
    }
}

public enum ListRules {
    /// 歷史最多保留的筆數（R23）；YouTube 和其他網站各自計算（R58）。
    public static let historyMax = 200

    public static func group(of url: String) -> ListGroup {
        if case .youtube? = SourceParser.parse(url) { return .youtube }
        return SourceParser.isYouTubeSite(url) ? .youtube : .other
    }

    /// 以去掉前後空白後的完整網址比對（共用定義「網址比對」）。
    public static func sameURL(_ a: String, _ b: String) -> Bool {
        trim(a) == trim(b)
    }

    /// 影片名稱（共用定義）：標題 → mp4 / m3u8 的檔名 → 網址。
    public static func defaultName(url: String, title: String? = nil) -> String {
        if let title = title.map(trim), !title.isEmpty { return title }
        if let parsed = SourceParser.parse(url), parsed.kind == .mp4 || parsed.kind == .hls,
           let href = parsed.url, let webURL = WebURL(href) {
            let raw = webURL.lastPathComponent
            let file = raw.removingPercentEncoding ?? raw
            if !file.isEmpty { return file }
        }
        return trim(url)
    }

    // MARK: 最愛

    /// 加入最愛，排在最上面（R22）。
    public static func addFavorite(_ lists: Lists, url: String, name: String, now: Double) -> Result<Lists, ListError> {
        validate(lists.favorites, url: url, name: name).map { item in
            var next = lists
            next.favorites.insert(ListItem(url: item.url, name: item.name, time: now), at: 0)
            return next
        }
    }

    public static func isFavorite(_ lists: Lists, url: String) -> Bool {
        lists.favorites.contains { sameURL($0.url, url) }
    }

    public static func removeFavorite(_ lists: Lists, url: String) -> Lists {
        var next = lists
        next.favorites.removeAll { sameURL($0.url, url) }
        return next
    }

    // MARK: 編輯與刪除

    /// 編輯一筆的名稱和網址（R21）。
    public static func editItem(_ lists: Lists, kind: ListKind, index: Int, url: String, name: String) -> Result<Lists, ListError> {
        let items = self.items(lists, kind)
        guard items.indices.contains(index) else { return .success(lists) }
        return validate(items, url: url, name: name, except: index).map { item in
            var edited = items
            edited[index].url = item.url
            edited[index].name = item.name
            return replacing(lists, kind, with: edited)
        }
    }

    public static func deleteItem(_ lists: Lists, kind: ListKind, index: Int) -> Lists {
        var items = self.items(lists, kind)
        guard items.indices.contains(index) else { return lists }
        items.remove(at: index)
        return replacing(lists, kind, with: items)
    }

    // MARK: 歷史

    /// 記錄一次播放（R23）：同一個網址只留一筆，移到最上面並更新時間，名稱維持原本的；
    /// 超過 200 筆時刪掉最舊的。
    public static func recordHistory(_ lists: Lists, url: String, title: String?, now: Double) -> Lists {
        let trimmed = trim(url)
        var item: ListItem
        if let existing = lists.history.first(where: { sameURL($0.url, trimmed) }) {
            item = existing
            item.time = now
        } else {
            item = ListItem(url: trimmed, name: defaultName(url: trimmed, title: title), time: now)
        }
        let rest = lists.history.filter { !sameURL($0.url, trimmed) }
        var next = lists
        next.history = capPerGroup([item] + rest, max: historyMax)
        return next
    }

    /// 清除一邊的歷史（R58 AC3）。
    public static func clearHistory(_ lists: Lists, group: ListGroup) -> Lists {
        var next = lists
        next.history.removeAll { self.group(of: $0.url) == group }
        return next
    }

    // MARK: 訂閱

    /// 訂閱頻道（R59）。
    public static func addChannel(_ lists: Lists, id: String, name: String, url: String, now: Double) -> Result<Lists, ListError> {
        if lists.channels.contains(where: { $0.id == id }) { return .failure(.channelDuplicate) }
        var next = lists
        next.channels.append(Channel(id: id, name: name, url: url, time: now))
        return .success(next)
    }

    /// 一次加入多個頻道（R61），已經訂閱的略過。
    public static func addChannels(_ lists: Lists, _ channels: [Channel], now: Double) -> (lists: Lists, added: Int, skipped: Int) {
        var known = Set(lists.channels.map(\.id))
        var next = lists
        var added = 0
        for channel in channels where !known.contains(channel.id) {
            known.insert(channel.id)
            next.channels.append(Channel(id: channel.id, name: channel.name, url: channel.url, time: now))
            added += 1
        }
        return (next, added, channels.count - added)
    }

    public static func removeChannel(_ lists: Lists, id: String) -> Lists {
        var next = lists
        next.channels.removeAll { $0.id == id }
        return next
    }

    // MARK: 顯示

    /// 歷史的最後播放時間：`YYYY/MM/DD HH:mm`（R23）。
    public static func formatTime(_ time: Double, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: Date(timeIntervalSince1970: time / 1000))
        func pad(_ value: Int?) -> String {
            let text = String(value ?? 0)
            return text.count < 2 ? "0" + text : text
        }
        return "\(parts.year ?? 0)/\(pad(parts.month))/\(pad(parts.day)) \(pad(parts.hour)):\(pad(parts.minute))"
    }

    // MARK: 內部

    static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 每一邊只保留最新的 max 筆（清單已依時間由新到舊排列）。
    static func capPerGroup(_ items: [ListItem], max: Int) -> [ListItem] {
        var count: [ListGroup: Int] = [:]
        return items.filter { item in
            let group = self.group(of: item.url)
            count[group, default: 0] += 1
            return count[group, default: 0] <= max
        }
    }

    private static func items(_ lists: Lists, _ kind: ListKind) -> [ListItem] {
        kind == .favorites ? lists.favorites : lists.history
    }

    private static func replacing(_ lists: Lists, _ kind: ListKind, with items: [ListItem]) -> Lists {
        var next = lists
        if kind == .favorites {
            next.favorites = items
        } else {
            next.history = items
        }
        return next
    }

    /// 驗證網址與名稱；except 是編輯中的那一筆（不和自己比重複）。
    private static func validate(
        _ items: [ListItem], url: String, name: String, except: Int = -1
    ) -> Result<(url: String, name: String), ListError> {
        let trimmed = trim(url)
        guard SourceParser.parse(trimmed) != nil else { return .failure(.unsupported) }
        let duplicate = items.enumerated().contains { index, item in
            index != except && sameURL(item.url, trimmed)
        }
        if duplicate { return .failure(.duplicate) }
        // 名稱清空時用網址當名稱（R21）
        let cleanName = trim(name)
        return .success((trimmed, cleanName.isEmpty ? trimmed : cleanName))
    }
}

public enum ListsCodec {
    /// 讀取清單檔；JSON 格式錯誤或整體結構不對時視為損毀（R21 AC11）。
    public static func parse(_ text: String) -> (lists: Lists, corrupt: Bool) {
        guard let object = JSON.object(JSON.parse(text)) else { return (Lists(), true) }
        return (normalize(object), false)
    }

    /// 是不是 MultiView 的清單檔：至少有一個清單欄位是陣列（匯入時用，R144）。
    public static func looksLikeLists(_ text: String) -> Bool {
        guard let object = JSON.object(JSON.parse(text)) else { return false }
        return ["favorites", "history", "channels"].contains { JSON.array(object[$0]) != nil }
    }

    public static func encode(_ lists: Lists) -> String {
        func item(_ item: ListItem) -> [String: Any] {
            ["url": item.url, "name": item.name, "time": item.time]
        }
        let object: [String: Any] = [
            "favorites": lists.favorites.map(item),
            "history": lists.history.map(item),
            "channels": lists.channels.map { channel -> [String: Any] in
                ["id": channel.id, "name": channel.name, "url": channel.url, "time": channel.time]
            }
        ]
        return JSON.encode(object)
    }

    /// 只留下合法的項目（網址必須支援、不重複）；歷史每一邊最多 200 筆。
    static func normalize(_ object: [String: Any]) -> Lists {
        Lists(
            favorites: normalizeItems(object["favorites"]),
            history: ListRules.capPerGroup(normalizeItems(object["history"]), max: ListRules.historyMax),
            channels: normalizeChannels(object["channels"])
        )
    }

    private static func normalizeItems(_ raw: Any?) -> [ListItem] {
        guard let list = JSON.array(raw) else { return [] }
        var out: [ListItem] = []
        for entry in list {
            guard let object = JSON.object(entry),
                  let rawURL = JSON.string(object["url"]),
                  SourceParser.parse(rawURL) != nil,
                  !out.contains(where: { ListRules.sameURL($0.url, rawURL) })
            else { continue }
            let url = ListRules.trim(rawURL)
            let name = JSON.string(object["name"]).map(ListRules.trim) ?? ""
            out.append(ListItem(url: url, name: name.isEmpty ? url : name, time: JSON.number(object["time"]) ?? 0))
        }
        return out
    }

    /// 只留下合法、不重複的頻道（舊的清單檔沒有訂閱時為空）。
    private static func normalizeChannels(_ raw: Any?) -> [Channel] {
        guard let list = JSON.array(raw) else { return [] }
        var out: [Channel] = []
        for entry in list {
            guard let object = JSON.object(entry),
                  let id = JSON.string(object["id"]),
                  Channel.isID(id),
                  !out.contains(where: { $0.id == id })
            else { continue }
            let name = JSON.string(object["name"]).map(ListRules.trim) ?? ""
            out.append(Channel(
                id: id,
                name: name.isEmpty ? id : name,
                url: JSON.nonEmptyString(object["url"]) ?? Channel.pageURL(id: id),
                time: JSON.number(object["time"]) ?? 0
            ))
        }
        return out
    }
}

/// 匯入桌面版的清單（R144）：合併進目前的清單。
public enum ListsImport {
    public struct Summary: Equatable, Sendable {
        public var favoritesAdded = 0
        public var historyAdded = 0
        public var channelsAdded = 0

        /// 例如「最愛新增 12 筆、歷史新增 30 筆、訂閱新增 5 個頻道」。
        public var message: String {
            "最愛新增 \(favoritesAdded) 筆、歷史新增 \(historyAdded) 筆、訂閱新增 \(channelsAdded) 個頻道"
        }
    }

    public static func merge(current: Lists, imported: Lists) -> (lists: Lists, summary: Summary) {
        var next = current
        var summary = Summary()

        // 最愛：網址相同的視為同一筆，保留目前的名稱；其他的加在最後面。
        for item in imported.favorites where !next.favorites.contains(where: { ListRules.sameURL($0.url, item.url) }) {
            next.favorites.append(item)
            summary.favoritesAdded += 1
        }

        // 歷史：網址相同的保留最後播放時間比較新的那一筆，依時間重新排序，每一邊最多 200 筆。
        var history = current.history
        for item in imported.history {
            if let index = history.firstIndex(where: { ListRules.sameURL($0.url, item.url) }) {
                if item.time > history[index].time { history[index] = item }
            } else {
                history.append(item)
                summary.historyAdded += 1
            }
        }
        // 時間相同時維持原本的先後（sorted 不保證穩定，所以把原本的位置一起比）
        let sorted = history.enumerated().sorted { a, b in
            a.element.time != b.element.time ? a.element.time > b.element.time : a.offset < b.offset
        }.map(\.element)
        next.history = ListRules.capPerGroup(sorted, max: ListRules.historyMax)

        // 訂閱：頻道代碼相同的視為同一個，其他的加入。
        for channel in imported.channels where !next.channels.contains(where: { $0.id == channel.id }) {
            next.channels.append(channel)
            summary.channelsAdded += 1
        }
        return (next, summary)
    }
}
