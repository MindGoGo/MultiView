// swift-tools-version: 5.9
import PackageDescription

// 和畫面無關的邏輯（網址判斷、版型、格位、設定與清單……）放在這裡，可以單獨跑單元測試（R119）。
let package = Package(
    name: "MultiViewCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MultiViewCore", targets: ["MultiViewCore"])
    ],
    targets: [
        .target(name: "MultiViewCore"),
        .testTarget(name: "MultiViewCoreTests", dependencies: ["MultiViewCore"])
    ]
)
