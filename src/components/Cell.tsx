import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Source } from '../lib/slots'
import { isAudible } from '../lib/audio'
import type { PlayStatus } from '../players/types'

interface Props {
  index: number
  style: CSSProperties
  source: Source | null
  status: PlayStatus | undefined
  /** 送出網址；回傳錯誤訊息，成功時回傳 null */
  onSubmitUrl(index: number, text: string): string | null
  onRemove(index: number): void
  onRetry(index: number): void
  canMove: boolean
  moving: boolean
  dropTarget: boolean
  onMoveStart(index: number): void
  onMoveOver(index: number | null): void
  /** target：放開時游標下的格子，不在任何格子上時為 null */
  onMoveEnd(target: number | null): void
  onFocusAudio(index: number): void
  onToggleMute(index: number): void
  onVolume(index: number, volume: number): void
  direct: boolean
  onDirect(index: number): void
}

/** 滑鼠靜止多久後隱藏操作按鈕（R3 AC2） */
const CONTROLS_IDLE_MS = 2000

/** 游標下的格子編號；不在任何格子上時回傳 null */
function cellIndexAt(x: number, y: number): number | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const cell = (el as HTMLElement).closest?.('.cell') as HTMLElement | null
    if (cell?.dataset.index) return Number(cell.dataset.index)
  }
  return null
}

export function Cell(props: Props) {
  const { index, style, source, status, onSubmitUrl, onRemove, onRetry } = props
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(idleTimer.current), [])

  const onMouseMove = () => {
    setHover(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setHover(false), CONTROLS_IDLE_MS)
  }
  const onMouseLeave = () => {
    clearTimeout(idleTimer.current)
    setHover(false)
  }

  const showInput = !source || editing
  const failed = source !== null && status === 'error' && !editing

  const closeInput = () => {
    setEditing(false)
    setText('')
    setError(null)
  }

  const submit = () => {
    if (text.trim() === '') return // R2 AC5
    const err = onSubmitUrl(index, text)
    if (err) setError(err)
    else closeInput()
  }

  return (
    <div
      className={`cell ${source ? 'filled' : 'empty'} ${props.moving ? 'moving' : ''} ${props.dropTarget ? 'drop-target' : ''} ${props.direct ? 'direct' : ''}`}
      style={style}
      data-index={index}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        // 只有點在格子本身（影片區域）才算，按鈕和輸入框不算（R7 獨占聲音）
        if (e.target === e.currentTarget) props.onFocusAudio(index)
      }}
    >
      {source && isAudible(source) && !showInput && (
        <div className="audio-indicator" title="有聲音">
          🔊
        </div>
      )}
      {showInput && (
        <div className="cell-center">
          <input
            className="url-input"
            autoFocus={editing}
            value={text}
            placeholder="貼上 YouTube、mp4 或 m3u8 網址"
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') closeInput()
            }}
          />
          {error && <div className="url-error">{error}</div>}
          {editing && (
            <button className="link" onClick={closeInput}>
              取消
            </button>
          )}
        </div>
      )}

      {failed && (
        <div className="cell-center cell-message">
          {source.parsed.kind === 'youtube' ? (
            <div>此影片無法在外部播放</div>
          ) : (
            <>
              <div>無法載入影片</div>
              <button onClick={() => onRetry(index)}>重試</button>
            </>
          )}
          <button onClick={() => setEditing(true)}>更換網址</button>
        </div>
      )}

      {source && !editing && (
        <div className={`cell-controls ${hover || props.moving ? 'show' : ''}`} onMouseMove={onMouseMove}>
          {props.canMove && (
            <button
              className="move-handle"
              title="拖曳到其他格子來交換位置"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                props.onMoveStart(index)
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  props.onMoveOver(cellIndexAt(e.clientX, e.clientY))
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                props.onMoveEnd(cellIndexAt(e.clientX, e.clientY))
              }}
            >
              移動
            </button>
          )}
          <button
            title={source.muted ? '開啟這一格的聲音' : '關閉這一格的聲音'}
            onClick={() => props.onToggleMute(index)}
          >
            {source.muted ? '🔇' : '🔊'}
          </button>
          <input
            className="volume"
            type="range"
            min={0}
            max={100}
            value={source.volume}
            title={`音量 ${source.volume}`}
            onChange={(e) => props.onVolume(index, Number(e.target.value))}
          />
          {source.parsed.kind === 'youtube' && (
            <button
              className={props.direct ? 'active' : ''}
              title="暫時讓滑鼠直接操作 YouTube 播放器（例如略過廣告），移出這一格後恢復"
              onClick={() => props.onDirect(index)}
            >
              直接操作
            </button>
          )}
          <button title="更換網址" onClick={() => setEditing(true)}>
            更換網址
          </button>
          <button title="移除" onClick={() => onRemove(index)}>
            移除
          </button>
        </div>
      )}
    </div>
  )
}
