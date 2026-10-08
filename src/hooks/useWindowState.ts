import { useEffect, useState } from 'react'
import type { WinState } from '../../electron/preload'

export function useWindowState(): WinState {
  const [state, setState] = useState<WinState>({ fullscreen: false, alwaysOnTop: false })
  useEffect(() => {
    void window.multiview.getWindowState().then(setState)
    return window.multiview.onWindowState(setState)
  }, [])
  return state
}
