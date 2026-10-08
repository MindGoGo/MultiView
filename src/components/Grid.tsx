import type { CSSProperties } from 'react'
import { cellRects, dividers, type Axis, type FracRect, type LayoutId, type Ratios } from '../lib/layout'
import { isVisible, type Slots } from '../lib/slots'
import type { PlayerHandle, PlayStatus } from '../players/types'
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
  registerPlayer(id: number, handle: PlayerHandle | null): void
  onStatus(id: number, status: PlayStatus): void
  onSubmitUrl(index: number, text: string): string | null
  onRemove(index: number): void
  onRetry(index: number): void
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
}

/** 隱藏的網頁來源不能用 display: none，<webview> 會因此重新載入，改成看不見（R4 AC3） */
const HIDDEN_WEB_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0, width: '100%', height: '100%' }

export function Grid(props: Props) {
  const { layout, ratios, slots, statuses } = props
  const rects = cellRects(layout, ratios)

  // 播放器依 id 排序並固定在同一層，換位或切換版型時只改位置，不搬動 DOM，所以不會重新載入
  const placed = slots
    .map((source, index) => ({ source, index }))
    .filter((p): p is { source: NonNullable<typeof p.source>; index: number } => p.source !== null)
    .sort((a, b) => a.source.id - b.source.id)

  return (
    <div className="grid">
      {placed.map(({ source, index }) => {
        const visible = isVisible(index, layout)
        const common = {
          ref: (h: PlayerHandle | null) => props.registerPlayer(source.id, h),
          muted: source.muted,
          volume: source.volume,
          autoplay: source.autoplay,
          active: visible,
          onStatus: (s: PlayStatus) => props.onStatus(source.id, s)
        }
        return (
          <div
            key={source.id}
            className="player-box"
            data-slot={index}
            style={
              visible
                ? rectStyle(rects[index])
                : source.parsed.kind === 'web'
                  ? HIDDEN_WEB_STYLE
                  : { display: 'none' }
            }
          >
            {source.parsed.kind === 'youtube' ? (
              <YouTubePlayer videoId={source.parsed.videoId} {...common} />
            ) : source.parsed.kind === 'web' ? (
              <WebPlayer
                url={source.parsed.url}
                mode={props.webModes[source.id] ?? 'video'}
                onModeChange={(mode) => props.onWebMode(source.id, mode)}
                {...common}
              />
            ) : (
              <VideoPlayer kind={source.parsed.kind} url={source.parsed.url} {...common} />
            )}
          </div>
        )
      })}

      {rects.map((r, index) => {
        const source = slots[index]
        return (
          <Cell
            key={index}
            index={index}
            style={rectStyle(r)}
            source={source}
            status={source ? statuses[source.id] : undefined}
            onSubmitUrl={props.onSubmitUrl}
            onRemove={props.onRemove}
            onRetry={props.onRetry}
            canMove={layout !== '1'}
            moving={props.move?.from === index}
            dropTarget={props.move !== null && props.move.over === index && props.move.from !== index}
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
          />
        )
      })}

      {dividers(layout, ratios).map((d) => (
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
