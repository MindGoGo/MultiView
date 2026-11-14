import SwiftUI

/// 讀取動畫（桌面版 R99）：原創的小生物「麻糬」在格子中央彈跳，下方是「解析中…」或「載入中…」。
/// 圖案和動畫由桌面版 src/components/LoadingCritter.tsx、critter.css 改寫；不攔截點擊。
struct LoadingCritter: View {
    enum Kind {
        /// yt-dlp 解析中：立即顯示。
        case resolving
        /// 載入中、緩衝中：超過 0.5 秒才顯示，避免閃爍。
        case loading

        var label: String {
            switch self {
            case .resolving: return "解析中…"
            case .loading: return "載入中…"
            }
        }
    }

    let kind: Kind
    /// 格子的大小：小生物的大小跟著格子，格子太小時不顯示文字。
    let containerSize: CGSize

    @State private var visible = false

    private static let loadingDelay: Duration = .milliseconds(500)

    /// 小生物的邊長：格子短邊的 14%，限制在 24–52pt。
    private var side: CGFloat {
        min(max(min(containerSize.width, containerSize.height) * 0.14, 24), 52)
    }

    private var showsLabel: Bool {
        containerSize.width > 180 && containerSize.height > 110
    }

    var body: some View {
        VStack(spacing: 2) {
            TimelineView(.animation) { timeline in
                Canvas { context, size in
                    CritterDrawing.draw(in: &context, size: size, time: timeline.date.timeIntervalSinceReferenceDate)
                }
            }
            .frame(width: side, height: side)
            .shadow(color: .black.opacity(0.45), radius: 3, y: 2)

            if showsLabel {
                Text(kind.label)
                    .font(.caption)
                    .foregroundStyle(Color(red: 0.85, green: 0.96, blue: 0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 1)
                    .background(.black.opacity(0.55), in: Capsule())
                    .fixedSize()
            }
        }
        .opacity(visible ? 1 : 0)
        .allowsHitTesting(false)
        .accessibilityLabel(kind.label)
        .task(id: kind == .resolving) {
            if kind == .loading {
                try? await Task.sleep(for: Self.loadingDelay)
            }
            if !Task.isCancelled {
                visible = true
            }
        }
    }
}

/// 畫小生物。座標和桌面版的 SVG 相同（viewBox 是 10 18 80 80）。
private enum CritterDrawing {
    private static let bodyFill = Color(red: 0x9f / 255, green: 0xe7 / 255, blue: 0xcb / 255)
    private static let bodyStroke = Color(red: 0x6f / 255, green: 0xcf / 255, blue: 0xa9 / 255)
    private static let ink = Color(red: 0x21 / 255, green: 0x30 / 255, blue: 0x2b / 255)
    private static let cheek = Color(red: 1, green: 0x9f / 255, blue: 0xb3 / 255)

    private static let hopPeriod = 0.9
    private static let blinkPeriod = 3.2
    /// 身體的範圍：彈跳以底部中央為原點，高度的百分比換算成位移。
    private static let bodyBottom = CGPoint(x: 50, y: 89)
    private static let bodyHeight: CGFloat = 51

    /// 彈跳的關鍵影格：時間（0–1）、往上的位移（身體高度的比例）、橫向與縱向的縮放。落地壓扁、彈起拉長。
    private static let hopFrames: [(time: Double, lift: Double, scaleX: Double, scaleY: Double)] = [
        (0, 0, 1.14, 0.84),
        (0.15, 0.06, 0.92, 1.1),
        (0.5, 0.34, 1, 1),
        (0.85, 0.06, 0.95, 1.06),
        (1, 0, 1.14, 0.84)
    ]

    static func draw(in context: inout GraphicsContext, size: CGSize, time: TimeInterval) {
        let scale = min(size.width, size.height) / 80
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -10, y: -18)

        let phase = time.truncatingRemainder(dividingBy: hopPeriod) / hopPeriod
        let hop = interpolate(phase)

        // 影子：跳得越高越小、越淡
        let height = hop.lift / 0.34
        var shadow = context
        shadow.translateBy(x: 50, y: 93)
        shadow.scaleBy(x: 1.1 - 0.5 * height, y: 1.1 - 0.5 * height)
        shadow.opacity = 1 - 0.5 * height
        shadow.fill(
            Path(ellipseIn: CGRect(x: -22, y: -4.5, width: 44, height: 9)),
            with: .color(bodyFill.opacity(0.22))
        )

