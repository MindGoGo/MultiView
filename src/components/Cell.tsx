import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Source } from '../lib/slots'
import { isAudible } from '../lib/audio'
import type { PlayStatus } from '../players/types'
import type { WebMode } from '../players/webTypes'
import type { NavState } from '../players/types'
import { WEB_FAILURE_TEXT, type WebFailure } from '../lib/webErrors'
import type { Progress } from '../lib/progress'
import { ProgressBar } from './ProgressBar'
import { isPlayingStatus } from '../lib/playback'

interface Props {
  index: number
  style: CSSProperties
  source: Source | null
  status: PlayStatus | undefined
  failure: WebFailure | undefined
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
  /** 網頁來源的顯示模式（R13、R14）；其他來源固定為 video */
  webMode: WebMode
  onToggleWebMode(index: number): void
  onToggleAdblock(index: number): void
  getProgress(index: number): Progress | null
  onSeek(index: number, seconds: number): void
  /** 這一格正在單格全螢幕（R20） */
  isSolo: boolean
  onToggleSolo(index: number): void
  onTogglePlay(index: number): void
  /** 網頁來源能不能上一頁／下一頁（R28） */
  nav: NavState | undefined
  onNav(index: number, back: boolean): void
  /** 這一格的網址在最愛中（R22） */
  favorite: boolean
  onToggleFavorite(index: number): void
  onToggleQuality(index: number): void
}

/** 格子窄的時候只顯示圖示，完整名稱放在 title（R14 AC7） */
function Label({ full, icon }: { full: string; icon: string }) {
  return (
    <>
      <span className="lbl-full">{full}</span>
      <span className="lbl-icon">{icon}</span>
    </>
  )
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
  /** 拖曳進度條中，操作區不隱藏（R19） */
  const [seeking, setSeeking] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cellRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => clearTimeout(idleTimer.current), [])
  const isWeb = source?.parsed.kind === 'web'
  const pageMode = isWeb && props.webMode === 'page'

  const onMouseMove = () => {
    setHover(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setHover(false), CONTROLS_IDLE_MS)
  }
  const onMouseLeave = () => {
    clearTimeout(idleTimer.current)
    setHover(false)
  }

  // 整頁模式時游標在網頁上，格子收不到滑鼠事件，改用主程序回報的游標位置顯示操作按鈕（R14）
  const hoverHandlers = useRef({ onMouseMove, onMouseLeave })
  hoverHandlers.current = { onMouseMove, onMouseLeave }
  useEffect(() => {
    if (!pageMode) return
    let last = ''
    return window.multiview.onCursor((p) => {
      const r = cellRef.current?.getBoundingClientRect()
      const inside = !!r && p.inside && p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
      const key = `${p.x},${p.y}`
      if (!inside) hoverHandlers.current.onMouseLeave()
      else if (key !== last) hoverHandlers.current.onMouseMove()
      last = key
    })
  }, [pageMode])

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
      className={`cell ${source ? 'filled' : 'empty'} ${props.moving ? 'moving' : ''} ${props.dropTarget ? 'drop-target' : ''} ${props.direct || pageMode ? 'direct' : ''}`}
      ref={cellRef}
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
            placeholder="貼上 YouTube、mp4、m3u8 或影片網頁的網址"
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
          ) : isWeb ? (
            // 網頁載入失敗可以重試；DRM 只能更換網址（R16）
            <>
              <div>{WEB_FAILURE_TEXT[props.failure ?? 'load']}</div>
              {props.failure !== 'drm' && <button onClick={() => onRetry(index)}>重試</button>}
            </>
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
        <div className={`cell-controls ${hover || props.moving || seeking ? 'show' : ''}`} onMouseMove={onMouseMove}>
          {!failed && (
            <ProgressBar
              active={hover || seeking}
              getProgress={() => props.getProgress(index)}
              onSeek={(t) => props.onSeek(index, t)}
              onDragChange={setSeeking}
              playing={isPlayingStatus(status)}
              onTogglePlay={() => props.onTogglePlay(index)}
            />
          )}
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
              <Label full="移動" icon="✥" />
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
          {(source.parsed.kind === 'youtube' || (isWeb && !pageMode)) && (
            <button
              className={props.direct ? 'active' : ''}
              title={
                isWeb
                  ? '暫時讓滑鼠直接操作網頁，移出這一格後恢復'
                  : '暫時讓滑鼠直接操作 YouTube 播放器（例如略過廣告），移出這一格後恢復'
              }
              onClick={() => props.onDirect(index)}
            >
              <Label full="直接操作" icon="👆" />
            </button>
          )}
          {pageMode && (
            <>
              <button title="上一頁" disabled={!props.nav?.back} onClick={() => props.onNav(index, true)}>
                ←
              </button>
              <button title="下一頁" disabled={!props.nav?.forward} onClick={() => props.onNav(index, false)}>
                →
              </button>
            </>
          )}
          {isWeb && (
            <button
              title={pageMode ? '只顯示影片' : '顯示整個網頁，可以登入、關閉提示或按播放'}
              onClick={() => props.onToggleWebMode(index)}
            >
              {pageMode ? <Label full="只顯示影片" icon="▣" /> : <Label full="顯示整個網頁" icon="⛶" />}
            </button>
          )}
          {isWeb && (
            <button
              className={source.adblock ? 'active' : ''}
              title={source.adblock ? '廣告阻擋：開（按一下關閉，網頁會重新載入）' : '廣告阻擋：關（按一下開啟，網頁會重新載入）'}
              onClick={() => props.onToggleAdblock(index)}
            >
              <Label full={source.adblock ? '廣告阻擋：開' : '廣告阻擋：關'} icon={source.adblock ? '🛡' : '⊘'} />
            </button>
          )}
          {(source.parsed.kind === 'youtube' || source.parsed.kind === 'hls') && (
            <button
              className={source.quality === 'high' ? 'active' : ''}
              title={
                source.quality === 'high'
                  ? '畫質：高（按一下改成自動）'
                  : '畫質：自動，依格子大小決定（按一下改成高畫質，較耗網路和電腦資源）'
              }
              onClick={() => props.onToggleQuality(index)}
            >
              {source.quality === 'high' ? <Label full="畫質：高" icon="HD" /> : <Label full="畫質：自動" icon="A" />}
            </button>
          )}
          <button
            className={props.favorite ? 'active' : ''}
            title={props.favorite ? '從最愛移除' : '加入最愛'}
            onClick={() => props.onToggleFavorite(index)}
          >
            {props.favorite ? '★' : '☆'}
          </button>
          <button
            className={props.isSolo ? 'active' : ''}
            title={props.isSolo ? '離開全螢幕，回到分割畫面' : '把這一格放大到整個螢幕，其他格暫停'}
            onClick={() => props.onToggleSolo(index)}
          >
            {props.isSolo ? <Label full="離開全螢幕" icon="⤡" /> : <Label full="全螢幕" icon="⤢" />}
          </button>
          <button title="更換網址" onClick={() => setEditing(true)}>
            <Label full="更換網址" icon="✎" />
          </button>
          <button title="移除" onClick={() => onRemove(index)}>
            <Label full="移除" icon="✕" />
          </button>
        </div>
      )}
    </div>
  )
}
