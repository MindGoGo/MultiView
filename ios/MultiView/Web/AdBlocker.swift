import Foundation
import Observation
import WebKit

/// 網頁格子的廣告阻擋（規格 R138）：App 裡附的規則（EasyList 在編譯時轉成的 WebKit 內容阻擋規則）
/// 第一次開啟時編譯起來，之後沿用系統保存的結果。編譯完成前開啟的網頁格子先不擋。
@MainActor
@Observable
final class AdBlocker {
    static let shared = AdBlocker()

    /// 規則的準備狀態，顯示在設定畫面（R138）。
    enum Status: Equatable {
        case preparing
        /// loaded／total 份規則可以用；version 是 EasyList 的版本。
        case ready(loaded: Int, total: Int, rules: Int, version: String)
        /// App 裡沒有規則（編譯時沒有產生）。
        case unavailable
    }

    private(set) var status: Status = .preparing

    /// 編譯好的規則清單；還沒編譯好時是空的。
    @ObservationIgnored private(set) var lists: [WKContentRuleList] = []
    @ObservationIgnored private var preparing: Task<Void, Never>?
    @ObservationIgnored private var waiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var ready = false

    /// 其他網站裡內嵌的 YouTube 播放器不阻擋（桌面版 R17 AC4）。加在每一份清單的最後。
    private static let youtubeFrameException =
        #"{"trigger":{"url-filter":".*","if-frame-url":["^https?://([^/]*\\.)?youtube\\.com/","^https?://([^/]*\\.)?youtube-nocookie\\.com/"]},"action":{"type":"ignore-previous-rules"}}"#

    private struct Manifest: Decodable {
        struct Entry: Decodable {
            let name: String
            let file: String
        }

        let version: String
        let lists: [Entry]
    }

    private struct EntryRules: Decodable {
        let rules: Int?
    }

    private var folder: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("web/adblock", isDirectory: true)
    }

    /// 開啟 App 時在背景準備。
    func prepare() {
        guard preparing == nil else { return }
        preparing = Task { await load() }
    }

    /// 等規則準備好（最多等 timeout 秒），回傳目前可以用的清單。
    func listsWhenReady(timeout: Duration) async -> [WKContentRuleList] {
        prepare()
        if ready { return lists }
        let waiter = Task { @MainActor in
            await withCheckedContinuation { continuation in
                if ready {
                    continuation.resume()
                } else {
                    waiters.append(continuation)
                }
            }
        }
        let timer = Task {
            try? await Task.sleep(for: timeout)
        }
        // 先完成的那一個為準
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await waiter.value }
            group.addTask { await timer.value }
            await group.next()
            group.cancelAll()
        }
        timer.cancel()
        return lists
    }

    private func load() async {
        defer {
            ready = true
            waiters.forEach { $0.resume() }
            waiters = []
        }
        guard let folder,
              let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              let store = WKContentRuleListStore.default()
        else {
            status = .unavailable
            return
        }
        let ruleCounts = (try? JSONDecoder().decode(RuleCounts.self, from: data))?.lists.map { $0.rules ?? 0 } ?? []

        let prefix = "multiview-adblock-"
        let current = Set(manifest.lists.map { prefix + manifest.version + "-" + $0.name })
        // 刪掉舊版的規則
        if let existing = await store.availableIdentifiers() {
            for identifier in existing where identifier.hasPrefix(prefix) && !current.contains(identifier) {
                try? await store.removeContentRuleList(forIdentifier: identifier)
            }
        }

        var compiled: [WKContentRuleList] = []
        var rules = 0
        for (index, entry) in manifest.lists.enumerated() {
            let identifier = prefix + manifest.version + "-" + entry.name
            var list = try? await store.contentRuleList(forIdentifier: identifier)
            if list == nil, let json = try? String(contentsOf: folder.appendingPathComponent(entry.file), encoding: .utf8) {
                list = await compile(json, identifier: identifier, store: store)
            }
            if let list {
                compiled.append(list)
                rules += index < ruleCounts.count ? ruleCounts[index] : 0
            }
        }
        lists = compiled
        status = .ready(loaded: compiled.count, total: manifest.lists.count, rules: rules, version: manifest.version)
    }

    /// manifest.json 裡每一份清單的規則數。
    private struct RuleCounts: Decodable {
        let lists: [EntryRules]
    }

    /// 編譯一份清單；加上 YouTube 的例外失敗時，改成不加再試一次。這一份還是失敗就略過，不影響其他的。
    private func compile(_ json: String, identifier: String, store: WKContentRuleListStore) async -> WKContentRuleList? {
        let trimmed = json.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasSuffix("]") {
            let withException = String(trimmed.dropLast()) + "," + AdBlocker.youtubeFrameException + "]"
            if let list = try? await store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: withException) {
                return list
            }
        }
        return try? await store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: trimmed)
    }
}
