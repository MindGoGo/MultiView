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
}

export function Cell({ index, style, source, status, onSubmitUrl, onRemove, onRetry }: Props) {
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
    <div className={`cell ${source ? 'filled' : 'empty'}`} style={style}>
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
