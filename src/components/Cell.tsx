import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isYouTubeSite } from '../lib/source'
import type { Source } from '../lib/slots'
import { isAudible } from '../lib/audio'
import type { AudioMenu, PlayStatus } from '../players/types'
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
import type { YtMode } from '../players/YouTubeSource'
import { LoadingCritter, useLoadingVisible } from './LoadingCritter'
import { loadingKind } from '../lib/loading'
import { playbackBadge } from '../lib/playbackBadge'
import { controlsView } from '../lib/pointerZones'
import { categoryInfo, skippedLabel, type SkipAction, type SponsorSegment } from '../lib/sponsorBlock'
import type { SplitBlock, SplitDir } from '../lib/layoutTree'
import { ExitFullscreenIcon, FullscreenIcon, GearIcon, MuteIcon, SpeakerIcon, YouTubeLogo } from './icons'
import type { CellClick, CellClickAction } from '../lib/cellClick'
import { canBoost, effectiveVolume, VOLUME_DEFAULT, VOLUME_NORMAL_MAX, volumeMax } from '../lib/volume'

interface Props {
  index: number
  style: CSSProperties
  /** 最上排的格子：上方的浮動按鈕往下移，避開工具列（R166） */
  topRow: boolean
  source: Source | null
  status: PlayStatus | undefined
  failure: Failure | undefined
  /** YouTube 格子目前的播放方式（R89）；其他來源為 undefined */
  ytMode: YtMode | undefined
  /** 其他網站改用網頁播放（R103） */
  onUseWebPage(index: number): void
  /** 送出網址；回傳錯誤訊息，成功時回傳 null */
  onSubmitUrl(index: number, text: string): string | null
  onRemove(index: number): void
  onRetry(index: number): void
  /** 回到 YouTube 頁面（R63） */
  onBack(index: number): void
  /**
   * 「YouTube ▾」選單（R66）：page 看影片的網頁、player 回到播放器、back 回到剛才的 YouTube 頁面；
   * related、comments、chat 開啟 YouTube 小視窗（R78）
   */
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
  /** 在影片上按左鍵、右鍵的效果（R171） */
  cellClick: CellClick
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
  /** 語音的選擇：null 為自動（R95） */
  onAudioLang(index: number, lang: string | null): void
  getAudioTracks(index: number): AudioMenu | null
  onBrightness(index: number, brightness: number): void
  getCaptionTracks(index: number): CaptionTrack[] | null
  /** SponsorBlock 的跳過提示（R161）；沒有時為 null */
  skipNotice: { action: SkipAction; n: number } | null
  onCancelSkip(index: number): void
  /** 要跳過的片段（進度條的色塊，R161） */
  getSegments(index: number): SponsorSegment[]
  /** 工具列顯示中：最上面一列的跳過提示往下移，避開工具列 */
  toolbarShown: boolean
  /** 畫面上只有這一格（版型 1、單格全螢幕）：不顯示「有聲音」的小喇叭（R162，和手機版相同） */
  singleView: boolean
  /** 編輯版型中（R170）：能不能左右切（row）、上下切（col）、刪除；不在編輯時是 null */
  edit: { row: SplitBlock; col: SplitBlock; canRemove: boolean } | null
  onSplit(index: number, dir: SplitDir): void
  onRemoveCell(index: number): void
}

/** 切開的按鈕停用時的原因（R170） */
const SPLIT_BLOCK_TEXT: Record<Exclude<SplitBlock, null>, string> = {
  max: '最多 9 格',
  small: '這一格太小，不能再切'
}

/** 格子裡的選單：字幕、畫質（R31、R32）；亮度、音量的滑桿選單（R40、R42） */
type MenuKind = 'gear' | 'captions' | 'audio' | 'quality' | 'brightness' | 'youtube'

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

