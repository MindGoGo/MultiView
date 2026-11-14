import Foundation

/// 從其他 App 送進來的網址（R126）：`multiview://open?url=<網址>`。
/// 使用者用 iOS「捷徑」做一個分享捷徑，從 Safari、YouTube App 的分享選單把網址送過來。
public enum ExternalLink {
    public static let scheme = "multiview"

    /// 取出要放進格子的網址；不是 MultiView 的連結、沒有網址時回傳 nil。
    /// 網址可以有編碼（`https%3A%2F%2F…`），也可以沒有編碼：捷徑直接把網址接在後面時，
    /// 網址裡的 `&`、`?` 會被當成連結自己的參數，所以取 `url=` 後面的整段，不用一般的參數解析。
    public static func target(of link: String) -> String? {
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: text), components.scheme?.lowercased() == scheme else { return nil }
        guard let query = text.range(of: "?") else { return nil }
        let rest = text[query.upperBound...]
        guard let start = rest.range(of: "url=") else { return nil }
        // url= 必須是參數的開頭
        if start.lowerBound != rest.startIndex, rest[rest.index(before: start.lowerBound)] != "&" { return nil }
        var value = String(rest[start.upperBound...])
        let lower = value.lowercased()
        if lower.hasPrefix("http%3a") || lower.hasPrefix("https%3a") {
            value = value.removingPercentEncoding ?? value
        }
        value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
