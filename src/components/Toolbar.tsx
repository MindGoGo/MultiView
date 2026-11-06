import type { WinState } from '../../electron/preload'
import { useEffect, useState } from 'react'
import { versionLabel } from '../lib/appInfo'
import { LAYOUT_IDS, LAYOUT_LABELS, type LayoutId } from '../lib/layout'
import { BRIGHTNESS_DEFAULT, BRIGHTNESS_MAX, BRIGHTNESS_MIN, BRIGHTNESS_STEP } from '../lib/brightness'
import { SliderPopup } from './SliderPopup'
import { PopupMenu } from './PopupMenu'
import { statusLabel, updateToast, type PlayMethod, type YouTubeMethods, type YtDlpStatus } from '../lib/ytdlp'

interface Props {
  visible: boolean
  win: WinState
  layout: LayoutId
  onLayout(layout: LayoutId): void
  toast: string | null
  /** 有可以控制的來源（R8 AC5） */
  canControl: boolean
  onPlayAll(): void
  onPauseAll(): void
  onMuteAll(): void
  /** 清單面板（R21） */
  listOpen: boolean
  onToggleList(): void
  /** 單格全螢幕時要先離開單格全螢幕（R20） */
  onToggleFullscreen(): void
  /** 正在單格全螢幕（R67：一定是全螢幕，按鈕顯示「離開全螢幕」） */
  solo: boolean
  /** 總亮度（R41） */
  brightness: number
  onBrightness(brightness: number): void
  /** 總亮度、設定選單開關時通知，開著時工具列不自動隱藏 */
  onPopupChange(open: boolean): void
  /** YouTube 無法嵌入時自動改用網頁播放（R49） */
  autoYoutubeWeb: boolean
  onAutoYoutubeWeb(on: boolean): void
  /** YouTube 直播、一般影片的播放方式（R88） */
  youtubeMethods: YouTubeMethods
  onYoutubeMethods(methods: YouTubeMethods): void
  /** 工具列的提示（R93：手動更新 yt-dlp 的結果） */
  onToast(message: string): void
  /** YouTube 小視窗（R78） */
  onOpenCompanion(): void
}

/** 設定選單的項目（R49） */
const AUTO_YOUTUBE_WEB = 'autoYoutubeWeb'
/** 播放方式（R88）：key 是「組:方式」 */
const METHOD_ITEMS: { group: keyof YouTubeMethods; method: PlayMethod; label: string }[] = [
  { group: 'live', method: 'embed', label: 'YouTube 直播：內嵌播放器' },
  { group: 'live', method: 'ytdlp', label: 'YouTube 直播：yt-dlp' },
  { group: 'vod', method: 'embed', label: 'YouTube 一般影片：內嵌播放器' },
  { group: 'vod', method: 'ytdlp', label: 'YouTube 一般影片：yt-dlp（最高 360p）' }
]
const YTDLP_UPDATE = 'ytdlpUpdate'

