import type { WinState } from '../../electron/preload'
import { LAYOUT_IDS, LAYOUT_LABELS, type LayoutId } from '../lib/layout'

interface Props {
  visible: boolean
  win: WinState
  layout: LayoutId
  onLayout(layout: LayoutId): void
  toast: string | null
}

export function Toolbar({ visible, win, layout, onLayout, toast }: Props) {
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
      <div className="toolbar-drag">{toast && <span className="toast">{toast}</span>}</div>
      <div className="toolbar-group">
        <button
          className={win.alwaysOnTop ? 'active' : ''}
          title="視窗置頂"
          onClick={api.toggleAlwaysOnTop}
        >
          置頂
        </button>
        <button title="全螢幕 (F11)" onClick={api.toggleFullscreen}>
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
