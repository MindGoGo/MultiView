import { useCallback, useEffect, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Grid } from './components/Grid'
import { useWindowState } from './hooks/useWindowState'
import {
  DEFAULT_LAYOUT,
  defaultRatios,
  minFraction,
  moveDivider,
  resetDivider,
  type Axis,
  type LayoutId,
  type Ratios
} from './lib/layout'
import { emptySlots, hiddenCount, newSourceId, setSlot, swapSlots, type Slots } from './lib/slots'
import { parseSource } from './lib/source'
import type { PlayerHandle, PlayStatus } from './players/types'

const TOOLBAR_ZONE_PX = 40
const TOOLBAR_HIDE_MS = 1000
const TOAST_MS = 3000

export default function App() {
  const win = useWindowState()
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [layout, setLayout] = useState<LayoutId>(DEFAULT_LAYOUT)
  const [ratiosMap, setRatiosMap] = useState<Partial<Record<LayoutId, Ratios>>>({})
  const ratios = ratiosMap[layout] ?? defaultRatios(layout)
  const [slots, setSlots] = useState<Slots>(emptySlots)
  const [statuses, setStatuses] = useState<Record<number, PlayStatus>>({})
  const players = useRef(new Map<number, PlayerHandle>())
  const [move, setMove] = useState<{ from: number; over: number | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showToast = (message: string) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }

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

  const registerPlayer = useCallback((id: number, handle: PlayerHandle | null) => {
    if (handle) players.current.set(id, handle)
    else players.current.delete(id)
  }, [])

  const onStatus = useCallback((id: number, status: PlayStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  const onSubmitUrl = (index: number, text: string): string | null => {
    const parsed = parseSource(text)
    if (!parsed) return '不支援的網址'
    const existing = slots[index]
    setSlots(
      setSlot(slots, index, {
        id: newSourceId(),
        url: text.trim(),
        parsed,
        // 更換網址時保留原本的聲音設定（R2 AC8）
        muted: existing ? existing.muted : false,
        volume: existing ? existing.volume : 100,
        autoplay: true
      })
    )
    return null
  }

  const onRemove = (index: number) => setSlots(setSlot(slots, index, null))

  const onRetry = (index: number) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, id: newSourceId(), autoplay: true }))
  }

  // 每種版型的比例分開記錄（R5 AC4）
  const updateRatios = (axis: Axis, fn: (sizes: number[], min: number) => number[], px: number) => {
    const sizes = fn(ratios[axis], minFraction(axis, px))
    setRatiosMap((prev) => ({ ...prev, [layout]: { ...ratios, [axis]: sizes } }))
  }
  const onDividerDrag = (axis: Axis, index: number, pos: number, px: number) =>
    updateRatios(axis, (sizes, min) => moveDivider(sizes, index, pos, min), px)
  const onDividerReset = (axis: Axis, index: number, px: number) =>
    updateRatios(axis, (sizes, min) => resetDivider(sizes, index, min), px)

  const onMoveEnd = (target: number | null) => {
    // 放在原本的格子或視窗外不做任何事（R6 AC3）
    if (move && target !== null) setSlots(swapSlots(slots, move.from, target))
    setMove(null)
  }

  const changeLayout = (next: LayoutId) => {
    setLayout(next)
    const n = hiddenCount(slots, next)
    if (n > 0) showToast(`有 ${n} 個來源暫時隱藏`)
  }

  return (
    <div className="app">
      <Grid
        layout={layout}
        ratios={ratios}
        slots={slots}
        statuses={statuses}
        registerPlayer={registerPlayer}
        onStatus={onStatus}
        onSubmitUrl={onSubmitUrl}
        onRemove={onRemove}
        onRetry={onRetry}
        onDividerDrag={onDividerDrag}
        onDividerReset={onDividerReset}
        move={move}
        onMoveStart={(from) => setMove({ from, over: from })}
        onMoveOver={(over) => setMove((m) => (m ? { ...m, over } : m))}
        onMoveEnd={onMoveEnd}
      />
      <Toolbar
        visible={toolbarVisible || toast !== null}
        win={win}
        layout={layout}
        onLayout={changeLayout}
        toast={toast}
      />
    </div>
  )
}
