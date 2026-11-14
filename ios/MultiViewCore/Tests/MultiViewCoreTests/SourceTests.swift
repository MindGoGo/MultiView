import XCTest
@testable import MultiViewCore

/// 網址解析（R2、R12、R57）。測試案例沿用桌面版 tests/unit/source.test.ts、web-source.test.ts。
final class SourceTests: XCTestCase {
    private let id = "jfKfPfyJRdk"

    func testYouTubeURLs() {
        let urls = [
            "https://www.youtube.com/watch?v=\(id)",
            "https://youtube.com/watch?v=\(id)",
            "https://m.youtube.com/watch?v=\(id)",
            "http://www.youtube.com/watch?v=\(id)",
            "https://youtu.be/\(id)",
            "https://www.youtube.com/live/\(id)",
            "https://www.youtube.com/embed/\(id)"
        ]
        for url in urls {
            XCTAssertEqual(SourceParser.parse(url), .youtube(videoID: id), url)
        }
    }

    func testYouTubeIgnoresOtherQueryItems() {
        XCTAssertEqual(SourceParser.parse("https://www.youtube.com/watch?v=\(id)&t=42s&list=PL123"), .youtube(videoID: id))
        XCTAssertEqual(SourceParser.parse("https://youtu.be/\(id)?si=abc&t=10"), .youtube(videoID: id))
    }

    func testTrimsWhitespace() {
        XCTAssertEqual(SourceParser.parse("  https://youtu.be/\(id)  "), .youtube(videoID: id))
        XCTAssertEqual(SourceParser.parse("\nhttps://youtu.be/\(id)\n"), .youtube(videoID: id))
    }

    func testHostIsCaseInsensitive() {
        XCTAssertEqual(SourceParser.parse("HTTPS://WWW.YouTube.com/watch?v=\(id)"), .youtube(videoID: id))
    }

    func testYoutuBeExtraPathIsRejected() {
        XCTAssertNil(SourceParser.parse("https://youtu.be/\(id)/extra"))
        XCTAssertNil(SourceParser.parse("https://youtu.be/"))
    }

    func testOtherYouTubePagesAreWebSources() {
        let urls = [
            "https://www.youtube.com/shorts/\(id)",
            "https://www.youtube.com/watch?list=PL123",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/@somechannel"
        ]
        for url in urls {
            XCTAssertEqual(SourceParser.parse(url)?.kind, .web, url)
            XCTAssertTrue(SourceParser.isYouTubeSite(url), url)
        }
    }

    func testLookalikeDomainsAreWebSources() {
        XCTAssertEqual(SourceParser.parse("https://notyoutube.com/watch?v=\(id)")?.kind, .web)
        XCTAssertEqual(SourceParser.parse("https://youtube.com.evil.example/watch")?.kind, .web)
        XCTAssertFalse(SourceParser.isYouTubeSite("https://notyoutube.com/watch?v=\(id)"))
        XCTAssertFalse(SourceParser.isYouTubeSite("https://youtube.com.evil.example/watch"))
    }

    func testDirectLinks() {
        XCTAssertEqual(
            SourceParser.parse("https://cdn.example.com/live/index.m3u8"),
            .hls(url: "https://cdn.example.com/live/index.m3u8")
        )
        XCTAssertEqual(SourceParser.parse("http://example.com/a/b.mp4"), .mp4(url: "http://example.com/a/b.mp4"))
    }

    func testDirectLinkExtensionIsCaseInsensitiveAndAllowsQuery() {
        XCTAssertEqual(SourceParser.parse("https://x.com/v/STREAM.M3U8?token=abc")?.kind, .hls)
        XCTAssertEqual(SourceParser.parse("https://x.com/v/Clip.MP4?x=1#t=5")?.kind, .mp4)
        XCTAssertEqual(
            SourceParser.parse("https://x.com/v/Clip.MP4?x=1#t=5")?.url,
            "https://x.com/v/Clip.MP4?x=1#t=5"
        )
    }

    func testExtensionOnlyInQueryIsWebSource() {
        XCTAssertEqual(SourceParser.parse("https://x.com/play?file=a.mp4")?.kind, .web)
    }

    func testUnsupportedInputs() {
        let inputs = [
            "example.com/video.mp4",
            "這不是網址",
            "",
            "   ",
            "ftp://example.com/a.mp4",
            "file:///C:/videos/a.mp4",
            "javascript:alert(1)",
            "twitch.tv/abc",
            "www.twitch.tv/abc",
            "ftp://example.com/live"
        ]
        for input in inputs {
            XCTAssertNil(SourceParser.parse(input), input)
        }
    }

    func testWebSources() {
        XCTAssertEqual(
            SourceParser.parse("https://www.twitch.tv/somechannel"),
            .web(url: "https://www.twitch.tv/somechannel")
        )
        // 和瀏覽器一樣：沒有路徑時補上 /
        XCTAssertEqual(SourceParser.parse("https://example.com"), .web(url: "https://example.com/"))
        XCTAssertEqual(
            SourceParser.parse("  http://news.example.org/live?ch=1  "),
            .web(url: "http://news.example.org/live?ch=1")
        )
    }

    func testHrefNormalization() {
        XCTAssertEqual(SourceParser.parse("HTTP://Example.COM:80/Path")?.url, "http://example.com/Path")
        XCTAssertEqual(SourceParser.parse("https://example.com:8443/a")?.url, "https://example.com:8443/a")
    }

    func testResolveYouTubeWeb() {
        let url = "https://youtu.be/\(id)"
        XCTAssertEqual(SourceParser.resolve(url, youtubeWeb: false), .youtube(videoID: id))
        XCTAssertEqual(
            SourceParser.resolve(url, youtubeWeb: true),
            .web(url: "https://www.youtube.com/watch?v=\(id)")
        )
        // 不是 YouTube 影片時不受影響
        XCTAssertEqual(SourceParser.resolve("https://example.com/a.mp4", youtubeWeb: true)?.kind, .mp4)
        XCTAssertNil(SourceParser.resolve("nope", youtubeWeb: true))
    }

    func testIsYouTubeSite() {
        XCTAssertTrue(SourceParser.isYouTubeSite("https://www.youtube.com/"))
        XCTAssertTrue(SourceParser.isYouTubeSite("https://m.youtube.com/results?search_query=news"))
        XCTAssertFalse(SourceParser.isYouTubeSite("https://www.youtube.com/watch?v=\(id)"))
        XCTAssertFalse(SourceParser.isYouTubeSite("https://www.twitch.tv/abc"))
        XCTAssertFalse(SourceParser.isYouTubeSite("nope"))
    }

    func testIsVideoID() {
        XCTAssertTrue(SourceParser.isVideoID("jfKfPfyJRdk"))
        XCTAssertTrue(SourceParser.isVideoID("a_b-c_d-e_f"))
        XCTAssertFalse(SourceParser.isVideoID("short"))
        XCTAssertFalse(SourceParser.isVideoID("jfKfPfyJRdk1"))
        XCTAssertFalse(SourceParser.isVideoID("jfKfPfyJRd!"))
    }
}
