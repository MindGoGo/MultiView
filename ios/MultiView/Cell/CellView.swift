import MultiViewCore
import SwiftUI

/// 有來源的格子：播放器、亮度遮罩、點擊攔截層、聲音圖示、操作列（R127–R130）。
struct CellView: View {
    @Environment(AppModel.self) private var model
    let index: Int
    let source: CellSource
    /// 這一格貼著畫面邊緣時要避開的範圍（瀏海、圓角、Home 指示條）。
    var insets = EdgeInsets()
    /// 這一格在畫面最上面一列：喇叭按鈕要往下移，避開工具列。
    var touchesTop = false

    /// 雙擊快轉、倒轉時，畫面中間短暫顯示的文字（R129）。
    @State private var skipHint: String?
    @State private var skipHintTask: Task<Void, Never>?

    /// 工具列的高度（按鈕 44pt 加上下留白）。
    private static let toolbarHeight: CGFloat = 56
    /// 兩指張開、捏合超過這個比例才進入、離開單格全螢幕（R129）。
    private static let enterSoloScale: CGFloat = 1.25
    private static let exitSoloScale: CGFloat = 0.8

    var body: some View {
        let player = model.player(for: source)
        let status = model.status(of: source)
        let active = model.activeCell == index
        // 整頁模式：手指操作直接交給網頁（R127）
        let interactive = model.isInteractive(source)

        ZStack {
            PlayerHostView(player: player)

            // 亮度：蓋一層黑色遮罩，不影響操作列（R130）
            Color.black
                .opacity(Brightness.dimOpacity(cell: source.brightness, master: model.masterBrightness))
                .allowsHitTesting(false)

            if !interactive {
                touchLayer
            }

            statusOverlay(status: status, interactive: interactive, active: active, resolving: player.isResolving)

            if let skipHint {
                Text(skipHint)
                    .font(.headline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.55), in: Capsule())
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topLeading) {
            if model.toolbarVisible {
                // 工具列顯示時，每一格左上角都有喇叭按鈕：只切換這一格的聲音，
                // 不像點格子那樣把其他格子靜音，用來讓多格同時出聲（R128）
                Button {
                    model.toggleMute(index)
                } label: {
                    Image(systemName: source.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.callout)
                        .foregroundStyle(source.muted ? Color.primary : Color.accentColor)
                        .frame(width: 40, height: 40)
                        .background(.black.opacity(0.55), in: Circle())
                        .padding(4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(source.muted ? "取消靜音" : "靜音")
                .overlay(alignment: .trailing) {
                    // 播放方式的小標示（R109）
                    if let badge = model.badge(of: source) {
                        Text(badge)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(.black.opacity(0.55), in: Capsule())
                            .fixedSize()
                            .alignmentGuide(.trailing) { $0[.leading] }
                            .allowsHitTesting(false)
                    }
                }
                .padding(.top, insets.top + (touchesTop ? Self.toolbarHeight : 0))
                .padding(.leading, insets.leading)
            } else if source.isAudible {
                // 有聲音的格子一直顯示小喇叭（R7 AC5）
                Image(systemName: "speaker.wave.2.fill")
                    .font(.caption)
                    .padding(6)
                    .background(.black.opacity(0.45), in: Circle())
                    .padding(6)
                    .padding(.top, insets.top)
                    .padding(.leading, insets.leading)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .bottom) {
            if active {
                ControlsBar(index: index, source: source, supportsVolume: player.supportsVolume, insets: insets)
                    .transition(.opacity)
            } else if interactive {
                // 整頁模式：點網頁就是操作網頁，用小把手叫出操作列（R127）
                handle
                    .padding(.bottom, insets.bottom)
            }
        }
        .animation(.easeOut(duration: 0.15), value: active)
        .animation(.easeOut(duration: 0.15), value: skipHint)
        .clipped()
    }

    /// 點擊攔截層：點一下只聽這一格並顯示操作列與工具列（R127、R128）；
    /// 雙擊左邊、右邊 1/3 倒轉、快轉 10 秒；兩指張開、捏合進出單格全螢幕（R129）。
    private var touchLayer: some View {
        GeometryReader { geometry in
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { location in
                    doubleTap(at: location.x, width: geometry.size.width)
                }
                .onTapGesture {
                    model.tapCell(index)
                }
                // 長按影片後拖到另一格放開：兩格互換（R125）。和操作列的「移動」按鈕相同，
                // 但不用從畫面下緣開始拖
                .gesture(
                    LongPressGesture(minimumDuration: 0.45)
                        .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named(GridView.coordinateSpace)))
                        .onChanged { value in
                            guard model.canSwap, case .second(true, let drag) = value else { return }
                            if model.swapFrom == nil {
                                model.beginSwap(from: index)
                            }
                            if let drag {
                                model.updateSwap(location: drag.location)
                            }
                        }
                        .onEnded { value in
                            if case .second(true, let drag?) = value, model.swapFrom != nil {
                                model.updateSwap(location: drag.location)
                                model.endSwap()
                            } else {
                                model.cancelSwap()
                            }
                        }
                )
                .simultaneousGesture(
                    MagnifyGesture()
                        .onEnded { value in
                            if model.solo == nil, value.magnification > Self.enterSoloScale {
                                model.enterSolo(index)
                            } else if model.solo == index, value.magnification < Self.exitSoloScale {
                                model.exitSolo()
                            }
                        }
                )
        }
    }

    private func doubleTap(at x: CGFloat, width: CGFloat) {
        guard width > 0 else { return }
        let third = x / width
        let seconds: Double
        if third < 1.0 / 3 {
            seconds = -ProgressRules.doubleTapSkipSeconds
        } else if third > 2.0 / 3 {
            seconds = ProgressRules.doubleTapSkipSeconds
        } else {
            // 中間 1/3 等於點一下
            model.tapCell(index)
            return
        }
        // 直播和沒有進度條的格子不作用
        guard model.skip(index, seconds: seconds) else { return }
        showSkipHint(seconds > 0 ? "+\(Int(seconds)) 秒" : "−\(Int(-seconds)) 秒")
    }

    private func showSkipHint(_ text: String) {
        skipHint = text
        skipHintTask?.cancel()
        skipHintTask = Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            skipHint = nil
        }
    }

