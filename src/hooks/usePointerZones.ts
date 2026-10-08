// 依游標位置決定工具列是否顯示，以及何時結束「直接操作播放器」（R3）
import { useEffect, useRef, useState } from 'react'

const TOOLBAR_ZONE_PX = 40
const TOOLBAR_HIDE_MS = 1000

function insideCell(index: number, x: number, y: number): boolean {
  const el = document.querySelector(`.cell[data-index="${index}"]`)
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom
}

/** keepWatching：有網頁來源在整頁模式時，格子要靠游標位置顯示操作按鈕（R14） */
export function usePointerZones(keepWatching = false) {
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [direct, setDirect] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const directRef = useRef(direct)
  directRef.current = direct

  useEffect(() => {
    const update = (x: number, y: number, inside: boolean) => {
      if (inside && y < TOOLBAR_ZONE_PX) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        hideTimer.current = null
        setToolbarVisible(true)
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          setToolbarVisible(false)
        }, TOOLBAR_HIDE_MS)
      }

      const d = directRef.current
      if (d !== null && !(inside && insideCell(d, x, y))) {
        setDirect(null)
        // 焦點可能還在 YouTube 播放器裡，拿回來讓快捷鍵繼續有效
        ;(document.activeElement as HTMLElement | null)?.blur()
      }
    }

    const onMove = (e: MouseEvent) => update(e.clientX, e.clientY, true)
    const onLeave = () => update(-1, -1, false)
    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    const offCursor = window.multiview.onCursor((p) => update(p.x, p.y, p.inside))
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      offCursor()
    }
  }, [])

  // 只在需要時請主程序回報游標位置
  const watching = toolbarVisible || direct !== null || keepWatching
  useEffect(() => {
    window.multiview.watchCursor(watching)
  }, [watching])

  return { toolbarVisible, direct, setDirect }
}
