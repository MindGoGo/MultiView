import CryptoKit
import Foundation
import MultiViewCore

/// yt-dlp 的自動更新（R136）。
/// App 內附一份 yt-dlp；這裡從 yt-dlp 的 GitHub Releases 下載最新穩定版的 `yt-dlp` 檔（zip 格式的 Python 程式），
/// 用官方的 SHA2-256SUMS 驗證後放在 App 資料夾。已經載入的 yt-dlp 不能在執行中換掉，新版在下次開啟 App 時生效。
actor YtDlpUpdater {
    static let shared = YtDlpUpdater()

    enum Outcome: Equatable {
        /// 下載了新版；重新開啟 App 後生效。
        case updated(String)
        /// 已經是最新版。
        case latest(String)
        case failed(String)

        /// 手動更新完成後的提示（R93）。
        var message: String {
            switch self {
            case .updated(let version): return "yt-dlp 已下載 \(version)，重新開啟 App 後生效"
            case .latest: return "yt-dlp 已經是最新版"
            case .failed(let reason): return "yt-dlp 更新失敗：\(reason)"
            }
        }
    }

    private static let latestReleaseURL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    private static let assetName = "yt-dlp"
    private static let sumsName = "SHA2-256SUMS"

    private var running: Task<Outcome, Never>?
    private var lastFailureUpdate: Double = 0
    /// 這次開啟 App 之後下載的版本（還沒生效）。
    private(set) var pendingVersion: String?

    // MARK: 檔案位置

    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("MultiView/bin", isDirectory: true)
    }

    /// 下載的新版 yt-dlp。
    static var archiveURL: URL { directory.appendingPathComponent("yt-dlp.zip") }
    private static var recordURL: URL { directory.appendingPathComponent("update.json") }

    private static var appVersion: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    }

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }

    private static func loadRecord() -> YtDlpUpdateRecord {
        YtDlpUpdateRecord.parse(try? String(contentsOf: recordURL, encoding: .utf8))
    }

    private static func save(_ record: YtDlpUpdateRecord) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? Data(record.encoded().utf8).write(to: recordURL, options: .atomic)
    }

    /// 啟動 Python 之前呼叫：回傳要優先載入的新版 yt-dlp 的路徑，沒有時回傳 nil。
    /// App 的版本換了的時候，內附的 yt-dlp 可能比較新，所以丟掉下載的那一份，之後再重新檢查更新。
    static func archivePathForLaunch() -> String? {
        var record = loadRecord()
        if record.appVersion != appVersion {
            try? FileManager.default.removeItem(at: archiveURL)
            record = YtDlpUpdateRecord(lastCheck: 0, appVersion: appVersion)
            save(record)
        }
        return FileManager.default.fileExists(atPath: archiveURL.path) ? archiveURL.path : nil
    }

    /// 下載的新版載入失敗（Python 回報沒有用到它）：刪掉，下次重新下載。
    static func discardArchive() {
        try? FileManager.default.removeItem(at: archiveURL)
        var record = loadRecord()
        record.lastCheck = 0
        save(record)
    }

    // MARK: 更新

    /// 開啟 App 時：距離上次檢查超過 24 小時才檢查（R92 時機 1）。低數據模式時不下載。
    func autoUpdateIfNeeded() async -> Outcome? {
        guard YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdater.loadRecord(), now: YtDlpUpdater.now) else { return nil }
        return await update(allowConstrainedNetwork: false)
    }

    /// 解析失敗、而且看起來是 yt-dlp 太舊時：10 分鐘內只更新一次（R92 時機 2）。
    func updateAfterFailure(_ message: String) async -> Outcome? {
        guard YtDlpUpdateRules.isOutdatedError(message),
              YtDlpUpdater.now - lastFailureUpdate >= YtDlpUpdateRules.failureUpdateInterval
        else { return nil }
        lastFailureUpdate = YtDlpUpdater.now
        return await update(allowConstrainedNetwork: false)
    }

    /// 檢查並下載新版。同一時間只進行一個更新，同時的要求共用同一次的結果。
    func update(allowConstrainedNetwork: Bool) async -> Outcome {
        if let running {
            return await running.value
        }
        let task = Task { await YtDlpUpdater.perform(allowConstrainedNetwork: allowConstrainedNetwork) }
        running = task
        let outcome = await task.value
        running = nil
        if case .updated(let version) = outcome {
            pendingVersion = version
        }
        return outcome
    }

    private static func perform(allowConstrainedNetwork: Bool) async -> Outcome {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.allowsConstrainedNetworkAccess = allowConstrainedNetwork
        configuration.timeoutIntervalForRequest = 30
        configuration.httpAdditionalHeaders = ["User-Agent": "MultiView-iOS", "Accept": "application/vnd.github+json"]
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        do {
            // 目前用的版本
            let versions = try await PythonRuntime.shared.call("versions")
            let info = (try? JSONSerialization.jsonObject(with: Data(versions.utf8))) as? [String: Any]
            guard let current = (info?["yt_dlp"] as? String).flatMap(YtDlpVersion.parse) else {
                return .failed("讀不到目前的版本")
            }

            // 最新的穩定版
            let release = try await fetch(latestReleaseURL, session: session)
            let json = (try? JSONSerialization.jsonObject(with: release)) as? [String: Any]
            guard let tag = json?["tag_name"] as? String, let latest = YtDlpVersion.parse(tag) else {
                return .failed("讀不到最新的版本")
            }

            var record = loadRecord()
            record.lastCheck = now
            record.appVersion = appVersion
            guard YtDlpVersion.compare(latest, current) > 0 else {
                save(record)
                return .latest(current)
            }

            // 下載並用官方的雜湊值驗證
            let base = "https://github.com/yt-dlp/yt-dlp/releases/download/\(tag)/"
            let sums = String(data: try await fetch(base + sumsName, session: session), encoding: .utf8) ?? ""
            guard let expected = YtDlpUpdateRules.checksum(for: assetName, in: sums) else {
                return .failed("找不到雜湊值")
            }
            let archive = try await fetch(base + assetName, session: session)
            let actual = SHA256.hash(data: archive).map { String(format: "%02x", $0) }.joined()
            guard actual == expected else {
                return .failed("下載的檔案雜湊值不符")
            }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try archive.write(to: archiveURL, options: .atomic)
            save(record)
            return .updated(latest)
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private static func fetch(_ address: String, session: URLSession) async throws -> Data {
        guard let url = URL(string: address) else { throw URLError(.badURL) }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}
