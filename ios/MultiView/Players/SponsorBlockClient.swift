import Foundation
import MultiViewCore

/// 向 SponsorBlock 要片段（R161），對照 Android 版的 SponsorBlockClient.kt。
/// 用隱私版 API（只送影片 ID 雜湊的前 4 碼）。一律要全部的類別，依設定過濾由 `SponsorBlockRules.select` 處理。
/// 同一部影片在 App 執行期間只抓一次（記憶體快取，好幾格同一部影片也共用同一個請求）；
/// 失敗、逾時當作沒有片段，不放進快取（下次建立播放器時再試）。
@MainActor
enum SponsorBlockClient {
    /// 進行中或已經完成的請求。結果是 nil 表示失敗（已經從這裡拿掉）。
    private static var requests: [String: Task<[SponsorSegment]?, Never>] = [:]

    /// 連線、等待、讀取全部加起來最多 5 秒。
    private nonisolated static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = SponsorBlockRules.timeoutSeconds
        configuration.timeoutIntervalForResource = SponsorBlockRules.timeoutSeconds
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpAdditionalHeaders = ["User-Agent": "MultiView"]
        return URLSession(configuration: configuration)
    }()

    /// 這部影片的片段（還沒依設定過濾）；沒有、失敗或逾時時是空的。
    /// 呼叫的一方被取消時，共用的請求不取消（其他格子可能在等；最多 5 秒、只有幾 KB）。
    static func segments(videoID: String) async -> [SponsorSegment] {
        let request: Task<[SponsorSegment]?, Never>
        if let existing = requests[videoID] {
            request = existing
        } else {
            request = Task.detached(priority: .utility) { await fetch(videoID: videoID) }
            requests[videoID] = request
        }
        let result = await request.value
        if result == nil, requests[videoID] == request {
            // 失敗的不留在快取裡
            requests[videoID] = nil
        }
        return result ?? []
    }

    /// 成功時回傳片段（404 是沒有片段，回傳空的）；其他情況回傳 nil。
    private nonisolated static func fetch(videoID: String) async -> [SponsorSegment]? {
        guard let url = URL(string: SponsorBlockRules.requestURL(videoID)) else { return nil }
        guard let (data, response) = try? await session.data(from: url),
              let status = (response as? HTTPURLResponse)?.statusCode
        else { return nil }
        switch status {
        case 200:
            return SponsorBlockRules.parse(String(decoding: data, as: UTF8.self), videoID: videoID)
        case 404:
            return []
        default:
            return nil
        }
    }
}
