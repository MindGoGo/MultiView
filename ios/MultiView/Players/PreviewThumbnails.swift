import AVFoundation
import MultiViewCore
import UIKit

/// 進度條的預覽縮圖（桌面版 R50；iOS 版 R129）。對照 Android 版 `player/PreviewThumbnails.kt`。
/// - YouTube（yt-dlp 或內嵌）：影片網頁裡的縮圖資訊（`playerStoryboardSpecRenderer`），下載那一頁圖片後裁切
/// - mp4：`AVAssetImageGenerator` 取那個位置附近的畫面，每 2 秒一張
/// 每部影片的縮圖資訊、圖片都快取起來，拖曳時不重複下載。
@MainActor
enum PreviewThumbnails {
    /// 縮圖的寬度（像素）上限。
    private static let maxWidth: CGFloat = 320

    /// YouTube 影片的縮圖資訊；值是 nil 表示這部影片沒有（直播、找不到）。
    private static var storyboards: [String: Storyboard?] = [:]
    private static var storyboardTasks: [String: Task<StoryboardResult, Never>] = [:]
    /// 縮圖的整頁圖片（一頁有很多張）。
    private static let sheets: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 6
        return cache
    }()
    private static var sheetTasks: [String: Task<UIImage?, Never>] = [:]
    /// 裁切好的縮圖與 mp4 的畫面。
    private static let frames: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 60
        return cache
    }()
    /// 最近用的 mp4 的畫面產生器（同一部影片沿用）。
    private static var generator: (url: String, generator: AVAssetImageGenerator)?

    /// 下載縮圖資訊的結果；網路錯誤時不記住，下次再試。
    enum StoryboardResult: Sendable {
        case found(Storyboard?)
        case failed
    }

    /// 這個來源有沒有縮圖：YouTube 與 mp4 才有（m3u8、其他網站只顯示時間）。
    static func supports(_ source: CellSource) -> Bool {
        switch source.parsed {
        case .youtube, .mp4: return true
        case .hls, .web: return false
        }
    }

    /// 這個位置的縮圖；沒有或讀不到時回傳 nil。duration 是影片長度（秒）。
    static func image(for source: CellSource, seconds: Double, duration: Double) async -> UIImage? {
        switch source.parsed {
        case .youtube(let videoID):
            return await youtube(videoID: videoID, seconds: seconds, duration: duration)
        case .mp4(let href):
            return await mp4(href, seconds: seconds)
        case .hls, .web:
            return nil
        }
    }

    // MARK: YouTube

    private static func youtube(videoID: String, seconds: Double, duration: Double) async -> UIImage? {
        guard let storyboard = await storyboard(videoID: videoID) else { return nil }
        let frame = StoryboardRules.frame(storyboard, seconds: seconds, duration: duration)
        let key = "\(frame.url)#\(frame.x),\(frame.y)" as NSString
        if let cached = frames.object(forKey: key) { return cached }
        guard let sheet = await sheet(frame.url)?.cgImage,
              frame.x + frame.width <= sheet.width, frame.y + frame.height <= sheet.height,
              let cropped = sheet.cropping(to: CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height))
        else { return nil }
        let image = UIImage(cgImage: cropped)
        frames.setObject(image, forKey: key)
        return image
    }

    private static func storyboard(videoID: String) async -> Storyboard? {
        if let known = storyboards[videoID] { return known }
        let task: Task<StoryboardResult, Never>
        if let running = storyboardTasks[videoID] {
            task = running
        } else {
            task = Task.detached {
                guard let data = await fetch("https://www.youtube.com/watch?v=\(videoID)"),
                      let html = String(data: data, encoding: .utf8)
                else { return .failed }
                return .found(StoryboardRules.extractSpec(html).flatMap(StoryboardRules.parse))
            }
            storyboardTasks[videoID] = task
        }
        let result = await task.value
        storyboardTasks[videoID] = nil
        switch result {
        case .found(let storyboard):
            storyboards[videoID] = .some(storyboard)
            return storyboard
        case .failed:
            return nil
        }
    }

    private static func sheet(_ address: String) async -> UIImage? {
        if let cached = sheets.object(forKey: address as NSString) { return cached }
        let task: Task<UIImage?, Never>
        if let running = sheetTasks[address] {
            task = running
        } else {
            task = Task.detached {
                guard let data = await fetch(address) else { return nil }
                return UIImage(data: data)
            }
            sheetTasks[address] = task
        }
        let image = await task.value
        sheetTasks[address] = nil
        if let image {
            sheets.setObject(image, forKey: address as NSString)
        }
        return image
    }

    /// 下載網頁或圖片：用桌面版的 User-Agent（行動版網頁沒有縮圖資訊）。
    private nonisolated static func fetch(_ address: String) async -> Data? {
        guard let url = URL(string: address) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue(CompanionRules.desktopUserAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("zh-TW,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return data
    }

    // MARK: mp4

    private static func mp4(_ href: String, seconds: Double) async -> UIImage? {
        guard seconds.isFinite, let url = URL(string: href) else { return nil }
        let bucket = Int(max(0, seconds) / 2)
        let key = "\(href)#\(bucket)" as NSString
        if let cached = frames.object(forKey: key) { return cached }
        let current: AVAssetImageGenerator
        if let generator, generator.url == href {
            current = generator.generator
        } else {
            current = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            current.appliesPreferredTrackTransform = true
            current.maximumSize = CGSize(width: maxWidth, height: maxWidth)
            // 取附近的畫面就好，比較快
            let tolerance = CMTime(seconds: 1, preferredTimescale: 600)
            current.requestedTimeToleranceBefore = tolerance
            current.requestedTimeToleranceAfter = tolerance
            generator = (href, current)
        }
        let time = CMTime(seconds: Double(bucket * 2), preferredTimescale: 600)
        guard let (cgImage, _) = try? await current.image(at: time) else { return nil }
        let image = UIImage(cgImage: cgImage)
        frames.setObject(image, forKey: key)
        return image
    }
}
