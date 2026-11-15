import Foundation

/// 字幕（桌面版 R31 的規則；iOS 版 R131 用在 yt-dlp 播放）。照搬 Android 版 `android/core/.../Captions.kt`。
/// key 是保存在設定檔的代碼（和桌面版相同）：語言代碼；自動產生的字幕前面加 `asr:`。
public struct CaptionTrack: Equatable, Sendable {
    public var key: String
    public var languageCode: String
    public var label: String
    public var auto: Bool
    public var url: String

    public init(key: String, languageCode: String, label: String, auto: Bool, url: String) {
        self.key = key
        self.languageCode = languageCode
        self.label = label
        self.auto = auto
        self.url = url
    }
}

/// 一段字幕：start、end 是秒數。
public struct Cue: Equatable, Sendable {
    public var start: Double
    public var end: Double
    public var text: String

    public init(start: Double, end: Double, text: String) {
        self.start = start
        self.end = end
        self.text = text
    }
}

public enum CaptionRules {
    /// mv_bridge 的 captions 欄位（[{"lang", "name", "url", "auto"}]）轉成字幕清單；重複的只留第一個。
    public static func fromYtDlp(_ raw: Any?) -> [CaptionTrack] {
        var out: [CaptionTrack] = []
        for item in (JSON.array(raw) ?? []).compactMap(JSON.object) {
            guard let lang = JSON.nonEmptyString(item["lang"]), let url = JSON.nonEmptyString(item["url"]) else { continue }
            let auto = JSON.bool(item["auto"]) == true
            let key = (auto ? "asr:" : "") + lang
            if out.contains(where: { $0.key == key }) { continue }
            let name = languageName(lang)
            out.append(CaptionTrack(key: key, languageCode: lang, label: auto ? "\(name)（自動產生）" : name, auto: auto, url: url))
        }
        return out
    }

    /// 語言的繁體中文名稱；系統不認得時用語言代碼。
    public static func languageName(_ lang: String) -> String {
        let name = Locale(identifier: "zh-Hant").localizedString(forIdentifier: lang) ?? ""
        return name.isEmpty ? lang : name
    }

    /// 保存的選擇在這部影片要用哪一軌（桌面版 R31）：先找完全相同的，再找同一種語言的（優先人工字幕）；
    /// 沒有就回傳 nil（關閉）。
    public static func find(_ tracks: [CaptionTrack], key: String?) -> CaptionTrack? {
        guard let key, !key.isEmpty else { return nil }
        if let exact = tracks.first(where: { $0.key == key }) { return exact }
        let code = key.hasPrefix("asr:") ? String(key.dropFirst(4)) : key
        return tracks.first { $0.languageCode == code && !$0.auto } ?? tracks.first { $0.languageCode == code }
    }

    // 時間：「時:分:秒.毫秒」或「分:秒.毫秒」，小數點也可能是逗號
    private static let timing = try! NSRegularExpression( // swiftlint:disable:this force_try
        pattern: #"^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})"#
    )
    private static let tag = try! NSRegularExpression(pattern: "<[^>]*>") // swiftlint:disable:this force_try

    /// 讀取 WebVTT。去掉樣式標籤（YouTube 自動字幕每個字的時間 `<00:00:01.000><c>…</c>`）；
    /// YouTube 自動字幕是兩行捲動顯示，前一段的最後一行會在下一段重複，所以每段只留這段新出現的行。
    public static func parseVtt(_ text: String) -> [Cue] {
        var cues: [Cue] = []
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var index = 0
        var previous: [String] = []
        while index < lines.count {
            let line = lines[index]
            let range = NSRange(line.startIndex..., in: line)
            guard let match = timing.firstMatch(in: line, range: range),
                  let startRange = Range(match.range(at: 1), in: line),
                  let endRange = Range(match.range(at: 2), in: line)
            else {
                index += 1
                continue
            }
            let start = seconds(String(line[startRange]))
            let end = seconds(String(line[endRange]))
            index += 1
            var body: [String] = []
            while index < lines.count, !isBlank(lines[index]) {
                body.append(decode(removeTags(lines[index])).trimmingCharacters(in: .whitespaces))
                index += 1
            }
            let shown = body.filter { !$0.isEmpty }
            // 很短的過渡段（YouTube 自動字幕約 0.01 秒）只是重複上一段，略過
            if shown.isEmpty || end - start < 0.05 { continue }
            let dropped = Array(shown.drop(while: { previous.contains($0) }))
            let fresh = dropped.isEmpty ? shown : dropped
            previous = shown
            cues.append(Cue(start: start, end: end, text: fresh.joined(separator: "\n")))
        }
        return cues
    }

    /// 這個時間要顯示的字幕；沒有時回傳 nil。
    public static func cueAt(_ cues: [Cue], seconds: Double) -> String? {
        let showing = cues.filter { seconds >= $0.start && seconds < $0.end }
        return showing.isEmpty ? nil : showing.map(\.text).joined(separator: "\n")
    }

    private static func seconds(_ value: String) -> Double {
        value.replacingOccurrences(of: ",", with: ".")
            .split(separator: ":", omittingEmptySubsequences: false)
            .reduce(0.0) { total, part in total * 60 + (Double(part) ?? 0) }
    }

    private static func isBlank(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func removeTags(_ line: String) -> String {
        tag.stringByReplacingMatches(in: line, range: NSRange(line.startIndex..., in: line), withTemplate: "")
    }

    private static func decode(_ text: String) -> String {
        text.replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&quot;", with: "\"")
    }
}
