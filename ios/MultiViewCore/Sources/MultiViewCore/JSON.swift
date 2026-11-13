import Foundation

/// 寬鬆地讀寫 JSON：設定檔與清單檔的欄位不合法時只換掉那個欄位，不整份丟掉（R134、R141）。
/// 對應桌面版用 `typeof` 逐欄檢查的寫法，所以不用 Codable。
enum JSON {
    static func parse(_ text: String) -> Any? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func object(_ value: Any?) -> [String: Any]? {
        value as? [String: Any]
    }

    static func array(_ value: Any?) -> [Any]? {
        value as? [Any]
    }

    /// JSON 的 true／false。NSNumber 的 0、1 不算（對應 JS 的 `=== true`）。
    static func bool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, isBoolean(number) else { return nil }
        return number.boolValue
    }

    /// 有限的數字；true／false 不算數字（對應 JS 的 `typeof v === 'number' && Number.isFinite(v)`）。
    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, !isBoolean(number) else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    static func string(_ value: Any?) -> String? {
        value as? String
    }

    /// 非空白的字串，否則 nil。
    static func nonEmptyString(_ value: Any?) -> String? {
        guard let text = value as? String, !text.isEmpty else { return nil }
        return text
    }

    /// 輸出成排版過的 JSON 文字（欄位依名稱排序，方便比對）。
    static func encode(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
              ),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    /// Swift 的 Optional 放進 JSON 物件時要換成 NSNull。
    static func orNull(_ value: Any?) -> Any {
        value ?? NSNull()
    }

    /// 對應 JS 的 Math.round：.5 往正無限大方向進位。
    static func jsRound(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    private static func isBoolean(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}
