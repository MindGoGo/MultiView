import MultiViewCore
import UIKit

/// 什麼都不做的播放器：給已經不在格子裡的來源（畫面短暫畫到的舊格子），只顯示黑色。
@MainActor
final class InertPlayer: CellPlayer {
    static let shared = InertPlayer()

    let view: UIView = {
        let view = UIView()
        view.backgroundColor = .black
        return view
    }()

    var onUpdate: ((PlayerUpdate) -> Void)?
    let supportsVolume = false
    let isInteractive = false
    let usesWebAudio = false
    var badge: String? { nil }

    func play() {}
    func pause() {}
    func setMuted(_ muted: Bool) {}
    func setVolume(_ volume: Int) {}
    func seek(to seconds: Double) {}
    func shutdown() {}
}
