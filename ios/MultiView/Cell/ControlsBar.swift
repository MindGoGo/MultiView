import MultiViewCore
import SwiftUI
import UIKit

/// 每一格的操作按鈕（R127；R166 改成像 YouTube App 一樣浮在影片上）：
/// 右上角子母畫面與齒輪選單、左下時間、右下移動與全螢幕、貼著影片底部的細進度條（R129）。
/// 左上角的喇叭與中間的播放／暫停鈕由 CellView 畫。
struct ControlsBar: View {
    @Environment(AppModel.self) private var model
    let index: Int
    let source: CellSource
    let supportsVolume: Bool
    /// 這一格貼著畫面邊緣時，按鈕要避開的範圍。
    var insets = EdgeInsets()
    /// 右上角按鈕上方要留的距離（避開瀏海與上方的工具列）。
    var topPadding: CGFloat = 0

    @State private var showsVolume = false
    @State private var showsBrightness = false
    @State private var showsEdit = false
    @State private var showsMore = false

    /// 進度條；直播沒有。
    @ViewBuilder private var progressBar: some View {
        if let progress = model.progress[source.id], ProgressRules.view(progress).kind != .live {
            ProgressBar(
                progress: progress, source: source, segments: model.segments(of: source), thin: true,
                onDragging: { model.holdControls($0) }
            ) { fraction in
                model.seek(index, fraction: fraction)
            }
        }
    }

    var body: some View {
        ZStack {
            // 上下兩層淡淡的漸層，讓白色按鈕在亮的畫面上也看得清楚
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.45), location: 0),
                    .init(color: .clear, location: 0.3),
                    .init(color: .clear, location: 0.6),
                    .init(color: .black.opacity(0.55), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .allowsHitTesting(false)

            // Spacer 不接收點擊：按鈕以外的地方照常交給影片（點一下收起、雙擊快轉）或網頁
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    Spacer(minLength: 0)
                    if model.supportsPictureInPicture(source) {
                        ChipButton(icon: "pip.enter", label: "子母畫面") {
                            model.startPictureInPicture(index)
                        }
                    }
                    moreMenu
                }
                // 和左上角的喇叭按鈕對齊
                .padding(.top, topPadding + 2)
                .padding(.trailing, 2)

                Spacer(minLength: 0)

