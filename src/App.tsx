import { useEffect, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { useWindowState } from './hooks/useWindowState'

const TOOLBAR_ZONE_PX = 40
const TOOLBAR_HIDE_MS = 1000

export default function App() {
  const win = useWindowState()
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (e.clientY < TOOLBAR_ZONE_PX) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        hideTimer.current = null
        setToolbarVisible(true)
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          setToolbarVisible(false)
        }, TOOLBAR_HIDE_MS)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault()
        window.multiview.toggleFullscreen()
      } else if (e.key === 'Escape') {
        window.multiview.exitFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Toolbar visible={toolbarVisible} win={win} />
    </div>
  )
}