/** 語音選單（R95）：自動＋每條聲音軌；選「自動」時只有「自動」打勾 */
function audioItems(menu: AudioMenu, selected: string | null): PopupItem[] {
  return [
    { key: 'auto', label: '自動', checked: !selected },
    ...menu.options.map((o) => ({ key: String(o.index), label: o.label, checked: !!selected && o.index === menu.current }))
  ]
}

/** 工具列的高度（styles.css 的 .toolbar） */
const TOOLBAR_HEIGHT = 40
/** 浮動按鈕的大小與上緣（R166，styles.css 的 .fab、.fab-row.top-right） */
const CHIP_SIZE = 40
const CHIP_TOP = 8

/** 滑鼠離開聲音按鈕與音量滑桿多久後收起滑桿（R171） */
const VOLUME_CLOSE_MS = 300

/** 滑鼠靜止多久後隱藏操作按鈕（R3 AC2） */
const CONTROLS_IDLE_MS = 2000
/** 網頁來源按播放後多久還是暫停就提示，提示顯示多久（R54） */
const PLAY_HINT_MS = 5000
export const PLAY_HINT = '無法直接播放，請按「直接操作」後按網站的播放鈕'

/**
 * 游標下的格子編號；不在任何格子上時回傳 null。
 * 用格子的位置判斷：整頁模式的格子不接收滑鼠（pointer-events: none），用 elementsFromPoint 找不到（R171 修正換位）
 */
function cellIndexAt(x: number, y: number): number | null {
  for (const el of document.querySelectorAll<HTMLElement>('.cell[data-index]')) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return Number(el.dataset.index)
  }
  return null
}

/** 這一格有聲音（R7）：五條白色音波，播放時上下跳動（R171） */
function SoundBars({ playing }: { playing: boolean }) {
  return (
    <div className="audio-indicator" aria-label="有聲音">
      <svg className={playing ? 'playing' : ''} width="15" height="12" viewBox="0 0 20 16" aria-hidden="true">
        <rect x="1" y="5.5" width="2.4" height="5" rx="1.2" />
        <rect x="5" y="3" width="2.4" height="10" rx="1.2" />
        <rect x="9" y="0.5" width="2.4" height="15" rx="1.2" />
        <rect x="13" y="3" width="2.4" height="10" rx="1.2" />
        <rect x="17" y="5.5" width="2.4" height="5" rx="1.2" />
      </svg>
    </div>
  )
}

