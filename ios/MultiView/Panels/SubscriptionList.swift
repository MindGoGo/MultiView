import MultiViewCore
import SwiftUI
import UniformTypeIdentifiers

/// 訂閱分頁（桌面版 R59–R61；iOS 版 R142）：訂閱的頻道、最新影片、正在直播的標示、從 Google Takeout 匯入。
struct SubscriptionList: View {
    @Environment(AppModel.self) private var model

    @State private var expanded: Set<String> = []
    @State private var adding = false
    @State private var addText = ""
    @State private var addBusy = false
    @State private var importing = false

    private var store: SubscriptionStore { model.subscriptions }

    /// 正在直播的排在最上面，其他依名稱排序（R60）。
    private var channels: [Channel] {
        model.lists.channels.sorted { a, b in
            let liveA = store.feeds[a.id]?.live != nil
            let liveB = store.feeds[b.id]?.live != nil
            if liveA != liveB { return liveA }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button("加入頻道", systemImage: "plus") {
                    addText = ""
                    adding = true
                }
                Button("匯入…") {
                    importing = true
                }
                Spacer()
                if store.anyLoading || addBusy {
                    ProgressView()
                }
                Button {
                    store.load(model.lists.channels.map(\.id), force: true)
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("重新整理")
            }
            .font(.callout)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            if channels.isEmpty {
                Spacer()
                Text("還沒有訂閱的頻道。\n\n按「加入頻道」貼上頻道或影片的網址；或到 Google Takeout（takeout.google.com）只勾選「YouTube 和 YouTube Music」裡的「訂閱內容」匯出，把壓縮檔裡的 subscriptions.csv 存到「檔案」後按「匯入…」。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding()
                Spacer()
            } else {
                List {
                    ForEach(channels, id: \.id) { channel in
                        channelRow(channel)
                    }
                }
                .listStyle(.plain)
            }
        }
        .task(id: model.lists.channels.map(\.id)) {
            // 開啟訂閱分頁時讀取，之後每 15 分鐘自動更新一次（面板開著時，R59）
            while !Task.isCancelled {
                store.load(model.lists.channels.map(\.id), force: false)
                try? await Task.sleep(for: .milliseconds(Int(YouTubeFeed.refreshInterval)))
            }
        }
        .alert("加入頻道", isPresented: $adding) {
            TextField("頻道或影片的網址", text: $addText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("加入") {
                add()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("貼上頻道網址（例如 youtube.com/@帳號）或影片網址。")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            importTakeout(result)
        }
    }

    @ViewBuilder
    private func channelRow(_ channel: Channel) -> some View {
        let feed = store.feeds[channel.id]
        let videos = feed?.videos ?? []
        let now = Date().timeIntervalSince1970 * 1000
        let fresh = YouTubeFeed.countNew(videos, now: now)
        let open = expanded.contains(channel.id)

        HStack(spacing: 8) {
            Button {
                if open {
                    expanded.remove(channel.id)
                } else {
                    expanded.insert(channel.id)
                    store.prioritize(channel.id)
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: open ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(channel.name)
                        .font(.callout)
                        .lineLimit(1)
                    if fresh > 0 {
                        // 24 小時內發布的新影片數量
                        Text("\(fresh)")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Color.accentColor.opacity(0.35), in: Capsule())
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let live = feed?.live {
                // 正在直播：按下播放那場直播（R60）
                Button {
                    model.openFromList(SourceParser.watchPageURL(videoID: live))
                } label: {
                    Text("● 直播中")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button("移除", role: .destructive) {
                model.removeChannel(channel.id)
            }
        }

        if open {
            if videos.isEmpty {
                Text(emptyText(feed))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 18)
            }
            ForEach(videos.prefix(15), id: \.videoID) { video in
                Button {
                    model.openFromList(SourceParser.watchPageURL(videoID: video.videoID))
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(video.title)
                            .font(.footnote)
                            .lineLimit(2)
                        let ago = YouTubeFeed.formatAgo(published: video.published, now: now)
                        if !ago.isEmpty {
                            Text(ago)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 18)
            }
        }
    }

    /// 展開後沒有影片時顯示的文字。失敗時帶上原因，方便回報問題。
    private func emptyText(_ feed: SubscriptionStore.Feed?) -> String {
        guard let feed else { return "讀取中…" }
        if feed.failed {
            return "無法取得最新影片" + (feed.failure.map { "（\($0)）" } ?? "")
        }
        return feed.loading || feed.videosLoading ? "讀取中…" : "沒有影片"
    }

    private func add() {
        let input = addText
        addBusy = true
        Task {
            if let message = await model.addChannel(input) {
                model.showToast(message)
            }
            addBusy = false
        }
    }

    private func importTakeout(_ result: Result<URL, Error>) {
        guard case .success(let url) = result else { return }
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
            if accessing { url.stopAccessingSecurityScopedResource() }
        }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            model.showToast("無法讀取這個檔案")
            return
        }
        model.showToast(model.importTakeout(text))
    }
}
