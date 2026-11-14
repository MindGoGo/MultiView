import XCTest
@testable import MultiViewCore

/// 從 yt-dlp 的解析結果選出串流（R89、R103、R135）。測試案例參考桌面版 tests/unit/ytdlp.test.ts。
final class YtDlpTests: XCTestCase {
    private let now: Double = 1_794_000_000_000
    private let expireSeconds: Double = 1_794_597_314

    private var manifest: String {
        "https://manifest.googlevideo.com/api/manifest/hls_variant/expire/\(Int(expireSeconds))/ei/x/file/index.m3u8"
    }

    /// iPhone 上實測到的一般影片（2026-11-13）：HLS 有主清單，另外有分開的影像、聲音，和影音合一的 18。
    private var vodFormats: [[String: Any]] {
        [
            ["format_id": "sb0", "ext": "mhtml", "protocol": "mhtml", "vcodec": "none", "acodec": "none", "url": "https://i.ytimg.com/sb"],
            ["format_id": "233", "ext": "mp4", "protocol": "m3u8_native", "vcodec": "none", "manifest_url": manifest, "url": "https://x/233.m3u8"],
            ["format_id": "140", "ext": "m4a", "protocol": "https", "vcodec": "none", "acodec": "mp4a.40.2", "url": "https://x/videoplayback?itag=140"],
            ["format_id": "232", "ext": "mp4", "protocol": "m3u8_native", "height": 720, "vcodec": "avc1.4D401F", "acodec": "none", "manifest_url": manifest, "url": "https://x/232.m3u8"],
            ["format_id": "136", "ext": "mp4", "protocol": "https", "height": 720, "vcodec": "avc1.4D401F", "acodec": "none", "url": "https://x/videoplayback?itag=136"],
            ["format_id": "18", "ext": "mp4", "protocol": "https", "height": 360, "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "url": "https://x/videoplayback?itag=18&expire=\(Int(expireSeconds))"]
        ]
    }

    private func info(_ formats: [[String: Any]], _ extra: [String: Any] = [:]) -> [String: Any] {
        var info: [String: Any] = ["title": "標題 2026-11-13 12:00", "fulltitle": "標題", "formats": formats]
        for (key, value) in extra { info[key] = value }
        return info
    }

    func testVodPrefersHLSManifest() {
        let stream = YtDlpRules.pickStream(info: info(vodFormats, ["live_status": "not_live", "is_live": false]), now: now)
        XCTAssertEqual(stream?.kind, .hls)
        XCTAssertEqual(stream?.url, manifest)
        XCTAssertEqual(stream?.isLive, false)
        XCTAssertEqual(stream?.title, "標題")
        XCTAssertEqual(stream?.expiresAt, expireSeconds * 1000)
    }

    func testLiveUsesHLS() {
        let stream = YtDlpRules.pickStream(info: info(vodFormats, ["is_live": true]), now: now)
        XCTAssertEqual(stream?.kind, .hls)
        XCTAssertEqual(stream?.isLive, true)
        XCTAssertEqual(YtDlpRules.pickStream(info: info(vodFormats, ["live_status": "is_live"]), now: now)?.isLive, true)
    }

    func testVodWithoutHLSUsesFormat18() {
        let formats = vodFormats.filter { ($0["protocol"] as? String) != "m3u8_native" }
        let stream = YtDlpRules.pickStream(info: info(formats), now: now)
        XCTAssertEqual(stream?.kind, .mp4)
        XCTAssertEqual(stream?.url.contains("itag=18"), true)
        XCTAssertEqual(stream?.expiresAt, expireSeconds * 1000)
    }

    func testOtherSitesUseBestPlayableMuxedFormat() {
        let formats: [[String: Any]] = [
            ["format_id": "low", "ext": "mp4", "protocol": "https", "height": 360, "url": "https://x/low.mp4"],
            ["format_id": "avi", "ext": "avi", "protocol": "https", "height": 1080, "url": "https://x/high.avi"],
            ["format_id": "webm", "ext": "webm", "protocol": "https", "height": 1080, "url": "https://x/high.webm"],
            ["format_id": "high", "ext": "mp4", "protocol": "https", "height": 720, "url": "https://x/high.mp4"],
            ["format_id": "audio", "ext": "mp4", "protocol": "https", "vcodec": "none", "url": "https://x/audio.mp4"]
        ]
        let stream = YtDlpRules.pickStream(info: info(formats), now: now)
        // 原生播放器不能播 avi、webm；沒有標示編碼的格式當作影音合一
        XCTAssertEqual(stream?.url, "https://x/high.mp4")
        XCTAssertEqual(stream?.expiresAt, now + YtDlpRules.defaultExpiry)
    }

    func testHLSWithoutManifestUsesLastVideoFormat() {
        let formats: [[String: Any]] = [
            ["format_id": "a", "protocol": "m3u8_native", "vcodec": "none", "url": "https://x/audio.m3u8"],
            ["format_id": "v1", "protocol": "m3u8_native", "height": 480, "url": "https://x/480.m3u8"],
            ["format_id": "v2", "protocol": "m3u8", "height": 720, "url": "https://x/720.m3u8"]
        ]
        XCTAssertEqual(YtDlpRules.pickStream(info: info(formats), now: now)?.url, "https://x/720.m3u8")
    }

    func testNothingPlayable() {
        // 只有縮圖
        XCTAssertNil(YtDlpRules.pickStream(info: info([vodFormats[0]]), now: now))
        // 還沒開始的直播
        XCTAssertNil(YtDlpRules.pickStream(info: info([vodFormats[5]], ["live_status": "is_upcoming"]), now: now))
        // 直播只用 HLS
        XCTAssertNil(YtDlpRules.pickStream(info: info([vodFormats[5]], ["is_live": true]), now: now))
        XCTAssertNil(YtDlpRules.pickStream(info: nil, now: now))
        XCTAssertNil(YtDlpRules.pickStream(info: "text", now: now))
    }

    func testPostLiveUsesHLS() {
        let stream = YtDlpRules.pickStream(info: info(vodFormats, ["live_status": "post_live", "is_live": false]), now: now)
        XCTAssertEqual(stream?.kind, .hls)
        XCTAssertEqual(stream?.isLive, false)
    }

    func testPlaylistUsesFirstEntryWithFormats() {
        let playlist: [String: Any] = [
            "_type": "playlist",
            "entries": [["title": "沒有格式"], info(vodFormats)] as [Any]
        ]
        XCTAssertEqual(YtDlpRules.pickStream(info: playlist, now: now)?.url, manifest)
        XCTAssertNil(YtDlpRules.pickStream(info: ["_type": "playlist", "entries": [Any]()] as [String: Any], now: now))
    }

    func testHeadersKeepOnlyRefererAndUserAgent() {
        let formats: [[String: Any]] = [[
            "format_id": "v", "ext": "mp4", "protocol": "https", "url": "https://x/v.mp4",
            "http_headers": ["Referer": "https://site.example/", "User-Agent": "UA", "Cookie": "secret", "Accept": "*/*"]
        ]]
        XCTAssertEqual(
            YtDlpRules.pickStream(info: info(formats), now: now)?.headers,
            ["Referer": "https://site.example/", "User-Agent": "UA"]
        )
    }

    func testExpiry() {
        XCTAssertEqual(YtDlpRules.expiry(of: "https://x/videoplayback?expire=1794597314&a=1", now: now), 1_794_597_314_000)
        XCTAssertEqual(YtDlpRules.expiry(of: "https://x/videoplayback?a=1&expire=1794597314", now: now), 1_794_597_314_000)
        XCTAssertEqual(YtDlpRules.expiry(of: manifest, now: now), expireSeconds * 1000)
        XCTAssertEqual(YtDlpRules.expiry(of: "https://x/a.mp4", now: now), now + 5 * 60 * 60 * 1000)
        // 數字太短的不是時間
        XCTAssertEqual(YtDlpRules.expiry(of: "https://x/a?expire=123", now: now), now + YtDlpRules.defaultExpiry)
    }

    func testIsUsable() {
        let stream = YtStream(kind: .hls, url: manifest, isLive: true, title: nil, expiresAt: now + 60 * 60 * 1000)
        XCTAssertTrue(YtDlpRules.isUsable(stream, now: now))
        XCTAssertFalse(YtDlpRules.isUsable(stream, now: now + 55 * 60 * 1000))
    }

    func testStreamFromResolveOutput() throws {
        let ok = String(data: try JSONSerialization.data(withJSONObject: ["ok": true, "info": info(vodFormats), "log": [String]()] as [String: Any]), encoding: .utf8) ?? ""
        XCTAssertEqual(try YtDlpRules.stream(fromResolveOutput: ok, now: now).get().url, manifest)

        func error(_ text: String) -> String? {
            if case .failure(let error) = YtDlpRules.stream(fromResolveOutput: text, now: now) { return error.message }
            return nil
        }
        XCTAssertEqual(error("{\"ok\":false,\"error\":\"Video unavailable\"}"), "Video unavailable")
        XCTAssertEqual(error("{\"ok\":false}"), "yt-dlp 解析失敗")
        XCTAssertEqual(error("{\"ok\":true,\"info\":{\"formats\":[]}}"), "沒有可以播放的格式")
        XCTAssertEqual(error("not json"), "無法讀取 yt-dlp 的結果")
    }
}

/// yt-dlp 的版本比較與自動更新的判斷（R136）。
final class YtDlpUpdateTests: XCTestCase {
    func testParseVersion() {
        XCTAssertEqual(YtDlpVersion.parse("2026.10.26"), "2026.10.26")
        XCTAssertEqual(YtDlpVersion.parse(" 2026.1.5\n"), "2026.01.05")
        XCTAssertEqual(YtDlpVersion.parse("stable@2026.10.26.123456 from yt-dlp/yt-dlp"), "2026.10.26.123456")
        XCTAssertNil(YtDlpVersion.parse("1.2.3"))
        XCTAssertNil(YtDlpVersion.parse("沒有版本"))
        XCTAssertNil(YtDlpVersion.parse(""))
    }

