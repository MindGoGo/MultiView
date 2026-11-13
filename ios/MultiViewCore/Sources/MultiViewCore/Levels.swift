import Foundation

/// 每格亮度與總亮度（桌面版 R40、R41；iOS 版 R130）。
/// iOS 版最高 100%：原生播放器的畫面不能直接調亮。
public enum Brightness {
    public static let min = 20
    public static let max = 100
    public static let step = 5
    public static let `default` = 100

    /// 設定檔中的亮度：限制在 20–100、以 5 為單位；不合法或沒有欄位時為 100。
    /// 桌面版超過 100 的值當作 100（R130、R144）。
    public static func normalize(_ raw: Any?) -> Int {
        guard let value = JSON.number(raw) else { return `default` }
        let stepped = JSON.jsRound(value / Double(step)) * Double(step)
        return Int(Swift.min(Swift.max(stepped, Double(min)), Double(max)))
    }

    /// 實際亮度（%）＝ 格子亮度 × 總亮度。
    public static func effective(cell: Int, master: Int) -> Double {
        Double(cell * master) / 100
    }

    /// 蓋在畫面上的黑色遮罩的不透明度（0–1）；100% 時是 0。
    public static func dimOpacity(cell: Int, master: Int) -> Double {
        Swift.min(Swift.max(1 - effective(cell: cell, master: master) / 100, 0), 1)
    }
}

/// 音量（桌面版 R7、R42；iOS 版 R128）。iOS 版最高 100%，不做桌面版 R98 的 200%。
public enum Volume {
    public static let `default` = 100
    public static let max = 100

    /// 保存的音量：0–100 的整數；不合法時用預設值。桌面版超過 100 的值當作 100（R144）。
    public static func normalize(_ raw: Any?) -> Int {
        guard let value = JSON.number(raw) else { return `default` }
        return clamp(value)
    }

    public static func clamp(_ value: Double) -> Int {
        Int(JSON.jsRound(Swift.min(Swift.max(value, 0), Double(max))))
    }

    /// 播放器用的音量（0–1）。
    public static func fraction(_ volume: Int) -> Double {
        Double(Swift.min(Swift.max(volume, 0), max)) / Double(max)
    }
}

/// 畫質的選擇（桌面版 R24、R32；iOS 版 R131）：自動，或畫面高度（例如 720）。
public enum Quality: Equatable, Sendable {
    case auto
    case height(Int)

    private static let minHeight = 100.0
    private static let maxHeight = 10000.0

    /// 選單與按鈕上的名稱。
    public var label: String {
        switch self {
        case .auto: return "自動"
        case .height(let height): return "\(height)p"
        }
    }

    /// 設定檔中的畫質：舊版的「高」是 1080p，合理範圍內的整數是畫面高度，其他都是自動。
    public static func normalize(_ raw: Any?) -> Quality {
        if JSON.string(raw) == "high" { return .height(1080) }
        if let value = JSON.number(raw), value == value.rounded(), value >= minHeight, value <= maxHeight {
            return .height(Int(value))
        }
        return .auto
    }

    /// 寫進設定檔的值：`"auto"` 或數字。
    var jsonValue: Any {
        switch self {
        case .auto: return "auto"
        case .height(let height): return height
        }
    }
}
