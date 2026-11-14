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
        guard let url = URL(string: address),
              let (data, response) = try? await session.data(from: url),
              let http = response as? HTTPURLResponse, http.statusCode == 200
        else { return nil }
        return String(data: data, encoding: .utf8)
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
        async let feedText = fetchText(YouTubeFeed.feedURL(channelID: id))
        async let liveText = fetchText(YouTubeFeed.liveURL(channelID: id))
        let videos = await feedText.flatMap { YouTubeFeed.parseFeed(xml: $0) }
        let live = await liveText.flatMap { YouTubeFeed.parseLiveStatus(html: $0) }

        // 讀取期間頻道被移除了
        guard var feed = feeds[id] else { return }
        feed.loading = false
        feed.loadedAt = Date().timeIntervalSince1970 * 1000
        feed.failed = videos == nil
        if let videos {
            feed.videos = videos
        }
        feed.live = live
        feeds[id] = feed
    }
}
