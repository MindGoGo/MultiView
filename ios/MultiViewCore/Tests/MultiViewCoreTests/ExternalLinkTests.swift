import XCTest
@testable import MultiViewCore

/// 從其他 App 送進來的網址（R126）。
final class ExternalLinkTests: XCTestCase {
    func testEncodedURL() {
        XCTAssertEqual(
            ExternalLink.target(of: "multiview://open?url=https%3A%2F%2Fyoutu.be%2FjfKfPfyJRdk%3Fsi%3Dabc%26t%3D10"),
            "https://youtu.be/jfKfPfyJRdk?si=abc&t=10"
        )
    }

    func testUnencodedURLKeepsItsOwnQuery() {
        XCTAssertEqual(
            ExternalLink.target(of: "multiview://open?url=https://www.youtube.com/watch?v=jfKfPfyJRdk&t=42s"),
            "https://www.youtube.com/watch?v=jfKfPfyJRdk&t=42s"
        )
        XCTAssertEqual(ExternalLink.target(of: "MULTIVIEW://open?url=https://example.com/a.m3u8"), "https://example.com/a.m3u8")
        XCTAssertEqual(ExternalLink.target(of: "multiview://open?x=1&url=https://example.com/"), "https://example.com/")
    }

    func testNotMultiViewLinks() {
        XCTAssertNil(ExternalLink.target(of: "https://example.com/?url=https://youtu.be/x"))
        XCTAssertNil(ExternalLink.target(of: "multiview://open"))
        XCTAssertNil(ExternalLink.target(of: "multiview://open?url="))
        XCTAssertNil(ExternalLink.target(of: "multiview://open?xurl=https://example.com/"))
        XCTAssertNil(ExternalLink.target(of: "not a link"))
    }
}
