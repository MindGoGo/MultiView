import { useState, type CSSProperties } from 'react'
import type { Source } from '../lib/slots'
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
}

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
      className={`cell ${source ? 'filled' : 'empty'} ${props.moving ? 'moving' : ''} ${props.dropTarget ? 'drop-target' : ''}`}
      style={style}
      data-index={index}
    >
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
        <div className="cell-controls">
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
