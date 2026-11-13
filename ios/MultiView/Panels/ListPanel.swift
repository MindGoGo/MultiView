import MultiViewCore
import SwiftUI

/// 清單面板：最愛與歷史，分成 YouTube 和其他網站兩邊（桌面版 R21–R23、R58、R105；iOS 版 R141）。
struct ListPanel: View {
    @Environment(AppModel.self) private var model

    /// 清單中的一筆，連同它在整份清單裡的位置（編輯、刪除時用）。
    private struct Row: Identifiable {
        let index: Int
        let item: ListItem
        var id: String { item.url }
    }

    private struct Editing: Identifiable {
        let kind: ListKind
        let index: Int
        let item: ListItem
        var id: String { item.url }
    }

    @State private var editing: Editing?
    @State private var confirmsClear = false

    private var group: ListGroup { model.listTab.group }
    private var kind: ListKind { model.listTab.tab == .history ? .history : .favorites }

    private var rows: [Row] {
        let items = kind == .favorites ? model.lists.favorites : model.lists.history
        return items.enumerated()
            .filter { ListRules.group(of: $0.element.url) == group }
            .map { Row(index: $0.offset, item: $0.element) }
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if rows.isEmpty {
                Spacer()
                Text(kind == .favorites ? "還沒有最愛。\n播放影片時按操作列的星號加入。" : "還沒有歷史紀錄。")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                Spacer()
            } else {
                List {
                    ForEach(rows) { row in
                        Button {
                            model.openFromList(row.item.url)
                        } label: {
                            rowLabel(row.item)
                        }
                        .buttonStyle(.plain)
                        // 往左滑：編輯、刪除（R141）
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("刪除", role: .destructive) {
                                model.deleteListItem(kind: kind, index: row.index)
                            }
                            Button("編輯") {
                                editing = Editing(kind: kind, index: row.index, item: row.item)
                            }
                            .tint(.blue)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .background(.regularMaterial)
        .sheet(item: $editing) { target in
            EditListItemSheet(kind: target.kind, index: target.index, item: target.item)
                .presentationDetents([.height(300)])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog("清除這一邊的歷史紀錄？", isPresented: $confirmsClear, titleVisibility: .visible) {
            Button("清除", role: .destructive) {
                model.clearHistory(group: group)
            }
            Button("取消", role: .cancel) {}
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack {
                Text("清單")
                    .font(.headline)
                Spacer()
                if kind == .history, !rows.isEmpty {
                    Button("清除") {
                        confirmsClear = true
                    }
                }
                Button {
                    model.listPanelOpen = false
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("關閉清單")
            }

            Picker("來源", selection: Binding(
                get: { group },
                set: { model.setListTab(ListTab(group: $0, tab: kind == .history ? .history : .favorites)) }
            )) {
                Text("YouTube").tag(ListGroup.youtube)
                Text("其他網站").tag(ListGroup.other)
            }
            .pickerStyle(.segmented)

            Picker("分頁", selection: Binding(
                get: { kind == .history ? ListTab.Tab.history : ListTab.Tab.favorites },
                set: { model.setListTab(ListTab(group: group, tab: $0)) }
            )) {
                Text("最愛").tag(ListTab.Tab.favorites)
                Text("歷史").tag(ListTab.Tab.history)
            }
            .pickerStyle(.segmented)
        }
        .padding(12)
    }

    private func rowLabel(_ item: ListItem) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.name)
                .font(.callout)
                .lineLimit(2)
            Text(item.url)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if kind == .history {
                Text(ListRules.formatTime(item.time))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

/// 編輯清單的一筆：名稱和網址（R21）。
private struct EditListItemSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let kind: ListKind
    let index: Int

    @State private var name: String
    @State private var url: String
    @State private var error: String?
    @FocusState private var urlFocused: Bool

    init(kind: ListKind, index: Int, item: ListItem) {
        self.kind = kind
        self.index = index
        _name = State(initialValue: item.name)
        _url = State(initialValue: item.url)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("編輯")
                .font(.headline)

            TextField("名稱", text: $name)
                .textFieldStyle(.roundedBorder)

            URLField(text: $url, focused: $urlFocused, onSubmit: save)

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("取消", role: .cancel) {
                    dismiss()
                }
                Spacer()
                Button("儲存", action: save)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(maxWidth: 520)
    }

    private func save() {
        if let message = model.editListItem(kind: kind, index: index, url: url, name: name) {
            error = message
        } else {
            dismiss()
        }
    }
}
