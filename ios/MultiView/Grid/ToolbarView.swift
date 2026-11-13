import MultiViewCore
import SwiftUI

/// 畫面上方的工具列（R127）：版型、全部播放／暫停、全部靜音、總亮度。
struct ToolbarView: View {
    @Environment(AppModel.self) private var model
    @State private var showsBrightness = false
    @State private var showsYtDlp = false

    private var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    /// 一組（直播或一般影片）的播放方式選單。
    private func methodPicker(_ keyPath: WritableKeyPath<YouTubeMethods, PlayMethod>) -> some View {
        Picker("播放方式", selection: Binding(
            get: { model.youtubeMethods[keyPath: keyPath] },
            set: { value in
                var methods = model.youtubeMethods
                methods[keyPath: keyPath] = value
                model.setYouTubeMethods(methods)
            }
        )) {
            Text("yt-dlp（沒有廣告，可以多格同時出聲）").tag(PlayMethod.ytdlp)
            Text("內嵌播放器").tag(PlayMethod.embed)
        }
    }

    var body: some View {
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

            // YouTube 的播放方式（R88、R135）
            Menu {
                Section("YouTube 直播") {
                    methodPicker(\.live)
                }
                Section("YouTube 一般影片") {
                    methodPicker(\.vod)
                }
            } label: {
                Image(systemName: "gearshape.fill")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("播放方式")

            // 技術驗證用（R122），正式版會拿掉
            BarButton(icon: "hammer.fill", label: "yt-dlp 測試") {
                showsYtDlp = true
            }
            .sheet(isPresented: $showsYtDlp) {
                YtDlpTestView(url: model.firstYouTubeURL ?? "")
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
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottomTrailing) {
            Text(AppInfo.versionLabel(version: version))
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .padding(.trailing, 8)
                .allowsHitTesting(false)
        }
        .onChange(of: showsBrightness || showsYtDlp) { _, open in
            // 滑桿開著時，工具列不自動隱藏（R41 AC4）
            model.holdControls(open)
        }
        .onDisappear {
            model.holdControls(false)
        }
    }
}
