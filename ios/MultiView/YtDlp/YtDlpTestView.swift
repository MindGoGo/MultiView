import AVKit
import MultiViewCore
import SwiftUI

/// yt-dlp 的技術驗證畫面（規格 R122）：確認 Python、JS 執行環境、解析、播放各自能不能用。
/// 記錄可以複製，方便回報問題。
struct YtDlpTestView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var url: String
    @State private var log = "按下面的按鈕開始測試。\n"
    @State private var busy = false
    @State private var player: AVPlayer?
    @FocusState private var focused: Bool

    init(url: String) {
        _url = State(initialValue: url)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("yt-dlp 測試")
                    .font(.headline)
                Spacer()
                Button("關閉") {
                    player?.pause()
                    dismiss()
                }
            }

            URLField(text: $url, focused: $focused) {
                resolve()
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Button("1. 版本") { run("版本") { try await PythonRuntime.shared.call("versions") } }
                    Button("2. JS 測試") { run("JS 測試") { try await PythonRuntime.shared.call("js_selftest") } }
                    Button("3. 解析") { resolve() }
                    Button("複製記錄") { UIPasteboard.general.string = log }
                    Button("清除") { log = "" }
                }
                .buttonStyle(.bordered)
                .disabled(busy)
            }

            if let player {
                VideoPlayer(player: player)
                    .frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            ScrollViewReader { proxy in
                ScrollView {
                    Text(log)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .id("log")
                }
                .onChange(of: log) { _, _ in
                    proxy.scrollTo("log", anchor: .bottom)
                }
            }
            .padding(8)
            .background(Color(white: 0.12), in: RoundedRectangle(cornerRadius: 8))

            if busy {
                ProgressView("執行中…（第一次會比較久）")
                    .font(.footnote)
            }
        }
        .padding(16)
        .onDisappear {
            player?.pause()
        }
    }

    private func append(_ text: String) {
        log += text + "\n"
    }

    /// 執行一個 Python 呼叫，把結果和花的時間寫進記錄。
    private func run(_ title: String, _ work: @escaping () async throws -> String) {
        busy = true
        append("── \(title) ──")
        let started = Date()
        Task {
            do {
                let result = try await work()
                append(result)
            } catch {
                append("失敗：\(error.localizedDescription)")
            }
            append(String(format: "（%.1f 秒）", Date().timeIntervalSince(started)))
            busy = false
        }
    }

    private func resolve() {
        focused = false
        let target = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else {
            append("請先輸入網址")
            return
        }
        player?.pause()
        player = nil
        busy = true
        append("── 解析 \(target) ──")
        let started = Date()
        Task {
            do {
                let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
                let request: [String: Any] = [
                    "url": target,
                    "verbose": true,
                    "cache_dir": caches?.appendingPathComponent("yt-dlp").path ?? ""
                ]
                let argument = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8) ?? "{}"
                let raw = try await PythonRuntime.shared.call("resolve", argument: argument)
                show(raw)
            } catch {
                append("失敗：\(error.localizedDescription)")
            }
            append(String(format: "（%.1f 秒）", Date().timeIntervalSince(started)))
            busy = false
        }
    }

    /// 顯示解析結果：yt-dlp 的訊息、有哪些格式、選了哪一個，並開始播放。
    private func show(_ raw: String) {
        guard let result = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else {
            append("無法讀取結果：\(raw.prefix(300))")
            return
        }
        for line in (result["log"] as? [String]) ?? [] {
            append(String(line.prefix(400)))
        }
        guard (result["ok"] as? Bool) == true, let info = result["info"] as? [String: Any] else {
            append("解析失敗：\((result["error"] as? String) ?? "沒有錯誤訊息")")
            return
        }

        let formats = (info["formats"] as? [[String: Any]]) ?? []
        append("標題：\((info["title"] as? String) ?? "?")")
        append("直播：\((info["is_live"] as? Bool) == true ? "是" : "否")（\((info["live_status"] as? String) ?? "?")）")
        append("格式共 \(formats.count) 個：")
        for format in formats {
            let height = (format["height"] as? NSNumber).map { "\($0.intValue)p" } ?? "-"
            let manifest = format["manifest_url"] != nil ? " 主清單" : ""
            append("  \(text(format["format_id"])) \(text(format["ext"])) \(text(format["protocol"])) \(height) v=\(text(format["vcodec"]).prefix(12)) a=\(text(format["acodec"]).prefix(12))\(manifest)")
        }

        guard let stream = pick(formats) else {
            append("沒有原生播放器能播的格式（需要 HLS，或影音合一的 mp4）")
            return
        }
        append("選用：\(stream.label)")
        append("網址：\(stream.url.absoluteString.prefix(200))…")
        let player = AVPlayer(url: stream.url)
        self.player = player
        player.play()
        append("已經交給原生播放器播放；上面有畫面和聲音就表示成功。")
    }

    private func text(_ value: Any?) -> String {
        if let value = value as? String { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return "-"
    }

    /// 簡化版的選擇規則（正式版會照桌面版的 pickStream）：
    /// 有主清單的 HLS → 有影像的 HLS → 影音合一的 mp4（畫質最高）。
    private func pick(_ formats: [[String: Any]]) -> (url: URL, label: String)? {
        func isHLS(_ format: [String: Any]) -> Bool {
            ((format["protocol"] as? String) ?? "").hasPrefix("m3u8")
        }
        if let format = formats.first(where: { isHLS($0) && $0["manifest_url"] is String }),
           let url = URL(string: (format["manifest_url"] as? String) ?? "") {
            return (url, "HLS 主清單")
        }
        if let format = formats.last(where: { isHLS($0) && ($0["vcodec"] as? String) != "none" }),
           let url = URL(string: (format["url"] as? String) ?? "") {
            return (url, "HLS \(text(format["format_id"]))")
        }
        let muxed = formats.filter { format in
            let proto = (format["protocol"] as? String) ?? ""
            let ext = ((format["ext"] as? String) ?? "mp4").lowercased()
            return (proto == "https" || proto == "http")
                && (format["vcodec"] as? String) != "none" && (format["acodec"] as? String) != "none"
                && ["mp4", "m4v", "mov"].contains(ext)
        }
        let best = muxed.max { a, b in
            ((a["height"] as? NSNumber)?.intValue ?? 0) < ((b["height"] as? NSNumber)?.intValue ?? 0)
        }
        if let best, let url = URL(string: (best["url"] as? String) ?? "") {
            return (url, "mp4 \(text(best["format_id"]))")
        }
        return nil
    }
}