    /// 中央的半透明播放／暫停鈕（R30）。
    private func centerButton(icon: String, label: String) -> some View {
        Button {
            model.togglePlay(index)
        } label: {
            Image(systemName: icon)
                .font(.title)
                .frame(width: 64, height: 64)
                .background(.black.opacity(0.45), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func statusOverlay(status: PlayStatus, interactive: Bool, active: Bool, resolving: Bool) -> some View {
        switch status {
        case .error:
            Text(model.errors[source.id] ?? "無法播放")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .padding(10)
                .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                .padding(12)
                .allowsHitTesting(false)
        case .loading:
            if !interactive {
                // 讀取動畫：彈跳的小生物（R99）。網頁來源不顯示，網頁本身會逐步顯示內容
                GeometryReader { geometry in
                    LoadingCritter(kind: resolving ? .resolving : .loading, containerSize: geometry.size)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                }
                .allowsHitTesting(false)
            }
        case .paused, .ended:
            if !interactive {
                // 暫停時一直顯示播放鈕
                centerButton(icon: "play.fill", label: "播放")
            }
        case .playing:
            if !interactive, active {
                // 播放中：點一下格子、操作列顯示時才出現暫停鈕
                centerButton(icon: "pause.fill", label: "暫停")
            }
        }
    }

    private var handle: some View {
        Button {
            model.showControls(for: index)
        } label: {
            Image(systemName: "ellipsis")
                .font(.footnote.weight(.bold))
                .frame(width: 44, height: 24)
                .background(.black.opacity(0.55), in: Capsule())
                .padding(6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("顯示操作列")
    }
}
