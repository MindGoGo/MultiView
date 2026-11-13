import AVKit
import MultiViewCore
import SwiftUI

/// 畫面上方的工具列（R127）：版型、全部播放／暫停、全部靜音、總亮度。
struct ToolbarView: View {
    @Environment(AppModel.self) private var model
    @State private var showsBrightness = false

    private var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    var body: some View {
        // 畫面太窄放不下時（iPhone 直向）可以左右捲動
        ViewThatFits(in: .horizontal) {
            row
            ScrollView(.horizontal, showsIndicators: false) {
                row
            }
        }
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottomTrailing) {
            Text(AppInfo.versionLabel(version: version))
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .padding(.trailing, 8)
                .allowsHitTesting(false)
        }
        .onChange(of: showsBrightness || model.listPanelOpen || model.settingsOpen) { _, open in
            // 滑桿、清單、設定開著時，工具列不自動隱藏（R41 AC4、R21）
            model.holdControls(open)
        }
        .onDisappear {
            model.holdControls(false)
        }
    }

    private var row: some View {
        HStack(spacing: 4) {
            // 版型：小螢幕只有 1、2（R124）
            ForEach(model.availableLayouts, id: \.self) { layout in
                Button {
                    model.setLayout(layout)
                    model.keepControlsVisible()
                } label: {
                    Text(layout.label)
                        .font(.callout.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 36)
                        .background(
                            model.displayedLayout == layout ? Color.accentColor.opacity(0.35) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("版型 \(layout.label)")
            }

            Spacer(minLength: 8)

            let pauseAll = model.toggleAllAction == .pause
            BarButton(icon: pauseAll ? "pause.fill" : "play.fill", label: pauseAll ? "全部暫停" : "全部播放") {
                model.toggleAll()
            }
            BarButton(icon: "speaker.slash.fill", label: "全部靜音") {
                model.muteAll()
            }
            BarButton(
                icon: "sun.max.fill", label: "總亮度",
                highlighted: model.masterBrightness != Brightness.default
            ) {
                showsBrightness = true
            }
            .popover(isPresented: $showsBrightness) {
                SliderPopup(
                    title: "總亮度",
                    value: Double(model.masterBrightness),
                    range: Double(Brightness.min)...Double(Brightness.max),
                    step: Double(Brightness.step),
                    resetValue: Double(Brightness.default)
                ) { value in
                    model.setMasterBrightness(value)
                }
            }

            // AirPlay：把聲音送到 AirPlay 喇叭或 Apple TV（R132）
            AirPlayButton()
                .frame(width: 44, height: 44)
                .accessibilityLabel("AirPlay")

            BarButton(icon: "list.bullet", label: "清單", highlighted: model.listPanelOpen) {
                model.listPanelOpen.toggle()
                model.keepControlsVisible()
            }
            BarButton(icon: "gearshape.fill", label: "設定") {
                model.settingsOpen = true
            }

            Button {
                model.hideControls()
            } label: {
                Image(systemName: "chevron.up")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("隱藏工具列")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
    }
}

/// 系統的 AirPlay 選擇按鈕。
private struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .tintColor
        view.prioritizesVideoDevices = false
        return view
    }

    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
