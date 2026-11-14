import XCTest
@testable import MultiViewCore

/// YouTube 訂閱（R59–R61、R142）。
final class YouTubeFeedTests: XCTestCase {
    private let channelID = "UC" + String(repeating: "a", count: 22)
    private let videoID = "jfKfPfyJRdk"

    func testChannelLookup() {
        func lookup(_ input: String) -> String? {
            YouTubeFeed.channelLookup(input).map { "\($0.kind == .channel ? "channel" : "video") \($0.page)" }
        }
        XCTAssertEqual(lookup("https://www.youtube.com/@TED"), "channel https://www.youtube.com/@TED")
        XCTAssertEqual(lookup("https://m.youtube.com/@TED/videos"), "channel https://www.youtube.com/@TED")
        XCTAssertEqual(lookup("https://www.youtube.com/channel/\(channelID)"), "channel https://www.youtube.com/channel/\(channelID)")
        XCTAssertEqual(lookup("https://www.youtube.com/c/TEDx"), "channel https://www.youtube.com/c/TEDx")
        XCTAssertEqual(lookup("https://www.youtube.com/user/TEDtalks"), "channel https://www.youtube.com/user/TEDtalks")
        XCTAssertEqual(lookup("https://youtu.be/\(videoID)"), "video https://www.youtube.com/watch?v=\(videoID)")
        XCTAssertNil(lookup("https://www.youtube.com/channel/bad"))
        XCTAssertNil(lookup("https://www.youtube.com/"))
        XCTAssertNil(lookup("https://www.youtube.com/results?search_query=x"))
        XCTAssertNil(lookup("https://example.com/@TED"))
        XCTAssertNil(lookup("https://example.com/a.mp4"))
        XCTAssertNil(lookup("nope"))
    }

    func testFeedURLs() {
        let rest = String(repeating: "a", count: 22)
        XCTAssertEqual(YouTubeFeed.feedURLs(channelID: channelID), [
            "https://www.youtube.com/feeds/videos.xml?channel_id=UC\(rest)",
            "https://www.youtube.com/feeds/videos.xml?playlist_id=UU\(rest)"
        ])
    }

    func testExtractChannelInfo() {
        let videoPage = #"...,"channelId":"\#(channelID)","isOwnerViewing":false,"ownerChannelName":"A & B \"頻道\"","author":"x"..."#
        let video = YouTubeFeed.extractChannelInfo(html: videoPage, kind: .video)
        XCTAssertEqual(video?.id, channelID)
        XCTAssertEqual(video?.name, "A & B \"頻道\"")

        let channelPage = #"<meta property="og:title" content="TED &amp; Friends"><script>{"externalId":"\#(channelID)"}</script>"#
        let channel = YouTubeFeed.extractChannelInfo(html: channelPage, kind: .channel)
        XCTAssertEqual(channel?.id, channelID)
        XCTAssertEqual(channel?.name, "TED & Friends")

        let canonical = #"<link rel="canonical" href="https://www.youtube.com/channel/\#(channelID)"><meta property="og:title" content="名稱">"#
        XCTAssertEqual(YouTubeFeed.extractChannelInfo(html: canonical, kind: .channel)?.id, channelID)

        XCTAssertNil(YouTubeFeed.extractChannelInfo(html: "<html></html>", kind: .channel))
        XCTAssertNil(YouTubeFeed.extractChannelInfo(html: "<html></html>", kind: .video))
    }