                // 格子太窄放不下時間時只留右邊的按鈕
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 4) {
                        timeLabel
                        Spacer(minLength: 8)
                        bottomButtons
                    }
                    HStack(spacing: 4) {
                        Spacer(minLength: 0)
                        bottomButtons
                    }
                }
                .padding(.horizontal, 4)

                progressBar
            }
            .padding(.leading, insets.leading)
            .padding(.trailing, insets.trailing)
            .padding(.bottom, insets.bottom)
        }
        .sheet(isPresented: $showsEdit) {
            EditURLSheet(index: index, url: source.url)
                .presentationDetents([.height(230)])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: showsVolume || showsBrightness || showsEdit || showsMore) { _, open in
            // 彈出視窗開著時，操作列不自動隱藏
            model.holdControls(open)
        }
        .onDisappear {
            model.holdControls(false)
        }
    }

    @ViewBuilder private var bottomButtons: some View {
        if model.canSwap { moveHandle }
        soloButton
    }

    /// 左下角的時間膠囊：「目前 / 長度」；可回放的直播顯示距離最新位置多久，直播只顯示「直播」。
    @ViewBuilder private var timeLabel: some View {
        if let progress = model.progress[source.id] {
            let display = ProgressRules.view(progress)
            Text(Self.timeText(progress, kind: display.kind))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.black.opacity(0.55), in: Capsule())
                .fixedSize()
                .allowsHitTesting(false)
        }
    }

    static func timeText(_ progress: PlaybackProgress, kind: MultiViewCore.ProgressKind) -> String {
        switch kind {
        case .live:
            return "直播"
        case .dvr:
            let behind = progress.end - progress.current
            return behind <= ProgressRules.liveEdgeSeconds ? "直播" : ProgressRules.formatBehind(behind)
        case .vod:
            return "\(ProgressRules.formatTime(progress.current)) / \(ProgressRules.formatTime(progress.end - progress.start))"
        }
    }

    /// 「移動」：長按後拖到另一格放開，兩格互換（R125）。
    private var moveHandle: some View {
        Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
            .font(.callout)
            .foregroundStyle(model.swapFrom == index ? Color.accentColor : Color.white)
            .chip()
            .accessibilityLabel("移動（長按後拖到另一格）")
            .gesture(
                LongPressGesture(minimumDuration: 0.3)
                    .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named(GridView.coordinateSpace)))
                    .onChanged { value in
                        guard case .second(true, let drag) = value else { return }
                        if model.swapFrom == nil {
                            model.beginSwap(from: index)
                        }
                        if let drag {
                            model.updateSwap(location: drag.location)
                        }
                    }
                    .onEnded { value in
                        if case .second(true, let drag?) = value {
                            model.updateSwap(location: drag.location)
                            model.endSwap()
                        } else {
                            model.cancelSwap()
                        }
                    }
            )
    }

    /// 單格全螢幕（R20、R129）。
    private var soloButton: some View {
        // 上下排時是「進入全螢幕」（R164）
        let isSolo = model.solo == index && !model.companionStacked
        return ChipButton(
            icon: isSolo ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
            label: isSolo ? "離開全螢幕" : "全螢幕"
        ) {
            model.toggleSolo(index)
        }
    }

    /// 齒輪：音量、亮度、畫質、語音、字幕、網頁、最愛、更換網址、移除（R166）。
    /// 用系統的浮動選單；選單開著時操作列不自動收起。
    private var moreMenu: some View {
        MenuButton(systemImage: "gearshape.fill", accessibilityLabel: "設定", items: moreItems) { open in
            showsMore = open
        }
        .frame(width: ChipStyle.size, height: ChipStyle.size)
        .background(.black.opacity(ChipStyle.opacity), in: Circle())
        .padding(ChipStyle.padding)
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

    /// 畫質的子選單（R131）。
    private var qualityMenu: MenuItem {
        MenuItem(
            title: "畫質：\(source.quality.label)",
            systemImage: "tv",
            children: AppModel.qualityOptions.map { quality in
                MenuItem(title: quality.label, systemImage: "", checked: quality == source.quality) {
                    model.setQuality(index, quality)
                }
            }
        )
    }

    /// 語音（聲音軌）的子選單（R135、桌面版 R95）。
    private func audioMenu(_ audio: AudioMenu) -> MenuItem {
        let current = audio.options.first { $0.index == audio.current }
        return MenuItem(
            title: current.map { "語音：\($0.label)" } ?? "語音",
            systemImage: "waveform",
            children: audio.options.map { option in
                MenuItem(title: option.label, systemImage: "", checked: option.index == audio.current) {
                    model.setAudioTrack(index, option)
                }
            }
        )
    }

    /// 字幕的子選單（R131；規則同桌面版 R31）：「關閉」和各軌，目前的打勾。
    private func captionMenu(_ captions: CaptionMenu) -> MenuItem {
        let current = captions.tracks.first { $0.key == captions.current }
        var children = [MenuItem(title: "關閉", systemImage: "", checked: current == nil) {
            model.setCaption(index, nil)
        }]
        children += captions.tracks.map { track in
            MenuItem(title: track.label, systemImage: "", checked: track.key == current?.key) {
                model.setCaption(index, track)
            }
        }
        return MenuItem(
            title: "字幕：\(current?.label ?? "關閉")",
            systemImage: current == nil ? "captions.bubble" : "captions.bubble.fill",
            children: children
        )
    }

    /// 齒輪選單的項目。
    private func moreItems() -> [MenuItem] {
        var items: [MenuItem] = []
        if supportsVolume {
            items.append(MenuItem(title: "音量", systemImage: "slider.horizontal.3") { showsVolume = true })
        }
        items.append(MenuItem(title: "亮度", systemImage: "sun.max.fill") { showsBrightness = true })
        if model.supportsQuality(source) {
            items.append(qualityMenu)
        }
        if let audio = model.audioMenu(source) {
            items.append(audioMenu(audio))
        }
        if let captions = model.captionMenu(source) {
            items.append(captionMenu(captions))
        }
        if let mode = model.webMode(of: source) {
            items.append(MenuItem(
                title: mode == .page ? "只顯示影片" : "顯示整個網頁",
                systemImage: mode == .page ? "play.rectangle" : "doc.richtext"
            ) { model.toggleWebMode(index) })
            items.append(MenuItem(
                title: source.adblock ? "關閉廣告阻擋" : "開啟廣告阻擋",
                systemImage: source.adblock ? "shield.slash" : "shield.lefthalf.filled"
            ) { model.toggleAdblock(index) })
        }
        let favorite = model.isFavorite(source)
        items.append(MenuItem(title: favorite ? "從最愛移除" : "加入最愛", systemImage: favorite ? "star.fill" : "star") {
            model.toggleFavorite(index)
        })
        items.append(MenuItem(title: "更換網址", systemImage: "link") { showsEdit = true })
        items.append(MenuItem(title: "移除", systemImage: "xmark", destructive: true) { model.removeSource(at: index) })
        return items
    }
}

