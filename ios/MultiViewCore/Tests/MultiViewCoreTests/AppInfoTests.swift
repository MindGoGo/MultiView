import XCTest
@testable import MultiViewCore

final class AppInfoTests: XCTestCase {
    func testVersionLabel() {
        XCTAssertEqual(AppInfo.versionLabel(version: "0.1.0"), "MultiView iOS 0.1.0")
        XCTAssertEqual(
            AppInfo.versionLabel(version: "0.1.0", ytdlpVersion: "2026.11.01"),
            "MultiView iOS 0.1.0（yt-dlp 2026.11.01）"
        )
    }

    func testVersionLabelWithoutVersion() {
        XCTAssertEqual(AppInfo.versionLabel(version: nil), "MultiView iOS")
        XCTAssertEqual(AppInfo.versionLabel(version: "  "), "MultiView iOS")
        XCTAssertEqual(AppInfo.versionLabel(version: "0.1.0", ytdlpVersion: ""), "MultiView iOS 0.1.0")
    }

    func testVersionFromTag() {
        XCTAssertEqual(AppInfo.version(fromTag: "ios-v0.1.0"), "0.1.0")
        XCTAssertEqual(AppInfo.version(fromTag: "ios-v12.3.45"), "12.3.45")
    }

    func testVersionFromOtherTags() {
        XCTAssertNil(AppInfo.version(fromTag: "v0.8.3"))
        XCTAssertNil(AppInfo.version(fromTag: "ios-v0.1"))
        XCTAssertNil(AppInfo.version(fromTag: "ios-v0.1.x"))
        XCTAssertNil(AppInfo.version(fromTag: "ios-v0..1"))
        XCTAssertNil(AppInfo.version(fromTag: "ios-v"))
    }
}
