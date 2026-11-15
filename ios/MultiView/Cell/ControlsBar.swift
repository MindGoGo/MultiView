import MultiViewCore
import SwiftUI
import UIKit

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
    @State private var showsMore = false

    var body: some View {
        VStack(spacing: 4) {
            if let progress = model.progress[source.id], ProgressRules.view(progress).kind != .live {
                ProgressBar(progress: progress, source: source) { fraction in
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
                    if model.supportsQuality(source) { qualityButton }
                    if let audio = model.audioMenu(source) { audioButton(audio) }
                    if let captions = model.captionMenu(source) { captionButton(captions) }
                    Spacer(minLength: 8)
                    if model.canSwap { moveHandle }
                    soloButton
                    if model.supportsPictureInPicture(source) { pictureInPictureButton }
                    if let mode = model.webMode(of: source) {
                        webModeButton(mode)
                        adblockButton
                    }
                    favoriteButton
                    editButton
                    removeButton
                }
                HStack(spacing: 2) {
                    playButton
                    muteButton
                    Spacer(minLength: 0)
                    if model.canSwap { moveHandle }
                    soloButton
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
        .onChange(of: showsVolume || showsBrightness || showsEdit || showsMore) { _, open in
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

    /// 「移動」：長按後拖到另一格放開，兩格互換（R125）。
    private var moveHandle: some View {
        Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
            .font(.body)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .foregroundStyle(model.swapFrom == index ? Color.accentColor : Color.primary)
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
        let isSolo = model.solo == index
        return BarButton(
            icon: isSolo ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right",
            label: isSolo ? "離開全螢幕" : "全螢幕",
            highlighted: isSolo
        ) {
            model.toggleSolo(index)
        }
    }

    /// 子母畫面（只有原生播放器，R132）。
    private var pictureInPictureButton: some View {
        BarButton(icon: "pip.enter", label: "子母畫面") {
            model.startPictureInPicture(index)
        }
    }

    /// 「顯示整個網頁」／「只顯示影片」（R14）。
    private func webModeButton(_ mode: WebMode) -> some View {
        BarButton(
            icon: mode == .page ? "play.rectangle" : "doc.richtext",
            label: mode == .page ? "只顯示影片" : "顯示整個網頁",
            highlighted: mode == .page
        ) {
            model.toggleWebMode(index)
        }
    }

    /// 廣告阻擋的開關（R17、R138）。
    private var adblockButton: some View {
        BarButton(
            icon: source.adblock ? "shield.lefthalf.filled" : "shield.slash",
            label: source.adblock ? "廣告阻擋：開" : "廣告阻擋：關",
            highlighted: source.adblock
        ) {
            model.toggleAdblock(index)
        }
    }

    /// 加入或移出最愛（R22）。
    private var favoriteButton: some View {
        let favorite = model.isFavorite(source)
        return BarButton(icon: favorite ? "star.fill" : "star", label: favorite ? "從最愛移除" : "加入最愛", highlighted: favorite) {
            model.toggleFavorite(index)
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

    /// 「⋯」：放不下的按鈕（R127）。用系統的浮動選單；選單開著時操作列不自動收起。
    private var moreMenu: some View {
        MenuButton(systemImage: "ellipsis", accessibilityLabel: "更多", items: moreItems) { open in
            showsMore = open
        }
        .frame(width: 44, height: 44)
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

    /// 畫質按鈕（寬的操作列）。
    private var qualityButton: some View {
        MenuButton(systemImage: "tv", accessibilityLabel: "畫質", items: { qualityMenu.children }) { open in
            showsMore = open
        }
        .frame(width: 44, height: 44)
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

    /// 語音按鈕（寬的操作列）。
    private func audioButton(_ audio: AudioMenu) -> some View {
        MenuButton(systemImage: "waveform", accessibilityLabel: "語音", items: { audioMenu(audio).children }) { open in
            showsMore = open
        }
        .frame(width: 44, height: 44)
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

    /// 字幕按鈕（寬的操作列）：開著時用強調色。
    private func captionButton(_ captions: CaptionMenu) -> some View {
        let on = captions.tracks.contains { $0.key == captions.current }
        return MenuButton(
            systemImage: on ? "captions.bubble.fill" : "captions.bubble",
            accessibilityLabel: "字幕",
            items: { captionMenu(captions).children },
            highlighted: on
        ) { open in
            showsMore = open
        }
        .frame(width: 44, height: 44)
    }

    /// 「⋯」選單的項目。
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
        if model.supportsPictureInPicture(source) {
            items.append(MenuItem(title: "子母畫面", systemImage: "pip.enter") { model.startPictureInPicture(index) })
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
        items.append(MenuItem(title: "更換網址", systemImage: "link") { beginEdit() })
        items.append(MenuItem(title: "移除", systemImage: "xmark", destructive: true) { model.removeSource(at: index) })
        return items
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
/// 拖曳中在手指上方顯示那個位置的時間，YouTube、mp4 的一般影片另有預覽縮圖（桌面版 R50）。
struct ProgressBar: View {
    let progress: PlaybackProgress
    let source: CellSource
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
                .overlay(alignment: .topLeading) {
                    if let dragFraction {
                        ProgressPreview(
                            source: source,
                            kind: display.kind,
                            seconds: ProgressRules.seekTarget(progress, fraction: dragFraction),
                            duration: progress.end - progress.start,
                            time: leadingText(fraction: dragFraction, display: display),
                            fraction: dragFraction,
                            barWidth: geometry.size.width
                        )
                    }
                }
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

/// 拖曳進度條時手指上方的提示（桌面版 R50）：YouTube、mp4 的一般影片有預覽縮圖，其他只顯示時間。
/// 提示限制在進度條的範圍內；進度條比縮圖窄時只顯示時間。
private struct ProgressPreview: View {
    let source: CellSource
    let kind: MultiViewCore.ProgressKind
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
            Text(time)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
        }
        .fixedSize()
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: PreviewSizeKey.self, value: proxy.size)
            }
        )
        .onPreferenceChange(PreviewSizeKey.self) { size = $0 }
        // 畫在進度條上方，不超出進度條的左右範圍
        .offset(x: offsetX, y: -size.height - 8)
        .opacity(size == .zero ? 0 : 1)
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

private struct PreviewSizeKey: PreferenceKey {
    static var defaultValue: CGSize = .zero

    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        value = nextValue()
    }
}
