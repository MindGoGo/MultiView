import Foundation
import MultiViewCore
import Observation

/// 訂閱頻道的最新影片與直播狀態（R59、R60、R142）。不保存，每次開啟時重新讀取。
@MainActor
@Observable
final class SubscriptionStore {
    struct Feed {
        /// 最新影片，新的在上面；還沒讀過時為 nil。
        var videos: [FeedVideo]?
        /// 正在直播的影片代碼；沒有直播或判斷不了時為 nil。
        var live: String?
        /// 上次讀取完成的時間（毫秒）。
        var loadedAt: Double = 0
        var loading = false
        /// 上次讀取失敗（顯示「無法取得最新影片」）。
        var failed = false
        /// 失敗的原因，例如「HTTP 404」；顯示在訊息後面，方便回報問題。
        var failure: String?
    }

    private(set) var feeds: [String: Feed] = [:]

    /// 同時最多讀取幾個頻道。
    private static let concurrency = 4

    @ObservationIgnored private var queue: [String] = []
    @ObservationIgnored private var running = 0
    @ObservationIgnored private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        // YouTube 對沒有瀏覽器識別的要求可能回傳不同的內容
        configuration.httpAdditionalHeaders = [
            "User-Agent": CompanionRules.desktopUserAgent,
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
        ]
        return URLSession(configuration: configuration)
    }()

    var anyLoading: Bool {
        feeds.values.contains { $0.loading }
    }

    /// 讀取這些頻道的最新影片與直播狀態。force 為 false 時，15 分鐘內讀過的不重複讀取。
    func load(_ ids: [String], force: Bool) {
        let now = Date().timeIntervalSince1970 * 1000
        for id in ids {
            let feed = feeds[id] ?? Feed()
            if feed.loading { continue }
            if !force, feed.loadedAt > 0, now - feed.loadedAt < YouTubeFeed.refreshInterval { continue }
            var next = feed
            next.loading = true
            feeds[id] = next
            queue.append(id)
        }
        pump()
    }

    func forget(_ id: String) {
        feeds[id] = nil
        queue.removeAll { $0 == id }
    }

    /// 讀取一個網頁的文字；失敗時回傳 nil。
    func fetchText(_ address: String) async -> String? {
        await fetchPage(address).text
    }

    /// 讀取一個網頁的文字；失敗時 text 是 nil，problem 是原因。
    private func fetchPage(_ address: String) async -> (text: String?, problem: String?) {
        guard let url = URL(string: address) else { return (nil, "網址錯誤") }
        do {
            let (data, response) = try await session.data(from: url)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { return (nil, "HTTP \(status)") }
            // 少數回應不是合法的 UTF-8：容許錯誤的位元組，不要整份丟掉
            return (String(decoding: data, as: UTF8.self), nil)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    /// 讀取頻道的最新影片：依序嘗試每一個摘要網址，都失敗時回傳原因。
    private func fetchVideos(_ id: String) async -> (videos: [FeedVideo]?, problem: String?) {
        var problems: [String] = []
        for address in YouTubeFeed.feedURLs(channelID: id) {
            let result = await fetchPage(address)
            if let text = result.text {
                if let videos = YouTubeFeed.parseFeed(xml: text) {
                    return (videos, nil)
                }
                problems.append("內容不是摘要（\(text.prefix(40).replacingOccurrences(of: "\n", with: " "))）")
            } else {
                problems.append(result.problem ?? "未知的錯誤")
            }
        }
        return (nil, problems.joined(separator: "；"))
    }

    private func pump() {
        while running < SubscriptionStore.concurrency, !queue.isEmpty {
            let id = queue.removeFirst()
            running += 1
            Task { [weak self] in
                await self?.fetch(id)
                self?.running -= 1
                self?.pump()
            }
        }
    }

    private func fetch(_ id: String) async {
        async let feedResult = fetchVideos(id)
        async let liveText = fetchText(YouTubeFeed.liveURL(channelID: id))
        let (videos, problem) = await feedResult
        let live = await liveText.flatMap { YouTubeFeed.parseLiveStatus(html: $0) }

        // 讀取期間頻道被移除了
        guard var feed = feeds[id] else { return }
        feed.loading = false
        feed.loadedAt = Date().timeIntervalSince1970 * 1000
        feed.failed = videos == nil
        feed.failure = problem
        if let videos {
            feed.videos = videos
        }
        feed.live = live
        feeds[id] = feed
    }
}
