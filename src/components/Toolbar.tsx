import type { WinState } from '../../electron/preload'
import { useState } from 'react'
import { LAYOUT_IDS, LAYOUT_LABELS, type LayoutId } from '../lib/layout'
import { BRIGHTNESS_DEFAULT, BRIGHTNESS_MAX, BRIGHTNESS_MIN, BRIGHTNESS_STEP } from '../lib/brightness'
import { SliderPopup } from './SliderPopup'
import {
  CloseIcon,
  CompanionIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  GearIcon,
  LayoutIcon,
  ListIcon,
  MinimizeIcon,
  MuteIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  SunIcon
} from './icons'

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
  /** 總亮度的滑桿開關時通知，開著時工具列不自動隱藏 */
  onPopupChange(open: boolean): void
  /** 設定視窗（R96） */
  onOpenSettings(): void
  /** YouTube 小視窗（R78） */
  onOpenCompanion(): void
}

/**
 * 工具列（R97）：左邊是版型與全部播放／暫停／靜音的分段按鈕，右邊是功能圖示與視窗按鈕。
 * 圖示按鈕的名稱放在 title（滑鼠移上去顯示）與 aria-label。
 */
export function Toolbar(props: Props) {
  const { visible, win, layout, onLayout, toast, canControl } = props
  const api = window.multiview
  const [brightnessAnchor, setBrightnessAnchor] = useState<DOMRect | null>(null)
  const openBrightness = (anchor: DOMRect | null) => {
    setBrightnessAnchor(anchor)
    props.onPopupChange(anchor !== null)
  }
  const fullscreen = win.fullscreen || props.solo
  return (
    <div className={`toolbar ${visible ? 'show' : ''}`}>
      <div className="seg" role="group" aria-label="版型">
        {LAYOUT_IDS.map((id) => (
          <button
            key={id}
            className={`seg-btn ${id === layout ? 'active' : ''}`}
            title={`版型：${LAYOUT_LABELS[id]}`}
            aria-label={`版型：${LAYOUT_LABELS[id]}`}
            aria-pressed={id === layout}
            onClick={() => onLayout(id)}
          >
            <LayoutIcon id={id} />
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="全部的格子">
        <button className="seg-btn" disabled={!canControl} title="全部播放" aria-label="全部播放" onClick={props.onPlayAll}>
          <PlayIcon />
        </button>
        <button className="seg-btn" disabled={!canControl} title="全部暫停" aria-label="全部暫停" onClick={props.onPauseAll}>
          <PauseIcon />
        </button>
        <button className="seg-btn" disabled={!canControl} title="全部靜音" aria-label="全部靜音" onClick={props.onMuteAll}>
          <MuteIcon />
        </button>
      </div>
      <div className="toolbar-drag">{toast && <span className="toast">{toast}</span>}</div>
      <div className="toolbar-group">
        <button
          className={`tb-btn tb-text ${props.brightness !== BRIGHTNESS_DEFAULT ? 'active' : ''}`}
          title={`總亮度 ${props.brightness}%：和每一格的亮度相乘`}
          onPointerDown={(e) => brightnessAnchor && e.stopPropagation()}
          onClick={(e) => openBrightness(brightnessAnchor ? null : e.currentTarget.getBoundingClientRect())}
        >
          <SunIcon />
          <span>{props.brightness}%</span>
        </button>
        {brightnessAnchor && (
          <SliderPopup
            anchor={brightnessAnchor}
            placement="below"
            title="總亮度"
            min={BRIGHTNESS_MIN}
            max={BRIGHTNESS_MAX}
            step={BRIGHTNESS_STEP}
            value={props.brightness}
            format={(v) => `${v}%`}
            onChange={props.onBrightness}
            onReset={() => props.onBrightness(BRIGHTNESS_DEFAULT)}
            onClose={() => openBrightness(null)}
          />
        )}
        <button
          className={`tb-btn ${props.listOpen ? 'active' : ''}`}
          title="最愛與歷史清單"
          aria-label="最愛與歷史清單"
          aria-pressed={props.listOpen}
          onClick={props.onToggleList}
        >
          <ListIcon />
        </button>
        <button
          className="tb-btn"
          title="YouTube 小視窗：推薦、留言、聊天室、搜尋"
          aria-label="YouTube 小視窗"
          onClick={props.onOpenCompanion}
        >
          <CompanionIcon />
        </button>
        <button
          className={`tb-btn ${win.alwaysOnTop ? 'active' : ''}`}
          title="視窗置頂"
          aria-label="視窗置頂"
          aria-pressed={win.alwaysOnTop}
          onClick={api.toggleAlwaysOnTop}
        >
          <PinIcon />
        </button>
        <button
          className={`tb-btn ${fullscreen ? 'active' : ''}`}
          title={fullscreen ? '離開全螢幕 (F11)' : '全螢幕 (F11)'}
          aria-label={fullscreen ? '離開全螢幕' : '全螢幕'}
          onClick={props.onToggleFullscreen}
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
        <button
          className="tb-btn"
          title="設定"
          aria-label="設定"
          onClick={() => {
            openBrightness(null)
            props.onOpenSettings()
          }}
        >
          <GearIcon />
        </button>
      </div>
      <div className="win-controls">
        <button className="win-btn" title="最小化" aria-label="最小化" onClick={api.minimize}>
          <MinimizeIcon />
        </button>
        <button className="win-btn close" title="關閉" aria-label="關閉" onClick={api.close}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
