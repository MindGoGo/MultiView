// 每格的進度條（R19）：R166 改成貼著影片底部的細進度條，時間移到左下角的時間膠囊。
// 播放／暫停只留中間的按鈕（R166），快轉、倒轉只用 ←／→ 快捷鍵（R51）。
import { useEffect, useRef, useState } from 'react'
import { formatBehind, formatTime, progressView, seekTarget, timeChip, type Progress } from '../lib/progress'
import { ProgressPreview, type PreviewSource } from './ProgressPreview'

interface Props {
  /** 操作區顯示中才更新進度 */
  active: boolean
  getProgress(): Progress | null
  onSeek(seconds: number): void
  /** 拖曳中操作區不隱藏 */
  onDragChange(dragging: boolean): void
  /** 有沒有進度（有進度才顯示播放鈕，R26、R30） */
  onAvailable?(available: boolean): void
  /** 預覽縮圖的來源（R50）；null 時只顯示時間 */
  preview: PreviewSource
  /** 時間提示顯示／消失時通知，顯示中操作區不隱藏（R50） */
  onHoverChange?(on: boolean): void
}

const POLL_MS = 250

export function ProgressBar({ active, getProgress, onSeek, onDragChange, onAvailable, preview, onHoverChange }: Props) {
  const [progress, setProgress] = useState<Progress | null>(null)
  /** 拖曳中游標所在的比例；沒有拖曳時為 null */
  const [drag, setDrag] = useState<number | null>(null)
  /** 游標在進度條上時的視窗座標 x（R50）；不在進度條上時為 null */
  const [hoverX, setHoverX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const getRef = useRef(getProgress)
  getRef.current = getProgress

  useEffect(() => {
    if (!active) return
    const update = () => setProgress(getRef.current())
    update()
    const timer = setInterval(update, POLL_MS)
    return () => clearInterval(timer)
  }, [active])

  const available = progress !== null
  const onAvailableRef = useRef(onAvailable)
  onAvailableRef.current = onAvailable
  useEffect(() => onAvailableRef.current?.(available), [available])

  const hovering = hoverX !== null
  const onHoverRef = useRef(onHoverChange)
  onHoverRef.current = onHoverChange
  useEffect(() => onHoverRef.current?.(hovering), [hovering])
  // 進度條消失時（例如變成沒有回放範圍的直播）提示也一起消失
  useEffect(() => () => onHoverRef.current?.(false), [])

  // 網站的影片在播放前不提供長度時沒有進度條與時間（R54）
  if (!progress) return null
  const view = progressView(progress)
  const chip = timeChip(progress, drag)
  // 左下角的時間膠囊；格子太窄時由 CSS 隱藏（R166）
  const chipEl = chip.toLive ? (
    <button className="time-chip to-live" title="回到直播最新位置" onClick={() => onSeek(progress.end)}>
      {chip.text}
    </button>
  ) : (
    <span className={`time-chip ${chip.text === '直播' ? 'live' : ''}`}>{chip.text}</span>
  )
  if (view.kind === 'live') return chipEl

  const fractionAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return r.width > 0 ? Math.min(Math.max((clientX - r.left) / r.width, 0), 1) : 0
  }
  const shown = drag ?? view.fraction

  return (
    <>
      {chipEl}
      <div
        className={`progress ${drag !== null ? 'dragging' : ''}`}
        ref={trackRef}
        title={view.kind === 'vod' ? '拖曳或點擊來跳轉' : '拖曳或點擊來倒轉直播'}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(fractionAt(e.clientX))
          onDragChange(true)
        }}
        onPointerMove={(e) => {
          setHoverX(e.clientX)
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setDrag(fractionAt(e.clientX))
        }}
        onPointerLeave={(e) => {
          // 拖曳中游標離開進度條時，提示仍然跟著游標（R50 AC5）
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) setHoverX(null)
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          e.currentTarget.releasePointerCapture(e.pointerId)
          // 放開才跳轉（R19 AC3）
          onSeek(seekTarget(progress, fractionAt(e.clientX)))
          setDrag(null)
          onDragChange(false)
          const r = e.currentTarget.getBoundingClientRect()
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setHoverX(null)
        }}
        onPointerCancel={() => {
          setDrag(null)
          setHoverX(null)
          onDragChange(false)
        }}
      >
        <div className="progress-rail" />
        <div className="progress-fill" style={{ width: `${shown * 100}%` }} />
        <div className="progress-thumb" style={{ left: `${shown * 100}%` }} />
      </div>
      {hoverX !== null && trackRef.current && (() => {
        const track = trackRef.current.getBoundingClientRect()
        const cell = trackRef.current.closest('.cell')?.getBoundingClientRect() ?? track
        const t = seekTarget(progress, fractionAt(hoverX))
        return (
          <ProgressPreview
            clientX={hoverX}
            track={track}
            bounds={cell}
            label={view.kind === 'vod' ? formatTime(t) : formatBehind(progress.end - t)}
            seconds={t}
            duration={progress.end}
            // 可回放的直播沒有預覽縮圖（R50）
            source={view.kind === 'vod' ? preview : null}
          />
        )
      })()}
    </>
  )
}
