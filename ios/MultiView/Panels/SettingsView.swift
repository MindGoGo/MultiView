import MultiViewCore
import SwiftUI
import UniformTypeIdentifiers

/// 設定畫面（桌面版 R96；iOS 版 R143）：播放方式、yt-dlp 版本與更新、匯入桌面版資料、清除網站資料、版本號。
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var importing = false
    /// 選了桌面版的設定檔：等使用者確認要不要取代目前的格子（R144）。
    @State private var pendingSettings: Settings?
    @State private var importMessage: String?
    @State private var confirmsClearData = false
    @State private var showsYtDlpTest = false

    private var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("YouTube 的播放方式") {
                    methodPicker("直播", \.live)
                    methodPicker("一般影片", \.vod)
                    Text("yt-dlp：沒有 YouTube 的按鈕與廣告，可以多格同時出聲。播不了時自動改用內嵌播放器。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("其他網站的播放方式") {
                    Picker("其他網站", selection: Binding(get: { model.webMethod }, set: { model.setWebMethod($0) })) {
                        Text("網頁").tag(WebMethod.web)
                        Text("yt-dlp").tag(WebMethod.ytdlp)
                    }
                    Text("yt-dlp：先試著用 yt-dlp 取得影片，成功時用 App 的播放器播放（可以多格同時出聲）；不支援的網站照樣顯示網頁。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("yt-dlp") {
                    LabeledContent("版本", value: model.ytdlpVersion ?? "—")
                    if let pending = model.ytdlpPendingVersion {
                        Text("已下載 \(pending)，重新開啟 App 後使用")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button(model.ytdlpUpdating ? "正在檢查更新…" : "檢查更新") {
                        model.checkYtDlpUpdate()
                    }
                    .disabled(model.ytdlpUpdating)
                    Button("yt-dlp 測試") {
                        showsYtDlpTest = true
                    }
                }

                Section("資料") {
                    Button("匯入桌面版資料…") {
                        importing = true
                    }
                    Text("選擇桌面版的 settings.json、lists.json（在 Windows 的 %APPDATA%\\MultiView 資料夾）。設定會取代目前的格子，清單會合併。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("清除網站資料", role: .destructive) {
                        confirmsClearData = true
                    }
                }

                Section {
                    Text(AppInfo.versionLabel(version: version, ytdlpVersion: model.ytdlpVersion))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: true) { result in
            handleImport(result)
        }
        .confirmationDialog(
            "匯入設定會取代目前的格子",
            isPresented: Binding(get: { pendingSettings != nil }, set: { if !$0 { pendingSettings = nil } }),
            titleVisibility: .visible
        ) {
            Button("取代目前的格子", role: .destructive) {
                if let settings = pendingSettings {
                    model.importSettings(settings)
                    appendImportMessage("已匯入設定")
                }
                pendingSettings = nil
            }
            Button("取消", role: .cancel) {
                pendingSettings = nil
            }
        }
        .alert("匯入結果", isPresented: Binding(get: { importMessage != nil && pendingSettings == nil }, set: { if !$0 { importMessage = nil } })) {
            Button("好") {
                importMessage = nil
            }
        } message: {
            Text(importMessage ?? "")
        }
        .confirmationDialog("清除網站資料？登入狀態會消失。", isPresented: $confirmsClearData, titleVisibility: .visible) {
            Button("清除", role: .destructive) {
                Task { await model.clearWebsiteData() }
            }
            Button("取消", role: .cancel) {}
        }
        .sheet(isPresented: $showsYtDlpTest) {
            YtDlpTestView(url: model.firstYouTubeURL ?? "")
        }
    }

    private func methodPicker(_ title: String, _ keyPath: WritableKeyPath<YouTubeMethods, PlayMethod>) -> some View {
        Picker(title, selection: Binding(
            get: { model.youtubeMethods[keyPath: keyPath] },
            set: { value in
                var methods = model.youtubeMethods
                methods[keyPath: keyPath] = value
                model.setYouTubeMethods(methods)
            }
        )) {
            Text("yt-dlp").tag(PlayMethod.ytdlp)
            Text("內嵌播放器").tag(PlayMethod.embed)
        }
    }

    private func appendImportMessage(_ text: String) {
        importMessage = [importMessage, text].compactMap { $0 }.joined(separator: "\n")
    }

    /// 讀取選到的檔案：是設定檔就等使用者確認，是清單檔就直接合併；其中一個錯誤不影響另一個（R144）。
    private func handleImport(_ result: Result<[URL], Error>) {
        importMessage = nil
        guard case .success(let urls) = result else {
            importMessage = "無法讀取這個檔案"
            return
        }
        for url in urls {
            let name = url.lastPathComponent
            let accessing = url.startAccessingSecurityScopedResource()
            defer {
                if accessing { url.stopAccessingSecurityScopedResource() }
            }
            guard let text = try? String(contentsOf: url, encoding: .utf8) else {
                appendImportMessage("\(name)：無法讀取這個檔案")
                continue
            }
            let settings = SettingsCodec.parse(text)
            if !settings.corrupt {
                pendingSettings = settings.settings
            } else if ListsCodec.looksLikeLists(text) {
                let summary = model.importLists(ListsCodec.parse(text).lists)
                appendImportMessage(summary.message)
            } else {
                appendImportMessage("\(name)：無法讀取這個檔案")
            }
        }
    }
}
