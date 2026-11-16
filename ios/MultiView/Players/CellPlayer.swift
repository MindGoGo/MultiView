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
    /// 聲音軌選單（R135、桌面版 R95）：兩條以上的聲音軌才有。
    var audio: AudioMenu? = nil
    /// 字幕選單（R131）：yt-dlp 播放、影片有字幕時才有。
    var captions: CaptionMenu? = nil
    /// SponsorBlock 要跳過的片段（yt-dlp 播放的 YouTube 一般影片，R161）；進度條的色塊用。沒有時是空的。
    var sponsorSegments: [SponsorSegment] = []
    /// 剛剛自動跳過的片段（格子角落的提示）；沒有時為 nil。
    var skipNotice: SkipNotice? = nil
}

/// 跳過提示（R161）：serial 每次跳過都不同（同一個片段取消後再看到也重新計時）。
struct SkipNotice: Equatable {
    var segment: SponsorSegment
    var serial: Int
}

/// 字幕選單：yt-dlp 讀到的字幕，與目前顯示的那一軌（CaptionTrack.key；關閉時為 nil）。
struct CaptionMenu: Equatable {
    var tracks: [CaptionTrack]
    var current: String?
}

/// 聲音軌選單：選項與目前用的那一項（AudioOption.index）。
struct AudioMenu: Equatable {
    var options: [AudioOption]
    var current: Int
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
    /// 正在用 yt-dlp 解析（讀取動畫顯示「解析中…」，R99）。
    var isResolving: Bool { get }

    func play()
    func pause()
    func setMuted(_ muted: Bool)
    /// 音量 0–100。
    func setVolume(_ volume: Int)
    func seek(to seconds: Double)
    /// 移除來源時釋放資源。
    func shutdown()

    /// 能不能選畫質（原生播放器播 HLS 時，R131）。
    var supportsQuality: Bool { get }
    /// 畫質：自動，或最高畫面高度。
    func setQuality(_ quality: Quality)

    /// 換聲音軌（R135、桌面版 R95）：選項來自 PlayerUpdate.audio。
    func setAudioTrack(_ option: AudioOption)

    /// 顯示這一軌字幕（CaptionTrack.key，選項來自 PlayerUpdate.captions），nil 是關閉（R131）。
    func setCaption(_ key: String?)

    /// 能不能用子母畫面（只有原生播放器，R132）。
    var supportsPictureInPicture: Bool { get }
    func startPictureInPicture()
    /// 回到主畫面時自動用子母畫面繼續播（只開在唯一有聲音的那一格，R132）。
    func setAutomaticPictureInPicture(_ enabled: Bool)
    /// App 切到背景。keepAudio：這一格有聲音而且正在播放，繼續播聲音；否則暫停。
    func didEnterBackground(keepAudio: Bool)
    func willEnterForeground()

    /// 跳過提示的「取消」：跳回片段開頭，這個片段之後不再跳（R161）。
    func undoSkip()
    /// SponsorBlock 的設定改了（R161）。
    func setSponsorBlock(_ settings: SponsorBlockSettings)
}

extension CellPlayer {
    var isResolving: Bool { false }
    var supportsQuality: Bool { false }
    func setQuality(_ quality: Quality) {}
    func setAudioTrack(_ option: AudioOption) {}
    func setCaption(_ key: String?) {}
    var supportsPictureInPicture: Bool { false }
    func startPictureInPicture() {}
    func setAutomaticPictureInPicture(_ enabled: Bool) {}
    /// 網頁播放的格子在背景一律暫停（iOS 會暫停背景的網頁）。
    func didEnterBackground(keepAudio: Bool) { pause() }
    func willEnterForeground() {}
    func undoSkip() {}
    func setSponsorBlock(_ settings: SponsorBlockSettings) {}
}
