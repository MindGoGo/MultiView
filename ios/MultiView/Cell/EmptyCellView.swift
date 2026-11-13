import MultiViewCore
import SwiftUI

/// 空白格：網址輸入框與「貼上」按鈕（R126）。
struct EmptyCellView: View {
    @Environment(AppModel.self) private var model
    let index: Int

    @State private var text = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Color.black
                .contentShape(Rectangle())
                .onTapGesture {
                    focused = false
                }

            VStack(spacing: 10) {
                Text("貼上 YouTube、mp4、m3u8 或影片網頁的網址")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                HStack(spacing: 8) {
                    TextField("https://", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit {
                            submit(text)
                        }

                    // 系統的「貼上」按鈕：按下時不會再跳出允許貼上的詢問
                    PasteButton(payloadType: String.self) { strings in
                        guard let pasted = strings.first else { return }
                        Task { @MainActor in
                            text = pasted
                            submit(pasted)
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.roundedRectangle)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .frame(maxWidth: 420)
            .padding(12)
        }
    }

    private func submit(_ value: String) {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let message = model.setSource(value, at: index) {
            error = message
        } else {
            error = nil
            text = ""
            focused = false
        }
    }
}
