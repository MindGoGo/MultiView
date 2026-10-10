import type { CSSProperties } from 'react'
import { cellRects, dividers, type Axis, type FracRect, type LayoutId, type Ratios } from '../lib/layout'
import { isVisible, type Slots } from '../lib/slots'
import type { NavState, PlayerHandle, PlayStatus } from '../players/types'
import type { Failure } from '../lib/webErrors'
import type { Progress } from '../lib/progress'
import type { CaptionTrack } from '../lib/captions'
import type { Quality } from '../lib/quality'
import { brightnessFilter } from '../lib/brightness'
import { YouTubePlayer } from '../players/YouTubePlayer'
import { VideoPlayer } from '../players/VideoPlayer'
import { WebPlayer } from '../players/WebPlayer'
import type { WebMode } from '../players/webTypes'
import { Cell } from './Cell'
import { Divider } from './Divider'

const EPS = 1e-6
/** 分隔線寬 2px：每格在內側邊緣各內縮 1px（R3） */
export function rectStyle(r: FracRect): CSSProperties {
  const l = r.x > EPS ? 1 : 0
  const t = r.y > EPS ? 1 : 0
  const rr = r.x + r.w < 1 - EPS ? 1 : 0
  const b = r.y + r.h < 1 - EPS ? 1 : 0
  return {
    left: `calc(${r.x * 100}% + ${l}px)`,
    top: `calc(${r.y * 100}% + ${t}px)`,
    width: `calc(${r.w * 100}% - ${l + rr}px)`,
    height: `calc(${r.h * 100}% - ${t + b}px)`
  }
}

interface Props {
  layout: LayoutId
  ratios: Ratios
  slots: Slots
  statuses: Record<number, PlayStatus>
  /** 網頁來源錯誤狀態的種類，依來源 id（R16） */
  failures: Record<number, Failure>
  registerPlayer(id: number, handle: PlayerHandle | null): void
  onStatus(id: number, status: PlayStatus, failure?: Failure): void
  onSubmitUrl(index: number, text: string): string | null
  onRemove(index: number): void
  onRetry(index: number): void
  /** 快轉、倒轉（R51） */
  onSkip(index: number, seconds: number): void
  /** 用方向鍵跳轉的格子與次數，那一格顯示操作區（R51） */
  poke: { index: number; n: number }
  /** 改用 YouTube 網頁播放（R48） */
  onUseYoutubeWeb(index: number): void
  onDividerDrag(axis: Axis, index: number, pos: number, containerPx: number): void
  onDividerReset(axis: Axis, index: number, containerPx: number): void
  /** 拖曳換位中：來源格與目前游標下的格子（R6） */
  move: { from: number; over: number | null } | null
  onMoveStart(index: number): void
  onMoveOver(index: number | null): void
  onMoveEnd(target: number | null): void
  onFocusAudio(index: number): void
  onToggleMute(index: number): void
  onVolume(index: number, volume: number): void
  /** 處於「直接操作播放器」的格子（R3） */
  direct: number | null
  onDirect(index: number): void
  /** 網頁來源的顯示模式，依來源 id（R13、R14） */
  webModes: Record<number, WebMode>
  onWebMode(id: number, mode: WebMode): void
  onToggleWebMode(index: number): void
  onToggleAdblock(index: number): void
  getProgress(index: number): Progress | null
  onSeek(index: number, seconds: number): void
  /** 單格全螢幕的格位（R20） */
  solo: number | null
  onToggleSolo(index: number): void
  onTogglePlay(index: number): void
  onLoaded(id: number): void
  /** 網頁來源能不能上一頁／下一頁，依來源 id（R28） */
  navStates: Record<number, NavState>
  onNavState(id: number, state: NavState): void
  onNav(index: number, back: boolean): void
  /** 從清單拖曳中、游標下的格子（R21） */
  listOver: number | null
  isFavorite(url: string): boolean
  onToggleFavorite(index: number): void
  onQuality(index: number, quality: Quality): void
  getQualityOptions(index: number): number[]
  onCaptions(index: number, key: string | null): void
  onBrightness(index: number, brightness: number): void
  /** 總亮度，和各格亮度相乘（R41） */
  masterBrightness: number
  getCaptionTracks(index: number): CaptionTrack[] | null
}

const FULL: FracRect = { x: 0, y: 0, w: 1, h: 1 }

/** 隱藏的網頁來源不能用 display: none，<webview> 會因此重新載入，改成看不見（R4 AC3） */
const HIDDEN_WEB_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0, width: '100%', height: '100%' }