        // 身體：以底部中央為原點縮放，再往上移
        var body = context
        body.translateBy(x: bodyBottom.x, y: bodyBottom.y - hop.lift * bodyHeight)
        body.scaleBy(x: hop.scaleX, y: hop.scaleY)
        body.translateBy(x: -bodyBottom.x, y: -bodyBottom.y)

        var outline = Path()
        outline.move(to: CGPoint(x: 50, y: 38))
        outline.addCurve(to: CGPoint(x: 82, y: 67), control1: CGPoint(x: 69, y: 38), control2: CGPoint(x: 82, y: 51))
        outline.addCurve(to: CGPoint(x: 50, y: 89), control1: CGPoint(x: 82, y: 81), control2: CGPoint(x: 70, y: 89))
        outline.addCurve(to: CGPoint(x: 18, y: 67), control1: CGPoint(x: 30, y: 89), control2: CGPoint(x: 18, y: 81))
        outline.addCurve(to: CGPoint(x: 50, y: 38), control1: CGPoint(x: 18, y: 51), control2: CGPoint(x: 31, y: 38))
        outline.closeSubpath()
        body.fill(outline, with: .color(bodyFill))
        body.stroke(outline, with: .color(bodyStroke), lineWidth: 1.5)

        // 左上的光澤
        var gloss = body
        gloss.translateBy(x: 37, y: 50)
        gloss.rotate(by: .degrees(-25))
        gloss.fill(Path(ellipseIn: CGRect(x: -8, y: -4.5, width: 16, height: 9)), with: .color(.white.opacity(0.55)))

        // 眼睛：每 3.2 秒眨一次
        let blinkPhase = time.truncatingRemainder(dividingBy: blinkPeriod) / blinkPeriod
        let eyeScale = blinkScale(blinkPhase)
        var eyes = body
        eyes.translateBy(x: 50, y: 62)
        eyes.scaleBy(x: 1, y: eyeScale)
        eyes.translateBy(x: -50, y: -62)
        for x in [41.0, 59.0] {
            eyes.fill(Path(ellipseIn: CGRect(x: x - 3.4, y: 62 - 3.4, width: 6.8, height: 6.8)), with: .color(ink))
            eyes.fill(Path(ellipseIn: CGRect(x: x + 1.2 - 1, y: 60.8 - 1, width: 2, height: 2)), with: .color(.white))
        }

        // 腮紅
        for x in [33.0, 67.0] {
            body.fill(
                Path(ellipseIn: CGRect(x: x - 4.6, y: 69 - 2.8, width: 9.2, height: 5.6)),
                with: .color(cheek.opacity(0.75))
            )
        }

        // 嘴巴
        var mouth = Path()
        mouth.move(to: CGPoint(x: 47, y: 68.5))
        mouth.addQuadCurve(to: CGPoint(x: 53, y: 68.5), control: CGPoint(x: 50, y: 71.1))
        body.stroke(mouth, with: .color(ink), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))

        // 肚子上的播放符號
        var play = Path()
        play.move(to: CGPoint(x: 46.5, y: 75.5))
        play.addLine(to: CGPoint(x: 46.5, y: 83.5))
        play.addLine(to: CGPoint(x: 53.5, y: 79.5))
        play.closeSubpath()
        body.fill(play, with: .color(.white.opacity(0.9)))
        body.stroke(play, with: .color(.white.opacity(0.9)), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
    }

    /// 兩個關鍵影格之間平滑地變化。
    private static func interpolate(_ phase: Double) -> (lift: Double, scaleX: Double, scaleY: Double) {
        for index in 1..<hopFrames.count where phase <= hopFrames[index].time {
            let from = hopFrames[index - 1]
            let to = hopFrames[index]
            let linear = (phase - from.time) / (to.time - from.time)
            let eased = linear * linear * (3 - 2 * linear)
            return (
                from.lift + (to.lift - from.lift) * eased,
                from.scaleX + (to.scaleX - from.scaleX) * eased,
                from.scaleY + (to.scaleY - from.scaleY) * eased
            )
        }
        return (0, 1.14, 0.84)
    }

    /// 眨眼：週期的 90%–100% 之間閉一下眼。
    private static func blinkScale(_ phase: Double) -> Double {
        guard phase > 0.9 else { return 1 }
        let closing = phase < 0.93 ? (phase - 0.9) / 0.03 : 1 - (phase - 0.93) / 0.07
        return 1 - 0.9 * max(0, min(1, closing))
    }
}
