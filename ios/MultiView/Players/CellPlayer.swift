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

    func play()
    func pause()
    func setMuted(_ muted: Bool)
    /// 音量 0–100。
    func setVolume(_ volume: Int)
    func seek(to seconds: Double)
    /// 移除來源時釋放資源。
    func shutdown()
}
