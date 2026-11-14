import Foundation
import MultiViewCore
import Observation

/// 訂閱頻道的最新影片與直播狀態（R59、R60、R142）。不保存，每次開啟時重新讀取。
///
/// 最新影片先讀 YouTube 的 RSS 摘要；摘要回傳錯誤時（2026-11 實測對 App 一律 404）改用 yt-dlp 讀頻道的影片列表。
/// yt-dlp 比較慢，而且和播放用的解析共用同一個 Python，所以一次只讀一個頻道，展開的頻道優先。
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
        /// 最新影片還在讀取（排隊等 yt-dlp）。
        var videosLoading = false
        /// 上次讀取失敗（顯示「無法取得最新影片」）。
        var failed = false
        /// 失敗的原因，例如「HTTP 404」；顯示在訊息後面，方便回報問題。
        var failure: String?
    }

    private(set) var feeds: [String: Feed] = [:]

    /// 同時最多讀取幾個頻道的 RSS 與直播頁。
    private static let concurrency = 4
    /// 用 yt-dlp 讀的最新影片數量。
    private static let videoCount = 15

    @ObservationIgnored private var queue: [String] = []
    @ObservationIgnored private var running = 0
    /// RSS 摘要不能用（回傳 404）：之後直接用 yt-dlp。
    @ObservationIgnored private var rssUnavailable = false
    @ObservationIgnored private var videoQueue: [String] = []
    @ObservationIgnored private var videoRunning = false
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

    private var cacheDirectory: String {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        return caches?.appendingPathComponent("yt-dlp").path ?? ""
    }

    var anyLoading: Bool {
        feeds.values.contains { $0.loading || $0.videosLoading }
    }

    /// 讀取這些頻道的最新影片與直播狀態。force 為 false 時，15 分鐘內讀過的不重複讀取。
    func load(_ ids: [String], force: Bool) {
        let now = Date().timeIntervalSince1970 * 1000
        for id in ids {
            let feed = feeds[id] ?? Feed()
            if feed.loading || feed.videosLoading { continue }
            if !force, feed.loadedAt > 0, now - feed.loadedAt < YouTubeFeed.refreshInterval { continue }
            var next = feed
            next.loading = true
            feeds[id] = next
            queue.append(id)
        }
        pump()
    }

    /// 展開頻道時呼叫：還在排隊讀最新影片的話，移到最前面。
    func prioritize(_ id: String) {
        guard let index = videoQueue.firstIndex(of: id), index > 0 else { return }
        videoQueue.remove(at: index)
        videoQueue.insert(id, at: 0)
    }

    func forget(_ id: String) {
        feeds[id] = nil
        queue.removeAll { $0 == id }
        videoQueue.removeAll { $0 == id }
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

    // MARK: RSS 與直播頁

    private func pump() {
        while running < SubscriptionStore.concurrency, !queue.isEmpty {
            let id = queue.removeFirst()
            running += 1
            Task { [weak self] in
                await self?.fetchFeed(id)
                self?.running -= 1
                self?.pump()
            }
        }
    }

    private func fetchFeed(_ id: String) async {
        async let liveText = fetchText(YouTubeFeed.liveURL(channelID: id))
        var videos: [FeedVideo]?
        if !rssUnavailable {
            videos = await fetchRSS(id)
        }
        let live = await liveText.flatMap { YouTubeFeed.parseLiveStatus(html: $0) }

        // 讀取期間頻道被移除了
        guard var feed = feeds[id] else { return }
        feed.loading = false
        feed.live = live
        if let videos {
            feed.videos = videos
            feed.failed = false
            feed.failure = nil
            feed.loadedAt = Date().timeIntervalSince1970 * 1000
        } else {
            // 改用 yt-dlp 讀最新影片
            feed.videosLoading = true
            videoQueue.append(id)
        }
        feeds[id] = feed
        pumpVideos()
    }

    /// 依序嘗試每一個摘要網址；都不能用時回傳 nil。全部都是 404 時之後不再試 RSS。
    private func fetchRSS(_ id: String) async -> [FeedVideo]? {
        var all404 = true
        for address in YouTubeFeed.feedURLs(channelID: id) {
            let result = await fetchPage(address)
            if let text = result.text, let videos = YouTubeFeed.parseFeed(xml: text) {
                return videos
            }
            if result.problem != "HTTP 404" {
                all404 = false
            }
        }
        if all404 {
            rssUnavailable = true
        }
        return nil
    }

    // MARK: yt-dlp

    private func pumpVideos() {
        guard !videoRunning, !videoQueue.isEmpty else { return }
        let id = videoQueue.removeFirst()
        videoRunning = true
        Task { [weak self] in
            await self?.fetchVideos(id)
            self?.videoRunning = false
            self?.pumpVideos()
        }
    }

    private func fetchVideos(_ id: String) async {
        let request: [String: Any] = ["channel_id": id, "count": SubscriptionStore.videoCount, "cache_dir": cacheDirectory]
        let result: Result<[FeedVideo], YtDlpRules.ResolveError>
        do {
            let argument = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8) ?? "{}"
            let output = try await PythonRuntime.shared.call("channel_videos", argument: argument)
            result = YouTubeFeed.parseChannelVideos(output)
        } catch {
            result = .failure(YtDlpRules.ResolveError(message: error.localizedDescription))
        }

        guard var feed = feeds[id] else { return }
        feed.videosLoading = false
        feed.loadedAt = Date().timeIntervalSince1970 * 1000
        switch result {
        case .success(let videos):
            feed.videos = videos
            feed.failed = false
            feed.failure = nil
        case .failure(let error):
            feed.failed = true
            feed.failure = String(error.message.prefix(80))
        }
        feeds[id] = feed
    }
}