    func testCompareVersion() {
        XCTAssertGreaterThan(YtDlpVersion.compare("2026.11.01", "2026.10.26"), 0)
        XCTAssertLessThan(YtDlpVersion.compare("2026.10.26", "2026.11.01"), 0)
        XCTAssertEqual(YtDlpVersion.compare("2026.10.26", "2026.10.26"), 0)
        XCTAssertGreaterThan(YtDlpVersion.compare("2026.10.26.1", "2026.10.26"), 0)
        XCTAssertGreaterThan(YtDlpVersion.compare("2027.01.01", "2026.12.31"), 0)
    }

    func testUpdateRecord() {
        XCTAssertEqual(YtDlpUpdateRecord.parse(nil), YtDlpUpdateRecord())
        XCTAssertEqual(YtDlpUpdateRecord.parse("{ broken"), YtDlpUpdateRecord())
        XCTAssertEqual(YtDlpUpdateRecord.parse("{\"lastCheck\":\"x\",\"appVersion\":3}"), YtDlpUpdateRecord())
        let record = YtDlpUpdateRecord(lastCheck: 1_794_000_000_000, appVersion: "0.0.9")
        XCTAssertEqual(YtDlpUpdateRecord.parse(record.encoded()), record)
    }

    func testShouldAutoUpdate() {
        let now: Double = 1_794_000_000_000
        let hour: Double = 60 * 60 * 1000
        XCTAssertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(), now: now))
        XCTAssertFalse(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(lastCheck: now - 23 * hour), now: now))
        XCTAssertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(lastCheck: now - 24 * hour), now: now))
        // 時間被往回調：上次檢查的時間在未來，當作要檢查
        XCTAssertTrue(YtDlpUpdateRules.shouldAutoUpdate(YtDlpUpdateRecord(lastCheck: now + hour), now: now))
    }

    func testIsOutdatedError() {
        XCTAssertTrue(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Unable to extract nsig function code"))
        XCTAssertTrue(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Signature extraction failed: please report this issue"))
        XCTAssertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Private video. Sign in if you've been granted access"))
        XCTAssertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: [youtube] abc: Video unavailable"))
        XCTAssertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: Unable to download API page: timed out; please report this issue"))
        XCTAssertFalse(YtDlpUpdateRules.isOutdatedError("ERROR: Unsupported URL: https://example.com/"))
        XCTAssertFalse(YtDlpUpdateRules.isOutdatedError("沒有可以播放的格式"))
    }

    func testChecksum() {
        let hash = String(repeating: "ab12", count: 16)
        let other = String(repeating: "0", count: 64)
        let sums = "\(other)  yt-dlp.exe\n\(hash.uppercased())  yt-dlp\n\(other) *yt-dlp_macos\nbad  yt-dlp.tar.gz\n"
        XCTAssertEqual(YtDlpUpdateRules.checksum(for: "yt-dlp", in: sums), hash)
        XCTAssertEqual(YtDlpUpdateRules.checksum(for: "yt-dlp_macos", in: sums), other)
        XCTAssertNil(YtDlpUpdateRules.checksum(for: "yt-dlp.tar.gz", in: sums))
        XCTAssertNil(YtDlpUpdateRules.checksum(for: "missing", in: sums))
    }
}
