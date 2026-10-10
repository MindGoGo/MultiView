import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isYouTubeSite } from '../lib/source'
import type { Source } from '../lib/slots'
import { isAudible } from '../lib/audio'
import type { PlayStatus } from '../players/types'
import type { WebMode } from '../players/webTypes'
import type { NavState } from '../players/types'
import { WEB_FAILURE_TEXT, YOUTUBE_FAILURE_TEXT, type Failure, type WebFailure, type YouTubeFailure } from '../lib/webErrors'
import type { Progress } from '../lib/progress'
import { ProgressBar } from './ProgressBar'
import { isPlayingStatus } from '../lib/playback'
import type { CaptionTrack } from '../lib/captions'
import { qualityLabel, type Quality } from '../lib/quality'
import { PopupMenu, type PopupItem } from './PopupMenu'
import { SliderPopup } from './SliderPopup'
import { BRIGHTNESS_DEFAULT, BRIGHTNESS_MAX, BRIGHTNESS_MIN, BRIGHTNESS_STEP } from '../lib/brightness'

interface Props {
  index: number
  style: CSSProperties
  source: Source | null
  status: PlayStatus | undefined
  failure: Failure | undefined
  /** 送出網址；回傳錯誤訊息，成功時回傳 null */
  onSubmitUrl(index: number, text: string): string | null
  onRemove(index: number): void
  onRetry(index: number): void
  /** 回到 YouTube 頁面（R63） */
  onBack(index: number): void
  /** 「YouTube ▾」選單（R66）：page 看影片的網頁、player 回到播放器、back 回到剛才的 YouTube 頁面 */
  onYouTubeMenu(index: number, key: string): void
  onSkip(index: number, seconds: number): void
  /** 用方向鍵跳轉時增加，顯示操作區（R51） */
  poke: number
  onUseYoutubeWeb(index: number): void
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
  onQuality(index: number, quality: Quality): void
  getQualityOptions(index: number): number[]
  onCaptions(index: number, key: string | null): void
  onBrightness(index: number, brightness: number): void
  getCaptionTracks(index: number): CaptionTrack[] | null
}

/** 格子裡的選單：字幕、畫質（R31、R32）；亮度、音量的滑桿選單（R40、R42） */
type MenuKind = 'captions' | 'quality' | 'brightness' | 'volume' | 'youtube'

/** 畫質選單：自動＋可用畫質（由高到低）；還不知道可用畫質時列出目前的選擇（R32） */
function qualityItems(options: number[], selected: Quality): PopupItem[] {
  const heights = [...options]
  if (selected !== 'auto' && !heights.includes(selected)) heights.push(selected)
  heights.sort((a, b) => b - a)
  return [
    { key: 'auto', label: '自動', checked: selected === 'auto' },
    ...heights.map((h) => ({ key: String(h), label: qualityLabel(h), checked: selected === h }))
  ]
}