/// 浮在影片上的圓形按鈕的大小（R166）：和左上角的喇叭按鈕相同。
enum ChipStyle {
    static let size: CGFloat = 40
    static let opacity: Double = 0.55
    /// 按鈕外圍留的距離；加上按鈕本身，可以點的範圍是 44pt。
    static let padding: CGFloat = 2
}

extension View {
    /// 半透明黑色圓形底的浮動按鈕外觀（R166）。
    func chip() -> some View {
        frame(width: ChipStyle.size, height: ChipStyle.size)
            .background(.black.opacity(ChipStyle.opacity), in: Circle())
            .padding(ChipStyle.padding)
            .contentShape(Rectangle())
    }
}

/// 浮在影片上的圓形圖示按鈕（R166）。
struct ChipButton: View {
    let icon: String
    let label: String
    var highlighted = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.callout)
                .foregroundStyle(highlighted ? Color.accentColor : Color.white)
                .chip()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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
/// 拖曳中在手指上方顯示那個位置的時間，YouTube、mp4 的一般影片另有預覽縮圖（桌面版 R50）。
struct ProgressBar: View {
    let progress: PlaybackProgress
    let source: CellSource
    /// SponsorBlock 的片段（R161）：一般影片的進度條上畫出色塊。
    var segments: [SponsorSegment] = []
    /// 浮動操作列的細進度條（R166）：不顯示兩邊的時間（時間在左下角的膠囊），線條細、有圓點，拖曳時變粗。
    var thin = false
    /// 開始拖曳（true）、放開（false）：拖曳中操作列不自動收起（iOS 0.0.31 實測會收起，Android 沒有這個問題）。
    let onDragging: (Bool) -> Void
    let onSeek: (Double) -> Void

    /// 拖曳中手指所在的比例；放開後才跳轉。
    @State private var dragFraction: Double?