    func testParseFeed() {
        let xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
         <title>頻道</title>
         <entry>
          <id>yt:video:aaaaaaaaaaa</id>
          <yt:videoId>aaaaaaaaaaa</yt:videoId>
          <title>舊的 &amp; 影片</title>
          <published>2026-11-10T08:00:00+00:00</published>
         </entry>
         <entry>
          <yt:videoId>bbbbbbbbbbb</yt:videoId>
          <title>新的 &#39;影片&#x27;</title>
          <published>2026-11-13T12:30:00+00:00</published>
         </entry>
         <entry>
          <yt:videoId>ccccccccccc</yt:videoId>
          <title>沒有時間</title>
         </entry>
        </feed>
        """
        let videos = YouTubeFeed.parseFeed(xml: xml)
        XCTAssertEqual(videos?.map(\.videoID), ["bbbbbbbbbbb", "aaaaaaaaaaa"])
        XCTAssertEqual(videos?.first?.title, "新的 '影片'")
        XCTAssertEqual(videos?.last?.title, "舊的 & 影片")
        // 2026-11-13T12:30:00Z
        XCTAssertEqual(videos?.first?.published, 1_794_573_000_000)
        XCTAssertNil(YouTubeFeed.parseFeed(xml: "<html>不是摘要</html>"))
        XCTAssertEqual(YouTubeFeed.parseFeed(xml: "<feed></feed>"), [])
    }

    func testParseLiveStatus() {
        let canonical = #"<link rel="canonical" href="https://www.youtube.com/watch?v=\#(videoID)">"#
        XCTAssertEqual(YouTubeFeed.parseLiveStatus(html: canonical + #"{"isLive":true}"#), videoID)
        // 已排程、還沒開始的直播不算
        XCTAssertNil(YouTubeFeed.parseLiveStatus(html: canonical + #"{"isLive":true,"isUpcoming":true}"#))
        XCTAssertNil(YouTubeFeed.parseLiveStatus(html: canonical))
        XCTAssertNil(YouTubeFeed.parseLiveStatus(html: #"{"isLive":true}"#))
    }

    func testParseTakeoutCSV() {
        let other = "UC" + String(repeating: "b", count: 22)
        let english = "\u{FEFF}Channel Id,Channel Url,Channel Title\r\n\(channelID),http://www.youtube.com/channel/\(channelID),TED\r\n\(other),http://www.youtube.com/channel/\(other),\"Name, with comma\"\r\n\(channelID),x,重複\r\n"
        let channels = YouTubeFeed.parseTakeoutCSV(english)
        XCTAssertEqual(channels?.map(\.id), [channelID, other])
        XCTAssertEqual(channels?.map(\.name), ["TED", "Name, with comma"])
        XCTAssertEqual(channels?.first?.url, "https://www.youtube.com/channel/\(channelID)")

        // 中文介面匯出的檔案：欄位名稱不同、順序可能不同
        let chinese = "頻道 ID,頻道網址,頻道名稱\n\(channelID),http://www.youtube.com/channel/\(channelID),公視新聞網\n"
        XCTAssertEqual(YouTubeFeed.parseTakeoutCSV(chinese)?.first?.name, "公視新聞網")

        // 沒有名稱時用頻道代碼
        XCTAssertEqual(YouTubeFeed.parseTakeoutCSV("\(channelID),http://x/\n")?.first?.name, channelID)
        // 不是訂閱檔
        XCTAssertNil(YouTubeFeed.parseTakeoutCSV("name,price\napple,3\n"))
        XCTAssertNil(YouTubeFeed.parseTakeoutCSV(""))
    }

    func testSplitCSVLine() {
        XCTAssertEqual(YouTubeFeed.splitCSVLine(#"a, "b,c" ,"d ""e""","#), ["a", "b,c", #"d "e""#, ""])
    }

    func testCountNewAndFormatAgo() {
        let now: Double = 1_794_600_000_000
        let hour: Double = 3600 * 1000
        let videos = [
            FeedVideo(videoID: "a", title: "a", published: now - hour),
            FeedVideo(videoID: "b", title: "b", published: now - 23 * hour),
            FeedVideo(videoID: "c", title: "c", published: now - 25 * hour)
        ]
        XCTAssertEqual(YouTubeFeed.countNew(videos, now: now), 2)
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now, now: now), "1 分鐘前")
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now - 59 * 60 * 1000, now: now), "59 分鐘前")
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now - 3 * hour, now: now), "3 小時前")
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now - 48 * hour, now: now), "2 天前")
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now - 45 * 24 * hour, now: now), "1 個月前")
        XCTAssertEqual(YouTubeFeed.formatAgo(published: now - 800 * 24 * hour, now: now), "2 年前")
    }

    func testParseChannelVideos() throws {
        let ok = #"{"ok": true, "videos": [{"id": "aaaaaaaaaaa", "title": "新的", "timestamp": 1794573000}, {"id": "bbbbbbbbbbb", "title": "沒有時間", "timestamp": null}, {"id": "bad", "title": "x"}]}"#
        let videos = try YouTubeFeed.parseChannelVideos(ok).get()
        XCTAssertEqual(videos.map(\.videoID), ["aaaaaaaaaaa", "bbbbbbbbbbb"])
        XCTAssertEqual(videos[0].published, 1_794_573_000_000)
        XCTAssertEqual(videos[1].published, 0)
        // 不知道發布時間：不顯示時間、不算新影片
        XCTAssertEqual(YouTubeFeed.formatAgo(published: 0, now: 1_794_600_000_000), "")
        XCTAssertEqual(YouTubeFeed.countNew(videos, now: 1_794_573_000_000 + 1000), 1)

        func error(_ text: String) -> String? {
            if case .failure(let error) = YouTubeFeed.parseChannelVideos(text) { return error.message }
            return nil
        }
        XCTAssertEqual(error(#"{"ok": false, "error": "HTTP Error 404"}"#), "HTTP Error 404")
        XCTAssertEqual(error("not json"), "無法讀取 yt-dlp 的結果")
    }

    func testDecodeEntities() {
        XCTAssertEqual(YouTubeFeed.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"), "a & b <c> \"d\" 'e'")
        XCTAssertEqual(YouTubeFeed.decodeEntities("&#20013;&#x6587; &#39;"), "中文 '")
        // 不認得的、沒有結尾的原樣保留
        XCTAssertEqual(YouTubeFeed.decodeEntities("R&D &nbsp; 100% & more;"), "R&D &nbsp; 100% & more;")
    }
}
