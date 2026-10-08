import { useCallback, useEffect, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Grid } from './components/Grid'
import { useWindowState } from './hooks/useWindowState'
import { usePointerZones } from './hooks/usePointerZones'
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
import { focusAudio, initialMuted, muteAll, setVolume, toggleMute } from './lib/audio'
import { controllableIndices } from './lib/playback'
import type { PlayerHandle, PlayStatus } from './players/types'

const TOAST_MS = 3000

export default function App() {
  const win = useWindowState()
  const { toolbarVisible, direct, setDirect } = usePointerZones()

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
        muted: existing ? existing.muted : initialMuted(slots, layout),
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

  const onFocusAudio = (index: number) => {
    const s = slots[index]
    // 空白格或錯誤狀態的格子不影響聲音（R7）
    if (s && statuses[s.id] !== 'error') setSlots(focusAudio(slots, index))
  }

  const controllable = controllableIndices(slots, layout, statuses)
  const playAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.play())
  const pauseAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.pause())

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
        onFocusAudio={onFocusAudio}
        onToggleMute={(i) => setSlots(toggleMute(slots, i))}
        onVolume={(i, v) => setSlots(setVolume(slots, i, v))}
        direct={direct}
        onDirect={setDirect}
      />
      <Toolbar
        visible={toolbarVisible || toast !== null}
        win={win}
        layout={layout}
        onLayout={changeLayout}
        toast={toast}
        canControl={controllable.length > 0}
        onPlayAll={playAll}
        onPauseAll={pauseAll}
        onMuteAll={() => setSlots(muteAll(slots))}
      />
    </div>
  )
}