    var body: some View {
        let display = ProgressRules.view(progress)
        let fraction = dragFraction ?? display.fraction

        let lineHeight: CGFloat = thin ? (dragFraction == nil ? 3 : 6) : 4

        HStack(spacing: 8) {
            if !thin {
                Text(leadingText(fraction: fraction, display: display))
                    .font(.caption2.monospacedDigit())
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(Color.accentColor)
                        .frame(width: CGFloat(max(0, min(1, fraction))) * geometry.size.width)
                    // SponsorBlock 片段的色塊（R161），畫在已播放的部分上面；最窄 2pt
                    if display.kind == .vod {
                        let marks = SponsorBlockRules.marks(segments, duration: progress.end - progress.start)
                        ForEach(marks.indices, id: \.self) { index in
                            let mark = marks[index]
                            Rectangle()
                                .fill(mark.category.swiftUIColor)
                                .frame(width: max(2, CGFloat(mark.end - mark.start) * geometry.size.width))
                                .offset(x: CGFloat(mark.start) * geometry.size.width)
                        }
                    }
                }
                .frame(height: lineHeight)
                .clipShape(Capsule())
                .overlay(alignment: .leading) {
                    if thin {
                        // 目前位置的圓點
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 12, height: 12)
                            .offset(x: CGFloat(max(0, min(1, fraction))) * geometry.size.width - 6)
                            .allowsHitTesting(false)
                    }
                }
                .animation(.easeOut(duration: 0.12), value: lineHeight)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .overlay(alignment: .topLeading) {
                    if let dragFraction {
                        ProgressPreview(
                            source: source,
                            kind: display.kind,
                            segments: segments,
                            seconds: ProgressRules.seekTarget(progress, fraction: dragFraction),
                            duration: progress.end - progress.start,
                            time: leadingText(fraction: dragFraction, display: display),
                            fraction: dragFraction,
                            barWidth: geometry.size.width
                        )
                        // 高度 0、靠下對齊：提示的下緣貼著進度條上方，往上長（不依賴量到的高度）
                        .frame(width: geometry.size.width, height: 0, alignment: .bottomLeading)
                    }
                }
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            guard geometry.size.width > 0 else { return }
                            if dragFraction == nil { onDragging(true) }
                            dragFraction = max(0, min(1, Double(value.location.x / geometry.size.width)))
                        }
                        .onEnded { _ in
                            if let dragFraction {
                                onSeek(dragFraction)
                            }
                            dragFraction = nil
                            onDragging(false)
                        }
                )
            }
            .frame(height: thin ? 24 : 28)

            if !thin {
                Text(trailingText(display: display))
                    .font(.caption2.monospacedDigit())
            }
        }
        .padding(.horizontal, thin ? 12 : 6)
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

/// 拖曳進度條時手指上方的提示（桌面版 R50）：YouTube、mp4 的一般影片有預覽縮圖，其他只顯示時間。
/// 提示限制在進度條的範圍內；進度條比縮圖窄時只顯示時間。
private struct ProgressPreview: View {
    let source: CellSource
    let kind: MultiViewCore.ProgressKind
    let segments: [SponsorSegment]
    let seconds: Double
    let duration: Double
    let time: String
    let fraction: Double
    let barWidth: CGFloat

    /// 縮圖的寬度（桌面版 R50 是 160px）。
    static let imageWidth: CGFloat = 160

    @State private var image: UIImage?
    @State private var size: CGSize = .zero

    private var canShowImage: Bool {
        kind == .vod && barWidth >= Self.imageWidth && PreviewThumbnails.supports(source)
    }

    /// 每 2 秒換一張，拖曳時不要每一點都讀取。
    private var bucket: Int {
        seconds.isFinite ? Int(max(0, seconds) / 2) : 0
    }

    var body: some View {
        VStack(spacing: 2) {
            if canShowImage, let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: Self.imageWidth)
                    .background(Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            // 手指在 SponsorBlock 的片段上：顯示類別，左邊是和進度條一樣顏色的色塊（R161）
            if kind == .vod, let segment = SponsorBlockRules.segment(at: seconds, in: segments) {
                HStack(spacing: 4) {
                    Rectangle()
                        .fill(segment.category.swiftUIColor)
                        .frame(width: 10, height: 4)
                    Text(segment.category.label)
                        .font(.caption2)
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
            }
            Text(time)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
        }
        .fixedSize()
        // 量寬度只用來讓提示不超出進度條的左右範圍；量到之前也照常顯示
        // （iOS 0.0.30–0.0.32 用量到的大小決定透明度與位置，量不到時整個提示看不到）
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { size = proxy.size }
                    .onChange(of: proxy.size) { _, next in size = next }
            }
        )
        .offset(x: offsetX, y: -8)
        .allowsHitTesting(false)
        .task(id: PreviewRequest(bucket: bucket, enabled: canShowImage)) {
            guard canShowImage else { return }
            if let next = await PreviewThumbnails.image(for: source, seconds: seconds, duration: duration), !Task.isCancelled {
                image = next
            }
        }
    }

    private var offsetX: CGFloat {
        let x = CGFloat(fraction) * barWidth - size.width / 2
        return min(max(0, x), max(0, barWidth - size.width))
    }
}

private struct PreviewRequest: Equatable {
    var bucket: Int
    var enabled: Bool
}

