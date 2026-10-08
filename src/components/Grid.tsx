import type { CSSProperties } from 'react'
import { cellRects, type FracRect, type LayoutId, type Ratios } from '../lib/layout'
import { isVisible, type Slots } from '../lib/slots'
import type { PlayerHandle, PlayStatus } from '../players/types'
import { YouTubePlayer } from '../players/YouTubePlayer'
import { VideoPlayer } from '../players/VideoPlayer'
import { Cell } from './Cell'

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
}

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
            style={visible ? rectStyle(rects[index]) : { display: 'none' }}
          >
            {source.parsed.kind === 'youtube' ? (
              <YouTubePlayer videoId={source.parsed.videoId} {...common} />
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
          />
        )
      })}
    </div>
  )
}
