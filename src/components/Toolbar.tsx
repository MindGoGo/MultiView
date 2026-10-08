import type { WinState } from '../../electron/preload'

interface Props {
  visible: boolean
  win: WinState
}

export function Toolbar({ visible, win }: Props) {
  const api = window.multiview
  return (
    <div className={`toolbar ${visible ? 'show' : ''}`}>
      <div className="toolbar-drag" />
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