export function Toolbar(props: Props) {
  const { visible, win, layout, onLayout, toast, canControl } = props
  const api = window.multiview
  // 程式的版本號（R76）
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.multiview.getVersion().then(setVersion)
  }, [])
  // yt-dlp 的版本與更新狀態（R93）
  const [ytStatus, setYtStatus] = useState<YtDlpStatus | null>(null)
  useEffect(() => {
    void window.multiview.ytdlpStatus().then(setYtStatus)
    return window.multiview.onYtdlpStatus(setYtStatus)
  }, [])
  const ytLine = ytStatus && statusLabel(ytStatus)
  const updateYtDlp = () =>
    void window.multiview.ytdlpUpdate().then((r) => props.onToast(updateToast(r.result, r.version)))
  const [popup, setPopup] = useState<{ kind: 'brightness' | 'settings'; anchor: DOMRect } | null>(null)
  const openPopup = (next: { kind: 'brightness' | 'settings'; anchor: DOMRect } | null) => {
    setPopup(next)
    props.onPopupChange(next !== null)
  }
  const togglePopup = (kind: 'brightness' | 'settings', e: React.MouseEvent<HTMLButtonElement>) => {
    // 打開設定選單時查詢 yt-dlp 有沒有新版（1 小時內查過就不查，R93）
    if (kind === 'settings' && popup?.kind !== 'settings') window.multiview.ytdlpCheck()
    openPopup(popup?.kind === kind ? null : { kind, anchor: e.currentTarget.getBoundingClientRect() })
  }
  return (
    <div className={`toolbar ${visible ? 'show' : ''}`}>
      <div className="toolbar-group">
        {LAYOUT_IDS.map((id) => (
          <button
            key={id}
            className={id === layout ? 'active' : ''}
            title={`版型 ${LAYOUT_LABELS[id]}`}
            onClick={() => onLayout(id)}
          >
            {LAYOUT_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="toolbar-group">
        <button disabled={!canControl} title="全部播放" onClick={props.onPlayAll}>
          ▶ 全部播放
        </button>
        <button disabled={!canControl} title="全部暫停" onClick={props.onPauseAll}>
          ❚❚ 全部暫停
        </button>
        <button disabled={!canControl} title="全部靜音" onClick={props.onMuteAll}>
          🔇 全部靜音
        </button>
      </div>
      <div className="toolbar-drag">{toast && <span className="toast">{toast}</span>}</div>
      <div className="toolbar-group">
        <button
          className={props.brightness !== BRIGHTNESS_DEFAULT ? 'active' : ''}
          title="總亮度：和每一格的亮度相乘"
          onPointerDown={(e) => popup?.kind === 'brightness' && e.stopPropagation()}
          onClick={(e) => togglePopup('brightness', e)}
        >
          ☀ {props.brightness}%
        </button>
        {popup?.kind === 'brightness' && (
          <SliderPopup
            anchor={popup.anchor}
            placement="below"
            title="總亮度"
            min={BRIGHTNESS_MIN}
            max={BRIGHTNESS_MAX}
            step={BRIGHTNESS_STEP}
            value={props.brightness}
            format={(v) => `${v}%`}
            onChange={props.onBrightness}
            onReset={() => props.onBrightness(BRIGHTNESS_DEFAULT)}
            onClose={() => openPopup(null)}
          />
        )}
        <button
          title="設定"
          onPointerDown={(e) => popup?.kind === 'settings' && e.stopPropagation()}
          onClick={(e) => togglePopup('settings', e)}
        >
          ⚙ 設定
        </button>
        {popup?.kind === 'settings' && (
          <PopupMenu
            anchor={popup.anchor}
            placement="below"
            items={[
              { key: AUTO_YOUTUBE_WEB, label: 'YouTube 無法嵌入時自動改用網頁播放', checked: props.autoYoutubeWeb },
              ...METHOD_ITEMS.map((m) => ({
                key: `${m.group}:${m.method}`,
                label: m.label,
                checked: props.youtubeMethods[m.group] === m.method
              })),
              ...(ytLine ? [{ key: YTDLP_UPDATE, label: ytLine.label, disabled: !ytLine.clickable, keepOpen: true }] : []),
              ...(version ? [{ key: 'version', label: versionLabel(version), disabled: true }] : [])
            ]}
            onSelect={(key) => {
              if (key === AUTO_YOUTUBE_WEB) return props.onAutoYoutubeWeb(!props.autoYoutubeWeb)
              if (key === YTDLP_UPDATE) return updateYtDlp()
              const m = METHOD_ITEMS.find((i) => `${i.group}:${i.method}` === key)
              if (m) props.onYoutubeMethods({ ...props.youtubeMethods, [m.group]: m.method })
            }}
            onClose={() => openPopup(null)}
          />
        )}
        <button className={props.listOpen ? 'active' : ''} title="最愛與歷史清單" onClick={props.onToggleList}>
          ☰ 清單
        </button>
        <button title="YouTube 小視窗：推薦、留言、聊天室、搜尋" onClick={props.onOpenCompanion}>
          YouTube 小視窗
        </button>
        <button
          className={win.alwaysOnTop ? 'active' : ''}
          title="視窗置頂"
          onClick={api.toggleAlwaysOnTop}
        >
          置頂
        </button>
        <button title="全螢幕 (F11)" onClick={props.onToggleFullscreen}>
          {win.fullscreen || props.solo ? '離開全螢幕' : '全螢幕'}
        </button>
        <button title="最小化" onClick={api.minimize}>
          ─
        </button>
        <button className="close" title="關閉" onClick={api.close}>
          ✕
        </button>
      </div>
    </div>
  )
}
