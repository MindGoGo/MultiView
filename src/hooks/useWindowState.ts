import { useEffect, useState } from 'react'
import type { WinState } from '../../electron/preload'

/** 視窗大小改變後多久重新確認全螢幕狀態（R67） */
const RECHECK_MS = 300

export function useWindowState(): WinState {
  const [state, setState] = useState<WinState>({ fullscreen: false, alwaysOnTop: false })
  useEffect(() => {
    void window.multiview.getWindowState().then(setState)
    const off = window.multiview.onWindowState(setState)
    // 進出全螢幕一定會改變視窗大小：大小改變後重新確認狀態，錯過狀態通知時也會更正（R67）
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void window.multiview.getWindowState().then(setState), RECHECK_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      off()
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return state
}