export function Cell(props: Props) {
  const { index, style, source, status, onSubmitUrl, onRemove, onRetry } = props
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  /** 滑鼠在左上的聲音按鈕上：旁邊展開音量滑桿（R171）；拖曳中不收起 */
  const [volOpen, setVolOpen] = useState(false)
  const volDrag = useRef(false)
  const volTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(volTimer.current), [])
  const openVolume = () => {
    clearTimeout(volTimer.current)
    setVolOpen(true)
  }
  const closeVolumeSoon = () => {
    clearTimeout(volTimer.current)
    volTimer.current = setTimeout(() => !volDrag.current && setVolOpen(false), VOLUME_CLOSE_MS)
  }
  /** 拖曳進度條中，操作區不隱藏（R19） */
  const [seeking, setSeeking] = useState(false)
  /** 游標在進度條上（顯示時間提示）時，操作區不因滑鼠靜止而隱藏（R50） */
  const [previewing, setPreviewing] = useState(false)
  /** 有進度時才顯示播放鈕（R26、R30） */
  const [hasProgress, setHasProgress] = useState(false)
  /** 開著的格子選單與它的按鈕位置（R31、R32）；選單開著時操作區不隱藏 */
  const [menu, setMenu] = useState<{ kind: MenuKind; anchor: DOMRect; atCursor?: boolean } | null>(null)
  const toggleMenu = (kind: MenuKind, e: React.MouseEvent<HTMLButtonElement>) =>
    setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget.getBoundingClientRect() })
  /** 這一格的選單按鈕（齒輪、YouTube ▾）的 data-popup-toggle：按它們時選單不當作點在外面（R171 修正） */
  const toggleKey = `cell-${props.index}`
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cellRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => clearTimeout(idleTimer.current), [])
  /** 用 yt-dlp 播放：沒有可以直接操作的 YouTube 介面或網頁、不支援字幕（R89、R103） */
  const ytdlp = props.ytMode === 'ytdlp-hls' || props.ytMode === 'ytdlp-mp4'
  /** 其他網站用 yt-dlp 播放（或解析中）時沒有網頁，操作區和影片來源相同（R103） */
  const webByYtdlp = source?.parsed.kind === 'web' && (ytdlp || props.ytMode === 'resolving')
  const isWeb = source?.parsed.kind === 'web' && !webByYtdlp
  const pageMode = isWeb && props.webMode === 'page'
  /** 有兩條以上的聲音軌才有語音選單（R95） */
  const audio = props.ytMode === 'ytdlp-hls' ? props.getAudioTracks(index) : null
  const hasAudioMenu = !!audio && audio.options.length >= 2
  /** 音量：可放大的來源 0–200，其他 0–100，顯示實際使用的音量（R98） */
  const boostable = !!source && canBoost(source, props.ytMode)
  const volume = source ? effectiveVolume(source.volume, boostable) : VOLUME_DEFAULT

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
  /** 操作區顯示中；播放方式的小標示也一起顯示（R109） */
  const busy = props.moving || seeking || previewing || !!menu || volOpen
  const controlsShown = hover || busy
  // 整頁模式平常只有小把手，滑鼠移上去才叫出浮動按鈕（R117）；之後和其他格子一樣，
  // 滑鼠靜止或離開格子才收回（R166：按鈕分散在四個角落，不再是離開操作列 0.3 秒就收回）
  const [expanded, setExpanded] = useState(false)
  const expand = () => setExpanded(true)
  useEffect(() => {
    if (pageMode && hover) return
    setExpanded(false)
  }, [pageMode, hover])
  const view = controlsView({ pageMode, shown: controlsShown, expanded, busy })
  const badge = source ? playbackBadge(source, props.ytMode) : null
  // 讀取動畫（R99）
  const loading = useLoadingVisible(source ? loadingKind({ status, ytMode: props.ytMode, isWeb, showInput }) : null)
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

  // ---- 齒輪選單（R166）：原本操作列上的次要按鈕 ----
  /** 有畫質選單的來源（R32、R103） */
  const hasQuality =
    !!source && (source.parsed.kind === 'youtube' || source.parsed.kind === 'hls' || (webByYtdlp && ytdlp))
  /** 有「直接操作」的來源（R3、R14）；整頁模式本來就直接操作網頁 */
  const hasDirect = !!source && ((source.parsed.kind === 'youtube' && !ytdlp) || (isWeb && !pageMode))
  const gearItems = (): PopupItem[] => {
    if (!source) return []
    const items: PopupItem[] = [
      { key: 'brightness', label: '亮度', detail: `${source.brightness}%`, checked: source.brightness !== BRIGHTNESS_DEFAULT, keepOpen: true }
    ]
    if (hasQuality) {
      items.push(
        props.ytMode === 'ytdlp-mp4'
          ? { key: 'quality', label: '畫質', detail: 'yt-dlp 固定 360p', disabled: true }
          : { key: 'quality', label: '畫質', detail: qualityLabel(source.quality), checked: source.quality !== 'auto', keepOpen: true }
      )
    }
    if (hasAudioMenu) items.push({ key: 'audio', label: '語音', checked: !!source.audioLang, keepOpen: true })
    if (source.parsed.kind === 'youtube') {
      items.push(
        ytdlp
          ? { key: 'captions', label: '字幕', detail: 'yt-dlp 不支援', disabled: true }
          : { key: 'captions', label: '字幕', checked: !!source.captions, keepOpen: true }
      )
    }
    if (hasDirect) items.push({ key: 'direct', label: '直接操作', checked: props.direct })
    // YouTube 網站頁面固定是整頁模式（R57）
    if (isWeb && !isYouTubeSite(source.url) && !source.youtubePage)
      items.push({ key: 'webmode', label: pageMode ? '只顯示影片' : '顯示整個網頁' })
    if (isWeb) items.push({ key: 'adblock', label: '廣告阻擋', checked: source.adblock })
    if (webByYtdlp) items.push({ key: 'useweb', label: '改用網頁播放' })
    items.push(
      { key: 'favorite', label: props.favorite ? '從最愛移除' : '加入最愛', checked: props.favorite },
      { key: 'edit', label: '更換網址' },
      { key: 'remove', label: '移除', danger: true }
    )
    return items
  }
  /** 選了齒輪選單的項目：選單、滑桿在齒輪旁邊打開，其他直接執行 */
  const onGear = (key: string, anchor: DOMRect) => {
    if (key === 'brightness' || key === 'quality' || key === 'audio' || key === 'captions') {
      setMenu({ kind: key, anchor, atCursor: menu?.atCursor })
      return
    }
    if (key === 'direct') props.onDirect(index)
    else if (key === 'webmode') props.onToggleWebMode(index)
    else if (key === 'adblock') props.onToggleAdblock(index)
    else if (key === 'useweb') props.onUseWebPage(index)
    else if (key === 'favorite') props.onToggleFavorite(index)
    else if (key === 'edit') setEditing(true)
    else if (key === 'remove') onRemove(index)
  }

  /** 跳過提示的位置（R161、R166） */
  const skipNoticeTop = (): CSSProperties | undefined => {
    const atTop = props.topRow || (!!cellRef.current && cellRef.current.getBoundingClientRect().top < TOOLBAR_HEIGHT)
    if (view === 'bar') return { top: (props.topRow ? TOOLBAR_HEIGHT + CHIP_TOP : CHIP_TOP) + CHIP_SIZE + 6 }
    return props.toolbarShown && atTop ? { top: TOOLBAR_HEIGHT + 6 } : undefined
  }

  /** 選單、滑桿出現在按鈕下方；在游標位置打開而且游標在視窗下半部時出現在上方（R171） */
  const popupPlacement: 'above' | 'below' =
    menu?.atCursor && menu.anchor.top > window.innerHeight / 2 ? 'above' : 'below'

  /** 在影片上按左鍵、右鍵（R171）：只聽這一格（R7）、播放／暫停、在游標位置打開齒輪選單 */
  const runClick = (action: CellClickAction, e: React.MouseEvent) => {
    if (action === 'solo') props.onFocusAudio(index)
    else if (action === 'play') {
      if (source && !failed && (hasProgress || videoFound)) togglePlay()
    } else if (source && !showInput) {
      onMouseMove()
      setMenu({ kind: 'gear', anchor: new DOMRect(e.clientX, e.clientY, 0, 0), atCursor: true })
    }
  }

  const closeInput = () => {
    setEditing(false)
    setText('')
    setError(null)
  }

  const pasteAndOpen = async () => {
    const clip = (await window.multiview.readClipboard()).trim()
    if (!clip) {
      setError('剪貼簿裡沒有網址')
      return
    }
    setText(clip)
    const err = onSubmitUrl(index, clip)
    if (err) setError(err)
    else closeInput()
  }

  const submit = () => {
    if (text.trim() === '') return // R2 AC5
    const err = onSubmitUrl(index, text)
    if (err) setError(err)
    else closeInput()
  }

  return (
    <div
      className={`cell ${source ? 'filled' : 'empty'} ${props.moving ? 'moving' : ''} ${props.dropTarget ? 'drop-target' : ''} ${props.direct || pageMode ? 'direct' : ''} ${props.topRow ? 'top-row' : ''} ${props.edit ? 'editing' : ''}`}
      ref={cellRef}
      style={style}
      data-index={index}
      data-page={pageMode ? '' : undefined}
      onMouseMove={onMouseMove}
      // 整頁模式由主程序回報的游標位置判斷離開格子：游標從浮動按鈕移到網頁上時，格子也會收到 mouseleave（R171 修正）
      onMouseLeave={() => !pageMode && onMouseLeave()}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        runClick(props.cellClick.right, e)
      }}
      onClick={(e) => {
        // 只有點在格子本身（影片區域）才算，按鈕和輸入框不算（R7 獨占聲音）
        if (e.target === e.currentTarget) runClick(props.cellClick.left, e)
      }}
    >
      {/* 編輯版型（R170）：格子編號與切開、刪除的按鈕，蓋住格子的其他操作 */}
      {props.edit && (
        <div className="cell-edit">
          <div className="cell-edit-number">{index + 1}</div>
          <div className="cell-edit-buttons">
            {(['row', 'col'] as const).map((dir) => {
              const block = props.edit![dir]
              const label = dir === 'row' ? '左右切' : '上下切'
              return (
                <button
                  key={dir}
                  disabled={block !== null}
                  title={block ? SPLIT_BLOCK_TEXT[block] : dir === 'row' ? '把這一格分成左右兩格' : '把這一格分成上下兩格'}
                  onClick={() => props.onSplit(index, dir)}
                >
                  <span className={`split-icon ${dir}`} aria-hidden="true" />
                  {label}
                </button>
              )
            })}
            <button
              className="danger"
              disabled={!props.edit.canRemove}
              title={props.edit.canRemove ? '拿掉這一格，空間交給旁邊的格子（影片變成暫時隱藏）' : '只剩一格，不能刪除'}
              onClick={() => props.onRemoveCell(index)}
            >
              刪除這格
            </button>
          </div>
        </div>
      )}
      {/* 左上角（R166）：操作區顯示時是聲音按鈕＋yt-dlp 綠點（R165）；平常只在有聲音時顯示小標示（R7）。
          滑鼠停在角落上說明這一格的播放方式（R109、R165） */}
      {source && !showInput && (view === 'bar' || (isAudible(source) && !props.singleView)) && (
        <div
          className={`cell-corner ${view === 'bar' ? 'fabs' : ''}`}
          title={view === 'bar' ? undefined : badge?.tip}
          onClick={(e) => e.stopPropagation()}
        >
          {view === 'bar' ? (
            // 聲音按鈕：按一下靜音／開聲音；滑鼠移上去旁邊展開音量滑桿（R171，像 YouTube）
            <div className={`vol-group ${volOpen ? 'open' : ''}`} onMouseEnter={openVolume} onMouseLeave={closeVolumeSoon}>
              <button
                className="fab"
                title={`${source.muted ? '開啟這一格的聲音' : '關閉這一格的聲音'}${badge ? `\n${badge.tip}` : ''}`}
                aria-label={source.muted ? '開啟這一格的聲音' : '關閉這一格的聲音'}
                onClick={() => props.onToggleMute(index)}
              >
                {source.muted || volume === 0 ? <MuteIcon /> : <SpeakerIcon />}
              </button>
              <div className="vol-slider">
                <input
                  type="range"
                  tabIndex={-1}
                  aria-label="音量"
                  title={`音量 ${volume}`}
                  className={boostable && volume > VOLUME_NORMAL_MAX ? 'boosted' : ''}
                  style={
                    {
                      '--fill': `${(volume / volumeMax(boostable)) * 100}%`,
                      '--boost': boostable ? `${(VOLUME_NORMAL_MAX / volumeMax(boostable)) * 100}%` : '100%'
                    } as CSSProperties
                  }
                  min={0}
                  max={volumeMax(boostable)}
                  step={1}
                  value={volume}
                  onPointerDown={() => (volDrag.current = true)}
                  onPointerUp={(e) => {
                    volDrag.current = false
                    // 不留下焦點：←／→ 仍是快轉、倒轉的快捷鍵（R51）
                    e.currentTarget.blur()
                    if (!e.currentTarget.closest('.vol-group')?.matches(':hover')) closeVolumeSoon()
                  }}
                  onChange={(e) => props.onVolume(index, Number(e.target.value))}
                  onDoubleClick={() => props.onVolume(index, VOLUME_DEFAULT)}
                />
                <span className="vol-value">{volume}</span>
              </div>
            </div>
          ) : (
            <SoundBars playing={isPlayingStatus(status)} />
          )}
          {badge?.dot && view === 'bar' && <span className="ytdlp-dot" title={badge.tip} aria-label="yt-dlp" />}
        </div>
      )}
      {showInput && (
        <div className="cell-center">
          <div className="url-row">
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
            {/* 用滑鼠貼上剪貼簿的網址並開啟；網址不對時顯示原因 */}
            <button
              className="paste-open"
              title="貼上剪貼簿裡的網址並開啟（輸入框也可以按右鍵貼上）"
              onClick={() => void pasteAndOpen()}
            >
              貼上並開啟
            </button>
          </div>
          {error && <div className="url-error">{error}</div>}
          {/* 空白格子直接開啟 YouTube 首頁（R71）；更換網址時不顯示 */}
          {!source && (
            <button className="open-youtube" onClick={() => onSubmitUrl(index, 'https://www.youtube.com/')}>
              開啟 YouTube
            </button>
          )}
          {editing && (
            <button className="link" onClick={closeInput}>
              取消
            </button>
          )}
        </div>
      )}

      {loading && <LoadingCritter kind={loading} />}

      {/* SponsorBlock 的跳過提示（R161）：右上角，5 秒後自動收起。浮動按鈕顯示時移到右上按鈕的下面（R166，和 iOS 相同）；
          最上排的格子在工具列顯示時也往下移 */}
      {props.skipNotice && !showInput && (
        <div key={props.skipNotice.n} className="skip-notice" style={skipNoticeTop()}>
          <span className="skip-dot" style={{ background: categoryInfo(props.skipNotice.action.segment.category).color }} />
          <span>{skippedLabel(props.skipNotice.action.segment.category)}</span>
          <button onClick={() => props.onCancelSkip(index)}>取消</button>
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

      {/* 中央的半透明播放／暫停鈕：只有按鈕本身播放／暫停，其他影片區域仍然切換聲音（R30）；
          整頁模式的網頁格子在浮動按鈕叫出來時也有（R166） */}
      {playHint && !pageMode && !props.direct && <div className="web-notice">{PLAY_HINT}</div>}
      {source && !editing && (pageMode ? view === 'bar' : hover) && (hasProgress || videoFound) && !failed && !props.direct && (
        <button
          className="center-play"
          title={isPlayingStatus(status) ? '暫停這一格' : '播放這一格'}
          onClick={togglePlay}
          onMouseMove={onMouseMove}
        >
          {isPlayingStatus(status) ? '❚❚' : '▶'}
        </button>
      )}
      {source && !editing && view === 'handle' && (
        <button className="cell-handle" title="顯示操作按鈕" aria-label="顯示操作按鈕" onMouseEnter={expand} onClick={expand}>
          ⋯
        </button>
      )}
      {/* 浮在影片上的操作按鈕（R166）：上下的漸層不接收滑鼠，只有按鈕與進度條接收 */}
      {source && !editing && (
        <div className={`cell-controls ${view === 'bar' ? 'show' : ''}`}>
          <div className="scrim top" />
          <div className="scrim bottom" />
          <div className="fab-row top-right">
            {pageMode && (
              <>
                <button className="fab" title="上一頁" disabled={!props.nav?.back} onClick={() => props.onNav(index, true)}>
                  ←
                </button>
                <button className="fab" title="下一頁" disabled={!props.nav?.forward} onClick={() => props.onNav(index, false)}>
                  →
                </button>
              </>
            )}
            {/* 嵌入播放的 YouTube 與 YouTube 網頁模式（R66）；併入第十三版 R63 的「回到 YouTube」 */}
            {(source.parsed.kind === 'youtube' || source.youtubePage) && (
              <button
                className={`fab ${source.youtubePage ? 'active' : ''}`}
                title="YouTube：回到網頁、回到播放器、回到剛才的 YouTube 頁面、推薦影片、留言、聊天室"
                aria-label="YouTube"
                data-popup-toggle={toggleKey}
                onClick={(e) => toggleMenu('youtube', e)}
              >
                <YouTubeLogo size={16} />
              </button>
            )}
            <button
              className={`fab ${menu && menu.kind !== 'youtube' ? 'active' : ''}`}
              title="設定：音量、亮度、畫質、字幕、更換網址、移除…"
              aria-label="設定"
              data-popup-toggle={toggleKey}
              // 齒輪選單或從它打開的選單、滑桿開著時，再按一下就關閉；YouTube ▾ 開著時換成齒輪選單
              onClick={(e) =>
                setMenu(menu && menu.kind !== 'youtube' ? null : { kind: 'gear', anchor: e.currentTarget.getBoundingClientRect() })
              }
            >
              <GearIcon />
            </button>
          </div>
          <div className="fab-row bottom-right">
            {props.canMove && (
              <button
                className="fab move-handle"
                title="拖曳到其他格子來交換位置"
                aria-label="移動"
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
                ✥
              </button>
            )}
            <button
              className={`fab ${props.isSolo ? 'active' : ''}`}
              title={props.isSolo ? '離開全螢幕，回到分割畫面' : '把這一格放大到整個螢幕，其他格暫停'}
              aria-label={props.isSolo ? '離開全螢幕' : '全螢幕'}
              onClick={() => props.onToggleSolo(index)}
            >
              {props.isSolo ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          </div>
          {!failed && (
            <ProgressBar
              active={hover || seeking || previewing}
              getProgress={() => props.getProgress(index)}
              getSegments={() => props.getSegments(index)}
              onSeek={(t) => props.onSeek(index, t)}
              onDragChange={setSeeking}
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
          {menu?.kind === 'gear' && (
            <PopupMenu
              anchor={menu.anchor}
              placement={popupPlacement}
              toggleKey={toggleKey}
              align={menu.atCursor ? 'start' : 'end'}
              items={gearItems()}
              onSelect={(key) => onGear(key, menu.anchor)}
              onClose={() => setMenu((m) => (m?.kind === 'gear' ? null : m))}
            />
          )}
          {menu?.kind === 'brightness' && (
            <SliderPopup
              anchor={menu.anchor}
              placement={popupPlacement}
              toggleKey={toggleKey}
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
              placement={popupPlacement}
              toggleKey={toggleKey}
              items={[
                source.youtubePage
                  ? { key: 'player', label: '回到播放器' }
                  : { key: 'page', label: '回到網頁' },
                ...(source.back || source.backUrl ? [{ key: 'back', label: '回到剛才的 YouTube 頁面' }] : []),
                // YouTube 小視窗（R78）
                { key: 'related', label: '推薦影片' },
                { key: 'comments', label: '留言' },
                { key: 'chat', label: '聊天室' }
              ]}
              onSelect={(key) => props.onYouTubeMenu(index, key)}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'quality' && (
            <PopupMenu
              anchor={menu.anchor}
              placement={popupPlacement}
              toggleKey={toggleKey}
              items={qualityItems(props.getQualityOptions(index), source.quality)}
              onSelect={(key) => props.onQuality(index, key === 'auto' ? 'auto' : Number(key))}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'audio' && audio && (
            <PopupMenu
              anchor={menu.anchor}
              placement={popupPlacement}
              toggleKey={toggleKey}
              items={audioItems(audio, source.audioLang ?? null)}
              onSelect={(key) => {
                const o = audio.options.find((x) => String(x.index) === key)
                props.onAudioLang(index, key === 'auto' || !o ? null : o.lang || null)
              }}
              onClose={() => setMenu(null)}
            />
          )}
          {menu?.kind === 'captions' && (
            <PopupMenu
              anchor={menu.anchor}
              placement={popupPlacement}
              toggleKey={toggleKey}
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
