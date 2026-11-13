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

    /// 工具列的高度（按鈕 44pt 加上下留白）。
    private static let toolbarHeight: CGFloat = 56

    var body: some View {
        let player = model.player(for: source)
        let status = model.status(of: source)
        let active = model.activeCell == index

        ZStack {
            PlayerHostView(player: player)

            // 亮度：蓋一層黑色遮罩，不影響操作列（R130）
            Color.black
                .opacity(Brightness.dimOpacity(cell: source.brightness, master: model.masterBrightness))
                .allowsHitTesting(false)

            if !player.isInteractive {
                // 點擊攔截層：點一下只聽這一格，並顯示操作列與工具列（R127、R128）
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        model.tapCell(index)
                    }
            }

            statusOverlay(status: status, interactive: player.isInteractive)
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
            } else if player.isInteractive {
                // 整頁模式：點網頁就是操作網頁，用小把手叫出操作列（R127）
                handle
                    .padding(.bottom, insets.bottom)
            }
        }
        .animation(.easeOut(duration: 0.15), value: active)
        .clipped()
    }

    @ViewBuilder
    private func statusOverlay(status: PlayStatus, interactive: Bool) -> some View {
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
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                    .allowsHitTesting(false)
            }
        case .paused, .ended:
            if !interactive {
                // 中央的半透明播放鈕（R30）
                Button {
                    model.togglePlay(index)
                } label: {
                    Image(systemName: "play.fill")
                        .font(.title)
                        .frame(width: 64, height: 64)
                        .background(.black.opacity(0.45), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("播放")
            }
        case .playing:
            EmptyView()
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
