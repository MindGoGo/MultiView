import MultiViewCore
import UIKit

/// 播放器回報的狀態。
struct PlayerUpdate {
    var status: PlayStatus
    var progress: PlaybackProgress?
    /// 影片名稱的來源（YouTube 標題、網頁標題）；取不到時為 nil（R22、R23）。
    var title: String?
    /// 錯誤狀態時顯示的訊息。
    var errorMessage: String?
}

/// 一格的播放器。每個來源一個，換位、切換版型時沿用同一個，不重新載入（R6 AC1）。
@MainActor
protocol CellPlayer: AnyObject {
    /// 播放器的畫面；同一時間只會放在一個格子裡。
    var view: UIView { get }
    var onUpdate: ((PlayerUpdate) -> Void)? { get set }
    /// 能不能各自調整音量；不能的只有靜音開關（R121、R128）。
    var supportsVolume: Bool { get }
    /// 手指直接操作播放器的畫面（整頁模式的網頁）；false 時由格子攔下點擊（R127）。
    var isInteractive: Bool { get }
    /// 聲音是不是由網頁播放。iOS 不讓兩個網頁同時出聲，這類格子同一時間只有一格有聲音（R128）。
    var usesWebAudio: Bool { get }
    /// 播放方式的小標示（桌面版 R109），例如「yt-dlp」；不需要標示時為 nil。
    var badge: String? { get }

    func play()
    func pause()
    func setMuted(_ muted: Bool)
    /// 音量 0–100。
    func setVolume(_ volume: Int)
    func seek(to seconds: Double)
    /// 移除來源時釋放資源。
    func shutdown()

    /// 能不能用子母畫面（只有原生播放器，R132）。
    var supportsPictureInPicture: Bool { get }
    func startPictureInPicture()
    /// 回到主畫面時自動用子母畫面繼續播（只開在唯一有聲音的那一格，R132）。
    func setAutomaticPictureInPicture(_ enabled: Bool)
    /// App 切到背景。keepAudio：這一格有聲音而且正在播放，繼續播聲音；否則暫停。
    func didEnterBackground(keepAudio: Bool)
    func willEnterForeground()
}

extension CellPlayer {
    var supportsPictureInPicture: Bool { false }
    func startPictureInPicture() {}
    func setAutomaticPictureInPicture(_ enabled: Bool) {}
    /// 網頁播放的格子在背景一律暫停（iOS 會暫停背景的網頁）。
    func didEnterBackground(keepAudio: Bool) { pause() }
    func willEnterForeground() {}
}
