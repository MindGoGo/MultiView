import type { WinState } from '../../electron/preload'
import { LAYOUT_IDS, LAYOUT_LABELS, type LayoutId } from '../lib/layout'

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
}

export function Toolbar(props: Props) {
  const { visible, win, layout, onLayout, toast, canControl } = props
  const api = window.multiview
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
        <button className={props.listOpen ? 'active' : ''} title="最愛與歷史清單" onClick={props.onToggleList}>
          ☰ 清單
        </button>
        <button
          className={win.alwaysOnTop ? 'active' : ''}
          title="視窗置頂"
          onClick={api.toggleAlwaysOnTop}
        >
          置頂
        </button>
        <button title="全螢幕 (F11)" onClick={props.onToggleFullscreen}>
          {win.fullscreen ? '離開全螢幕' : '全螢幕'}
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
