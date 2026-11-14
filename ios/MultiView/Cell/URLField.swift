import MultiViewCore
import SwiftUI

/// 網址輸入框，右邊有清除按鈕（R126）。
struct URLField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            TextField("https://", text: $text)
                .textFieldStyle(.plain)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused(focused)
                .onSubmit(onSubmit)

            if !text.isEmpty {
                Button {
                    text = ""
                    focused.wrappedValue = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除")
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .frame(minHeight: 36)
        .background(Color(white: 0.22), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// 更換網址的小視窗：輸入框（可以清除）、貼上、確定（R126）。
struct EditURLSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let index: Int

    @State private var text: String
    @State private var error: String?
    @FocusState private var focused: Bool

    init(index: Int, url: String) {
        self.index = index
        _text = State(initialValue: url)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("更換網址")
                .font(.headline)

            HStack(spacing: 8) {
                URLField(text: $text, focused: $focused, onSubmit: confirm)

                PasteButton(payloadType: String.self) { strings in
                    guard let pasted = strings.first else { return }
                    Task { @MainActor in
                        text = pasted
                        error = nil
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

            HStack {
                Button("取消", role: .cancel) {
                    dismiss()
                }
                Spacer()
                Button("確定", action: confirm)
                    .buttonStyle(.borderedProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(maxWidth: 520)
        .onAppear {
            focused = true
        }
    }

    private func confirm() {
        if let message = model.setSource(text, at: index) {
            error = message
        } else {
            dismiss()
        }
    }
}