/** 字幕選單：關閉＋這部影片的字幕軌（R31） */
function captionItems(tracks: CaptionTrack[] | null, selected: string | null): PopupItem[] {
  const items: PopupItem[] = [{ key: 'off', label: '關閉', checked: !selected }]
  if (tracks === null) items.push({ key: 'loading', label: '播放後才能選擇字幕', disabled: true })
  else if (tracks.length === 0) items.push({ key: 'none', label: '這部影片沒有字幕', disabled: true })
  else for (const t of tracks) items.push({ key: t.key, label: t.label, checked: t.key === selected })
  return items
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
/** 網頁來源按播放後多久還是暫停就提示，提示顯示多久（R54） */
const PLAY_HINT_MS = 5000
export const PLAY_HINT = '無法直接播放，請按「直接操作」後按網站的播放鈕'

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
  /** 游標在進度條上（顯示時間提示）時，操作區不因滑鼠靜止而隱藏（R50） */
  const [previewing, setPreviewing] = useState(false)
  /** 有進度時才顯示播放鈕（R26、R30） */
  const [hasProgress, setHasProgress] = useState(false)
  /** 開著的格子選單與它的按鈕位置（R31、R32）；選單開著時操作區不隱藏 */
  const [menu, setMenu] = useState<{ kind: MenuKind; anchor: DOMRect } | null>(null)
  const toggleMenu = (kind: MenuKind, e: React.MouseEvent<HTMLButtonElement>) =>
    setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget.getBoundingClientRect() })
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
  const onMouseMoveRef = useRef(onMouseMove)
  onMouseMoveRef.current = onMouseMove
  useEffect(() => {
    if (props.poke) onMouseMoveRef.current()
  }, [props.poke])

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
  /** 找到影片了（暫停、播放中、播完），還沒有進度條時也可以按播放（R54）；載入中不算 */
  const videoFound = status === 'paused' || status === 'playing' || status === 'ended'

  // 網頁來源按播放後 5 秒仍然是暫停：網站要求按它自己的播放鈕（R54 AC3）
  const [playHint, setPlayHint] = useState(false)
  const statusRef = useRef(status)
  statusRef.current = status
  const hintTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => hintTimers.current.forEach(clearTimeout), [])
  const togglePlay = () => {
    const starting = !isPlayingStatus(status)
    props.onTogglePlay(index)
    if (!starting || !isWeb) return
    hintTimers.current.forEach(clearTimeout)
    hintTimers.current = [
      setTimeout(() => {
        if (statusRef.current !== 'paused') return
        setPlayHint(true)
        hintTimers.current.push(setTimeout(() => setPlayHint(false), PLAY_HINT_MS))
      }, PLAY_HINT_MS)
    ]
  }

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
            // 禁止嵌入的影片可以改用 YouTube 網頁播放（R48）
            <>
              <div>{YOUTUBE_FAILURE_TEXT[(props.failure as YouTubeFailure | undefined) ?? 'other']}</div>
              {props.failure === 'embed' && (
                <button onClick={() => props.onUseYoutubeWeb(index)}>改用 YouTube 網頁播放</button>
              )}
            </>
          ) : isWeb ? (
            // 網頁載入失敗可以重試；DRM 只能更換網址（R16）
            <>
              <div>{WEB_FAILURE_TEXT[(props.failure as WebFailure | undefined) ?? 'load']}</div>
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

      {/* 中央的半透明播放／暫停鈕：只有按鈕本身播放／暫停，其他影片區域仍然切換聲音（R30） */}
      {playHint && !pageMode && !props.direct && <div className="web-notice">{PLAY_HINT}</div>}
      {source && !editing && hover && (hasProgress || videoFound) && !failed && !pageMode && !props.direct && (
        <button
          className="center-play"
          title={isPlayingStatus(status) ? '暫停這一格' : '播放這一格'}
          onClick={togglePlay}
          onMouseMove={onMouseMove}
        >
          {isPlayingStatus(status) ? '❚❚' : '▶'}
        </button>
      )}
      {source && !editing && (
        <div
          className={`cell-controls ${hover || props.moving || seeking || previewing || menu ? 'show' : ''}`}
          onMouseMove={onMouseMove}
        >
          {!failed && (
            <ProgressBar
              active={hover || seeking || previewing}
              getProgress={() => props.getProgress(index)}
              onSeek={(t) => props.onSeek(index, t)}
              onDragChange={setSeeking}
              playing={isPlayingStatus(status)}
              onTogglePlay={togglePlay}
              canPlay={videoFound}
              onSkip={(seconds) => props.onSkip(index, seconds)}
              onAvailable={setHasProgress}
              onHoverChange={(on) => {
                setPreviewing(on)
                // 離開進度條後重新計算靜止時間
                if (!on) onMouseMove()
              }}
              preview={
                source.parsed.kind === 'youtube'
                  ? { kind: 'youtube', videoId: source.parsed.videoId }
                  : source.parsed.kind === 'mp4'
                    ? { kind: 'video', url: source.parsed.url }
                    : null
              }
            />
          )}
          {/* 嵌入播放的 YouTube 與 YouTube 網頁模式（R66）；併入第十三版 R63 的「回到 YouTube」 */}
          {(source.parsed.kind === 'youtube' || source.youtubePage) && (
            <button
              className={source.youtubePage ? 'active' : ''}
              title="YouTube：看這部影片的網頁（留言、推薦）、回到播放器、回到剛才的 YouTube 頁面"
              onPointerDown={(e) => menu?.kind === 'youtube' && e.stopPropagation()}
              onClick={(e) => toggleMenu('youtube', e)}
            >
              <Label full="YouTube ▾" icon="YT" />
            </button>
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
          {/* 音量改成按鈕＋彈出滑桿，操作區更精簡（R42） */}
          <button
            title={`音量 ${source.volume}`}
            onPointerDown={(e) => menu?.kind === 'volume' && e.stopPropagation()}
            onClick={(e) => toggleMenu('volume', e)}
          >
            <Label full={`🔉 ${source.volume}`} icon="🔉" />
          </button>
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
          {/* YouTube 網站頁面固定是整頁模式（R57） */}
          {isWeb && !isYouTubeSite(source.url) && !source.youtubePage && (
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
          {source.parsed.kind === 'youtube' && (
            <button
              className={source.captions ? 'active' : ''}
              title="字幕"
              onPointerDown={(e) => menu?.kind === 'captions' && e.stopPropagation()}
              onClick={(e) => toggleMenu('captions', e)}
            >
              CC
            </button>
          )}
          {(source.parsed.kind === 'youtube' || source.parsed.kind === 'hls') && (
            <button
              className={source.quality !== 'auto' ? 'active' : ''}
              title={`畫質：${qualityLabel(source.quality)}（按一下選擇畫質）`}
              onPointerDown={(e) => menu?.kind === 'quality' && e.stopPropagation()}
              onClick={(e) => toggleMenu('quality', e)}
            >
              <Label
                full={`畫質：${qualityLabel(source.quality)}`}
                icon={source.quality === 'auto' ? 'A' : String(source.quality)}
              />
            </button>
          )}
          <button
            className={source.brightness !== BRIGHTNESS_DEFAULT ? 'active' : ''}
            title={`亮度 ${source.brightness}%`}
            onPointerDown={(e) => menu?.kind === 'brightness' && e.stopPropagation()}
            onClick={(e) => toggleMenu('brightness', e)}
          >
            ☀
          </button>
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
          {menu?.kind === 'volume' && (
            <SliderPopup
              anchor={menu.anchor}
              placement="above"
              title="音量"
              min={0}
              max={100}
              step={1}
              value={source.volume}
              format={(v) => String(v)}
              onChange={(v) => props.onVolume(index, v)}
              onReset={() => props.onVolume(index, 100)}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'brightness' && (
            <SliderPopup
              anchor={menu.anchor}
              placement="above"
              title="亮度"
              min={BRIGHTNESS_MIN}
              max={BRIGHTNESS_MAX}
              step={BRIGHTNESS_STEP}
              value={source.brightness}
              format={(v) => `${v}%`}
              onChange={(v) => props.onBrightness(index, v)}
              onReset={() => props.onBrightness(index, BRIGHTNESS_DEFAULT)}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'youtube' && (
            <PopupMenu
              anchor={menu.anchor}
              items={[
                source.youtubePage
                  ? { key: 'player', label: '回到播放器' }
                  : { key: 'page', label: '看這部影片的網頁（留言、推薦）' },
                ...(source.back || source.backUrl ? [{ key: 'back', label: '回到剛才的 YouTube 頁面' }] : [])
              ]}
              onSelect={(key) => props.onYouTubeMenu(index, key)}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'quality' && (
            <PopupMenu
              anchor={menu.anchor}
              items={qualityItems(props.getQualityOptions(index), source.quality)}
              onSelect={(key) => props.onQuality(index, key === 'auto' ? 'auto' : Number(key))}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'captions' && (
            <PopupMenu
              anchor={menu.anchor}
              items={captionItems(props.getCaptionTracks(index), source.captions)}
              onSelect={(key) => props.onCaptions(index, key === 'off' ? null : key)}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
