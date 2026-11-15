import Foundation

/// 播放器提供的一條聲音軌：HLS 主清單 EXT-X-MEDIA 的 LANGUAGE 與 NAME。
public struct RawAudioTrack: Equatable, Sendable {
    public var lang: String?
    public var name: String

    public init(lang: String?, name: String) {
        self.lang = lang
        self.name = name
    }
}

/// YouTube 在 NAME 結尾標示的種類，例如「zh-Hant - original」「American English - dubbed-auto」。
public enum AudioKind: String, Equatable, Sendable {
    case original
    case dubbedAuto = "dubbed-auto"
    case dubbed

    public var label: String {
        switch self {
        case .original: return "（原本的聲音）"
        case .dubbedAuto: return "（AI 配音）"
        case .dubbed: return "（配音）"
        }
    }
}

/// 選單裡的一項：index 是播放器聲音軌的位置。
public struct AudioOption: Equatable, Sendable {
    public var index: Int
    public var lang: String
    public var kind: AudioKind?
    public var label: String

    public init(index: Int, lang: String, kind: AudioKind?, label: String) {
        self.index = index
        self.lang = lang
        self.kind = kind
        self.label = label
    }
}

/// yt-dlp 播放的聲音軌（桌面版 R95）：照搬 `src/lib/audioTracks.ts` 與 `tests/unit/audio-tracks.test.ts`。
public enum AudioTrackRules {
    private static let hantRegions: Set<String> = ["tw", "hk", "mo"]
    private static let hansRegions: Set<String> = ["cn", "sg", "my"]

    /// NAME 結尾的「 - original」「 - dubbed-auto」「 - dubbed」（不分大小寫，後面要是字的邊界）。
    public static func audioKind(_ name: String) -> AudioKind? {
        let lower = name.lowercased()
        var searchStart = lower.startIndex
        while let range = lower.range(of: " - ", range: searchStart..<lower.endIndex) {
            let rest = lower[range.upperBound...]
            // 先比對較長的 dubbed-auto，和正規表示式的 (original|dubbed-auto|dubbed) 結果相同
            for kind in [AudioKind.original, .dubbedAuto, .dubbed] where rest.hasPrefix(kind.rawValue) {
                let after = rest.dropFirst(kind.rawValue.count)
                if let next = after.first, isWordCharacter(next) { continue }
                return kind
            }
            searchStart = range.upperBound
        }
        return nil
    }

    private static func isWordCharacter(_ c: Character) -> Bool {
        c == "_" || (c.isASCII && (c.isLetter || c.isNumber))
    }

    /// 比對用的語言：中文分繁體、簡體；其他語言只看主要語言。
    public static func langKey(_ lang: String?) -> String {
        let parts = (lang ?? "").lowercased()
            .split(whereSeparator: { $0 == "-" || $0 == "_" })
            .map(String.init)
        let base = parts.first ?? ""
        if base != "zh" { return base }
        if parts.contains("hant") || parts.contains(where: hantRegions.contains) { return "zh-hant" }
        if parts.contains("hans") || parts.contains(where: hansRegions.contains) { return "zh-hans" }
        return "zh"
    }

    private static func sameLang(_ a: String, _ b: String) -> Bool {
        !a.isEmpty && (a == b || (a == "zh" && b.hasPrefix("zh")) || (b == "zh" && a.hasPrefix("zh")))
    }

    /// 語言的名稱（繁體中文），例如「中文（繁體）」「英文（美國）」。
    static func languageName(_ lang: String) -> String {
        if lang.isEmpty { return "未知語言" }
        let name = Locale(identifier: "zh-Hant").localizedString(forIdentifier: lang) ?? ""
        return name.isEmpty ? lang : name
    }

    /// 不同的聲音軌（語言＋種類相同的只列一次，取第一條），依播放器的順序。
    public static func options(_ tracks: [RawAudioTrack]) -> [AudioOption] {
        var seen = Set<String>()
        var out: [AudioOption] = []
        for (index, track) in tracks.enumerated() {
            let lang = track.lang ?? ""
            let kind = audioKind(track.name)
            let key = "\(lang.lowercased())|\(kind?.rawValue ?? track.name)"
            guard seen.insert(key).inserted else { continue }
            out.append(AudioOption(index: index, lang: lang, kind: kind, label: languageName(lang) + (kind?.label ?? "")))
        }
        return out
    }

    /// 播放器目前用的聲音軌對應到選單的哪一項（語言＋種類相同的算同一項）。
    public static func currentOption(_ tracks: [RawAudioTrack], _ options: [AudioOption], current: Int) -> Int {
        guard tracks.indices.contains(current) else { return -1 }
        let track = tracks[current]
        let kind = audioKind(track.name)
        return options.first(where: { $0.lang == (track.lang ?? "") && $0.kind == kind })?.index ?? current
    }

    /// 要用哪一條聲音軌：這一格記住的語言 → 系統語言 → 原本的聲音 → 第一條。
    /// 同一種語言有原本的聲音和配音時，優先原本的聲音。沒有聲音軌時回傳 -1。
    public static func pick(_ tracks: [RawAudioTrack], saved: String?, system: String) -> Int {
        if tracks.isEmpty { return -1 }
        func byLang(_ lang: String?) -> Int {
            let key = langKey(lang)
            let matches = tracks.indices.filter { sameLang(langKey(tracks[$0].lang), key) }
            guard let first = matches.first else { return -1 }
            return matches.first(where: { audioKind(tracks[$0].name) == .original }) ?? first
        }
        if let saved, !saved.isEmpty {
            let i = byLang(saved)
            if i >= 0 { return i }
        }
        let i = byLang(system)
        if i >= 0 { return i }
        return tracks.firstIndex(where: { audioKind($0.name) == .original }) ?? 0
    }
}
