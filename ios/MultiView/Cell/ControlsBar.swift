import MultiViewCore
import SwiftUI

/// 每一格下方的操作列（R127）：播放／暫停、喇叭、音量、亮度、更換網址、移除，以及進度條（R129）。
struct ControlsBar: View {
    @Environment(AppModel.self) private var model
    let index: Int
    let source: CellSource
    let supportsVolume: Bool
    /// 這一格貼著畫面邊緣時，按鈕要避開的範圍。
    var insets = EdgeInsets()

    @State private var showsVolume = false
    @State private var showsBrightness = false
    @State private var showsEdit = false

    var body: some View {
        VStack(spacing: 4) {
            if let progress = model.progress[source.id], ProgressRules.view(progress).kind != .live {
                ProgressBar(progress: progress) { fraction in
                    model.seek(index, fraction: fraction)
                }
            }

            // 格子太窄放不下時，次要按鈕收進「⋯」選單（R127）
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 2) {
                    playButton
                    muteButton
                    if supportsVolume { volumeButton }
                    brightnessButton
                    Spacer(minLength: 8)
                    editButton
                    removeButton
                }
                HStack(spacing: 2) {
                    playButton
                    muteButton
                    Spacer(minLength: 0)
                    moreMenu
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .padding(.leading, insets.leading)
        .padding(.trailing, insets.trailing)
        .padding(.bottom, insets.bottom)
        .background(.ultraThinMaterial)
        .sheet(isPresented: $showsEdit) {
            EditURLSheet(index: index, url: source.url)
                .presentationDetents([.height(230)])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: showsVolume || showsBrightness || showsEdit) { _, open in
            // 彈出視窗開著時，操作列不自動隱藏
            model.holdControls(open)
        }
        .onDisappear {
            model.holdControls(false)
        }
    }

    private var playButton: some View {
        let showsPause = model.status(of: source).showsPause
        return BarButton(icon: showsPause ? "pause.fill" : "play.fill", label: showsPause ? "暫停" : "播放") {
            model.togglePlay(index)
        }
    }

    private var muteButton: some View {
        BarButton(
            icon: source.muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
            label: source.muted ? "取消靜音" : "靜音",
            highlighted: !source.muted
        ) {
            model.toggleMute(index)
        }
    }

    private var volumeButton: some View {
        BarButton(icon: "slider.horizontal.3", label: "音量") {
            showsVolume = true
        }
        .popover(isPresented: $showsVolume) {
            SliderPopup(
                title: "音量",
                value: Double(source.volume),
                range: 0...Double(Volume.max),
                step: 1,
                resetValue: nil
            ) { value in
                model.setVolume(index, value)
            }
        }
    }

    private var brightnessButton: some View {
        BarButton(icon: "sun.max.fill", label: "亮度", highlighted: source.brightness != Brightness.default) {
            showsBrightness = true
        }
        .popover(isPresented: $showsBrightness) {
            SliderPopup(
                title: "亮度",
                value: Double(source.brightness),
                range: Double(Brightness.min)...Double(Brightness.max),
                step: Double(Brightness.step),
                resetValue: Double(Brightness.default)
            ) { value in
                model.setBrightness(index, value)
            }
        }
    }

    private var editButton: some View {
        BarButton(icon: "link", label: "更換網址") {
            beginEdit()
        }
    }

    private var removeButton: some View {
        BarButton(icon: "xmark", label: "移除") {
            model.removeSource(at: index)
        }
    }

    private var moreMenu: some View {
        Menu {
            if supportsVolume {
                Button("音量", systemImage: "slider.horizontal.3") { showsVolume = true }
            }
            Button("亮度", systemImage: "sun.max.fill") { showsBrightness = true }
            Button("更換網址", systemImage: "link") { beginEdit() }
            Button("移除", systemImage: "xmark", role: .destructive) { model.removeSource(at: index) }
        } label: {
            Image(systemName: "ellipsis")
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("更多")
        .popover(isPresented: $showsVolume) {
            SliderPopup(title: "音量", value: Double(source.volume), range: 0...Double(Volume.max), step: 1, resetValue: nil) { value in
                model.setVolume(index, value)
            }
        }
        .popover(isPresented: $showsBrightness) {
            SliderPopup(
                title: "亮度",
                value: Double(source.brightness),
                range: Double(Brightness.min)...Double(Brightness.max),
                step: Double(Brightness.step),
                resetValue: Double(Brightness.default)
            ) { value in
                model.setBrightness(index, value)
            }
        }
    }

    private func beginEdit() {
        showsEdit = true
    }
}

/// 操作列與工具列的圖示按鈕，最小 44pt（R127）。
struct BarButton: View {
    let icon: String
    let label: String
    var highlighted = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(highlighted ? Color.accentColor : Color.primary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// 按鈕＋彈出滑桿（桌面版 R42；亮度另有「重設」）。
struct SliderPopup: View {
    let title: String
    let range: ClosedRange<Double>
    let step: Double
    let resetValue: Double?
    let onChange: (Double) -> Void

    @State private var value: Double

    init(
        title: String, value: Double, range: ClosedRange<Double>, step: Double, resetValue: Double?,
        onChange: @escaping (Double) -> Void
    ) {
        self.title = title
        self.range = range
        self.step = step
        self.resetValue = resetValue
        self.onChange = onChange
        _value = State(initialValue: value)
    }

    var body: some View {
        VStack(spacing: 10) {
            Text("\(title) \(Int(value))%")
                .font(.callout.monospacedDigit())
            Slider(value: $value, in: range, step: step)
                .frame(width: 220)
            if let resetValue {
                Button("重設") {
                    value = resetValue
                }
                .disabled(value == resetValue)
            }
        }
        .padding(16)
        .presentationCompactAdaptation(.popover)
        .onChange(of: value) { _, newValue in
            onChange(newValue)
        }
    }
}

/// 進度條：點一下或拖曳跳到那個位置（R19、R129）。
struct ProgressBar: View {
    let progress: PlaybackProgress
    let onSeek: (Double) -> Void

    /// 拖曳中手指所在的比例；放開後才跳轉。
    @State private var dragFraction: Double?

    var body: some View {
        let display = ProgressRules.view(progress)
        let fraction = dragFraction ?? display.fraction

        HStack(spacing: 8) {
            Text(leadingText(fraction: fraction, display: display))
                .font(.caption2.monospacedDigit())

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(Color.accentColor)
                        .frame(width: CGFloat(max(0, min(1, fraction))) * geometry.size.width)
                }
                .frame(height: 4)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            guard geometry.size.width > 0 else { return }
                            dragFraction = max(0, min(1, Double(value.location.x / geometry.size.width)))
                        }
                        .onEnded { _ in
                            if let dragFraction {
                                onSeek(dragFraction)
                            }
                            dragFraction = nil
                        }
                )
            }
            .frame(height: 28)

            Text(trailingText(display: display))
                .font(.caption2.monospacedDigit())
        }
        .padding(.horizontal, 6)
    }

    private func leadingText(fraction: Double, display: ProgressDisplay) -> String {
        let seconds = ProgressRules.seekTarget(progress, fraction: fraction)
        if display.kind == .dvr {
            // 可回放的直播：顯示距離直播最新位置多久
            let behind = progress.end - seconds
            return behind <= ProgressRules.liveEdgeSeconds ? "直播" : ProgressRules.formatBehind(behind)
        }
        return ProgressRules.formatTime(seconds)
    }

    private func trailingText(display: ProgressDisplay) -> String {
        display.kind == .dvr ? "直播" : ProgressRules.formatTime(progress.end - progress.start)
    }
}
