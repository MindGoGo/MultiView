import Foundation

/// 進度條的判斷與換算（桌面版 R19、R51、R55；iOS 版 R129、R134）。由 `src/lib/progress.ts` 改寫。

/// 播放器回報的進度，單位是秒。
public struct PlaybackProgress: Equatable, Sendable {
    public var current: Double
    /// 一般影片是 0；直播是可回放範圍的開始。
    public var start: Double
    /// 一般影片是總長度；直播是直播最新位置（可回放範圍的結束）。
    public var end: Double
    public var live: Bool

    public init(current: Double, start: Double, end: Double, live: Bool) {
        self.current = current
        self.start = start
        self.end = end
        self.live = live
    }
}

public enum ProgressKind: Sendable {
    /// 一般影片。
    case vod
    /// 可回放的直播。
    case dvr
    /// 沒有回放範圍的直播（沒有進度條）。
    case live
}

public struct ProgressDisplay: Equatable, Sendable {
    public var kind: ProgressKind
    /// 目前位置在進度條上的比例 0–1（live 沒有進度條，為 0）。
    public var fraction: Double
    /// 是否正在看直播（只有 dvr 有意義）。
    public var atLive: Bool
}

/// 播放器元件的資訊（原生播放器、網頁中的影片共用）。
public struct MediaInfo: Sendable {
    /// 還沒載入時是 NaN；直播可能是無限大。
    public var duration: Double
    public var currentTime: Double
    /// 可以跳轉的各段範圍。
    public var seekable: [ClosedRange<Double>]
    /// 已知是否為直播；不知道時為 nil，依長度判斷。
    public var live: Bool?

    public init(duration: Double, currentTime: Double, seekable: [ClosedRange<Double>] = [], live: Bool? = nil) {
        self.duration = duration
        self.currentTime = currentTime
        self.seekable = seekable
        self.live = live
    }
}

public enum ProgressRules {
    /// 可回放範圍至少這麼長，才算可回放的直播（R19 共用定義）。
    public static let dvrMinSeconds: Double = 60
    /// 距離直播最新位置這麼近以內，視為正在看直播。
    public static let liveEdgeSeconds: Double = 10
    /// 長度超過這個值的影片當作直播（有些網站的直播回報一個極大的長度，而不是無限大）。
    static let liveDurationSeconds: Double = 10 * 24 * 3600
    /// 開頭、結尾這麼近以內的位置不保存，下次從頭開始（R55）。
    public static let resumeMarginSeconds: Double = 5
    /// 雙擊格子左右兩側快轉、倒轉的秒數（R129）。
    public static let doubleTapSkipSeconds: Double = 10
    /// 鍵盤 ←／→ 快轉、倒轉的秒數（R51、R133）。
    public static let keySkipSeconds: Double = 5

    public static func view(_ progress: PlaybackProgress) -> ProgressDisplay {
        let span = progress.end - progress.start
        if !progress.live {
            let fraction = span > 0 ? clamp01((progress.current - progress.start) / span) : 0
            return ProgressDisplay(kind: .vod, fraction: fraction, atLive: false)
        }
        if span < dvrMinSeconds {
            return ProgressDisplay(kind: .live, fraction: 0, atLive: true)
        }
        return ProgressDisplay(
            kind: .dvr,
            fraction: clamp01((progress.current - progress.start) / span),
            atLive: progress.end - progress.current <= liveEdgeSeconds
        )
    }

    /// 進度條上的比例 → 要跳到的秒數。
    public static func seekTarget(_ progress: PlaybackProgress, fraction: Double) -> Double {
        progress.start + clamp01(fraction) * (progress.end - progress.start)
    }

    /// 快轉、倒轉後的秒數（R51）：限制在可跳轉的範圍內。沒有進度條（沒有回放範圍的直播）時回傳 nil。
    public static func skipTarget(_ progress: PlaybackProgress, seconds: Double) -> Double? {
        if view(progress).kind == .live { return nil }
        return min(max(progress.current + seconds, progress.start), progress.end)
    }

    /// 要保存的觀看進度（R55）：只有點播影片；直播、播完或距離結尾不到 5 秒、還不到 5 秒時不保存。
    public static func resumePosition(_ progress: PlaybackProgress?, ended: Bool = false) -> Double? {
        guard let progress, !progress.live, !ended else { return nil }
        if progress.current < resumeMarginSeconds || progress.end - progress.current < resumeMarginSeconds {
            return nil
        }
        return JSON.jsRound(progress.current * 10) / 10
    }

    /// `m:ss`，一小時以上 `h:mm:ss`。
    public static func formatTime(_ seconds: Double) -> String {
        let total = Int(max(0, (seconds.isFinite ? seconds : 0).rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = pad(total % 60)
        return hours > 0 ? "\(hours):\(pad(minutes)):\(secs)" : "\(minutes):\(secs)"
    }

    /// 距離直播的時間，例如 `-1:23`。
    public static func formatBehind(_ seconds: Double) -> String {
        "-" + formatTime(seconds)
    }

    /// 從播放器的資訊算出進度；還不知道長度時回傳 nil。
    public static func fromMedia(_ media: MediaInfo) -> PlaybackProgress? {
        // 長度是 NaN 表示還沒載入，不是直播
        if media.live == nil, media.duration.isNaN { return nil }
        let live = media.live ?? (media.duration == .infinity || media.duration > liveDurationSeconds)
        if !live {
            guard media.duration > 0 else { return nil }
            return PlaybackProgress(current: media.currentTime, start: 0, end: media.duration, live: false)
        }
        guard let first = media.seekable.first, let last = media.seekable.last else {
            return PlaybackProgress(current: media.currentTime, start: media.currentTime, end: media.currentTime, live: true)
        }
        return PlaybackProgress(current: media.currentTime, start: first.lowerBound, end: last.upperBound, live: true)
    }

    private static func pad(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }

    private static func clamp01(_ value: Double) -> Double {
        value.isFinite ? min(max(value, 0), 1) : 0
    }
}

/// 播放狀態（桌面版 `src/players/types.ts` 的 PlayStatus）。
public enum PlayStatus: Sendable {
    case loading, playing, paused, ended, error

    /// 每格的播放／暫停按鈕（R26）：播放中或緩衝中顯示暫停，其他（暫停、播完）顯示播放。
    public var showsPause: Bool { self == .playing || self == .loading }
}

/// 全部播放／暫停的對象（R8、R9、R20）。
public enum PlaybackRules {
    public enum ToggleAction: Sendable {
        case play, pause
    }

    /// 顯示中、有來源、而且不是錯誤狀態的格位（R8）。statuses 以來源的 id 為索引。
    public static func controllableIndices(
        _ slots: Slots, layout: LayoutID, statuses: [Int: PlayStatus], solo: Int? = nil
    ) -> [Int] {
        slots.indices.filter { index in
            guard let source = slots[index] else { return false }
            return SlotRules.isVisible(index, layout: layout, solo: solo) && statuses[source.id] != .error
        }
    }

    /// 只要有任何一格在播放就全部暫停，否則全部播放（R9）。
    public static func toggleAllAction(
        _ slots: Slots, layout: LayoutID, statuses: [Int: PlayStatus], solo: Int? = nil
    ) -> ToggleAction {
        let anyPlaying = controllableIndices(slots, layout: layout, statuses: statuses, solo: solo).contains { index in
            guard let source = slots[index] else { return false }
            return statuses[source.id] == .playing
        }
        return anyPlaying ? .pause : .play
    }
}