export function Grid(props: Props) {
  const { layout, ratios, slots, statuses, solo } = props
  // 單格全螢幕時放大的那一格填滿整個畫面，其他格不顯示（R20）
  const layoutRects = cellRects(layout, ratios)
  const rects = solo === null ? layoutRects : layoutRects.map((_, i) => (i === solo ? FULL : null))

  // 播放器依 id 排序並固定在同一層，換位或切換版型時只改位置，不搬動 DOM，所以不會重新載入
  const placed = slots
    .map((source, index) => ({ source, index }))
    .filter((p): p is { source: NonNullable<typeof p.source>; index: number } => p.source !== null)
    .sort((a, b) => a.source.id - b.source.id)

  return (
    <div className="grid">
      {placed.map(({ source, index }) => {
        const visible = isVisible(index, layout, solo)
        const common = {
          ref: (h: PlayerHandle | null) => props.registerPlayer(source.id, h),
          muted: source.muted,
          volume: source.volume,
          autoplay: source.autoplay,
          active: visible,
          startAt: source.resume,
          onStatus: (s: PlayStatus, f?: Failure) => props.onStatus(source.id, s, f),
          onLoaded: () => props.onLoaded(source.id)
        }
        return (
          <div
            key={source.id}
            className="player-box"
            data-slot={index}
            style={{
              ...(visible
                ? rectStyle(rects[index] ?? FULL)
                : source.parsed.kind === 'web'
                  ? HIDDEN_WEB_STYLE
                  : { display: 'none' }),
              // 亮度只套在播放器上，格子的操作按鈕在另一層，不受影響（R40）
              filter: brightnessFilter(source.brightness, props.masterBrightness)
            }}
          >
            {source.parsed.kind === 'youtube' ? (
              <YouTubePlayer
                videoId={source.parsed.videoId}
                quality={source.quality}
                captions={source.captions}
                {...common}
              />
            ) : source.parsed.kind === 'web' ? (
              <WebPlayer
                url={source.parsed.url}
                adblock={source.adblock}
                mode={props.webModes[source.id] ?? 'video'}
                onModeChange={(mode) => props.onWebMode(source.id, mode)}
                onNavState={(s) => props.onNavState(source.id, s)}
                {...common}
              />
            ) : (
              <VideoPlayer kind={source.parsed.kind} url={source.parsed.url} quality={source.quality} {...common} />
            )}
          </div>
        )
      })}

      {rects.map((r, index) => {
        if (!r) return null
        const source = slots[index]
        return (
          <Cell
            key={index}
            index={index}
            style={rectStyle(r)}
            source={source}
            status={source ? statuses[source.id] : undefined}
            failure={source ? props.failures[source.id] : undefined}
            onSubmitUrl={props.onSubmitUrl}
            onRemove={props.onRemove}
            onRetry={props.onRetry}
            onSkip={props.onSkip}
            poke={props.poke.index === index ? props.poke.n : 0}
            onUseYoutubeWeb={props.onUseYoutubeWeb}
            canMove={layout !== '1' && solo === null}
            moving={props.move?.from === index}
            dropTarget={
              (props.move !== null && props.move.over === index && props.move.from !== index) || props.listOver === index
            }
            onMoveStart={props.onMoveStart}
            onMoveOver={props.onMoveOver}
            onMoveEnd={props.onMoveEnd}
            onFocusAudio={props.onFocusAudio}
            onToggleMute={props.onToggleMute}
            onVolume={props.onVolume}
            direct={props.direct === index}
            onDirect={props.onDirect}
            webMode={source ? (props.webModes[source.id] ?? 'video') : 'video'}
            onToggleWebMode={props.onToggleWebMode}
            onToggleAdblock={props.onToggleAdblock}
            isSolo={solo === index}
            favorite={source ? props.isFavorite(source.url) : false}
            onToggleFavorite={props.onToggleFavorite}
            onQuality={props.onQuality}
            getQualityOptions={props.getQualityOptions}
            onCaptions={props.onCaptions}
            onBrightness={props.onBrightness}
            getCaptionTracks={props.getCaptionTracks}
            onToggleSolo={props.onToggleSolo}
            onTogglePlay={props.onTogglePlay}
            nav={source ? props.navStates[source.id] : undefined}
            onNav={props.onNav}
            getProgress={props.getProgress}
            onSeek={props.onSeek}
          />
        )
      })}

      {(solo === null ? dividers(layout, ratios) : []).map((d) => (
        <Divider
          key={`${d.axis}-${d.index}`}
          def={d}
          onDrag={props.onDividerDrag}
          onReset={props.onDividerReset}
        />
      ))}
    </div>
  )
}
