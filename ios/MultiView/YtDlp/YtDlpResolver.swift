import Foundation
import MultiViewCore

/// 用 yt-dlp 把網址解析成串流（R135）。
/// 同時最多解析 2 個，其他排隊；同一個網址還沒過期的結果直接沿用。
actor YtDlpResolver {
    static let shared = YtDlpResolver()

    private static let maxConcurrent = 2

    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var cache: [String: YtStream] = [:]

    private var cacheDirectory: String {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        return caches?.appendingPathComponent("yt-dlp").path ?? ""
    }

    /// 解析網址。失敗時丟出 YtDlpRules.ResolveError 或 PythonError。
    func resolve(_ url: String) async throws -> YtStream {
        let now = Date().timeIntervalSince1970 * 1000
        if let cached = cache[url], YtDlpRules.isUsable(cached, now: now) {
            return cached
        }

        await acquire()
        defer { release() }

        let request: [String: Any] = ["url": url, "verbose": false, "cache_dir": cacheDirectory]
        let argument = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8) ?? "{}"
        let output = try await PythonRuntime.shared.call("resolve", argument: argument)
        let stream = try YtDlpRules.stream(fromResolveOutput: output, now: Date().timeIntervalSince1970 * 1000).get()
        // 直播的串流不沿用：重新載入時要拿最新的
        if !stream.isLive {
            cache[url] = stream
        }
        return stream
    }

    /// 播放失敗時呼叫：下次重新解析。
    func forget(_ url: String) {
        cache[url] = nil
    }

    private func acquire() async {
        if running < YtDlpResolver.maxConcurrent {
            running += 1
            return
        }
        await withCheckedContinuation { continuation in
            waiting.append(continuation)
        }
    }

    private func release() {
        if waiting.isEmpty {
            running -= 1
        } else {
            // 名額直接交給下一個排隊的
            waiting.removeFirst().resume()
        }
    }
}
