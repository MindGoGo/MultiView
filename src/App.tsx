import { useCallback, useEffect, useRef, useState } from 'react'
import { Toolbar } from './components/Toolbar'
import { Grid } from './components/Grid'
import { useWindowState } from './hooks/useWindowState'
import { usePointerZones } from './hooks/usePointerZones'
import {
  defaultRatios,
  minFraction,
  moveDivider,
  resetDivider,
  type Axis,
  type LayoutId,
  type Ratios
} from './lib/layout'
import {
  emptySlots,
  hiddenCount,
  isVisible,
  newSourceId,
  setSlot,
  swapSlots,
  type Slots
} from './lib/slots'
import { parseSource } from './lib/source'
import { focusAudio, initialMuted, muteAll, setVolume, toggleMute } from './lib/audio'
import { controllableIndices, toggleAllAction } from './lib/playback'
import { shortcutFor } from './lib/shortcuts'
import type { ViewSettings } from './lib/settings'
import type { PlayerHandle, PlayStatus } from './players/types'
import type { WebMode } from './players/webTypes'

const TOAST_MS = 3000

/** 還原上次的來源：一律先暫停，等使用者按播放（R10 AC1） */
function restoreSlots(saved: ViewSettings['slots']): Slots {
  const slots = emptySlots()
  saved.forEach((s, i) => {
    const parsed = s && parseSource(s.url)
    if (s && parsed)
      slots[i] = { id: newSourceId(), url: s.url, parsed, muted: s.muted, volume: s.volume, autoplay: false }
  })
  return slots
}

export default function App({ initial }: { initial: ViewSettings }) {
  const win = useWindowState()
  // 網頁來源的顯示模式不保存，重新開啟時一律是影片模式（R14）
  const [webModes, setWebModes] = useState<Record<number, WebMode>>({})
  const anyPageMode = Object.values(webModes).includes('page')
  const { toolbarVisible, direct, setDirect } = usePointerZones(anyPageMode)

  const [layout, setLayout] = useState<LayoutId>(initial.layout)
  const [ratiosMap, setRatiosMap] = useState<Partial<Record<LayoutId, Ratios>>>(initial.ratios)
  const ratios = ratiosMap[layout] ?? defaultRatios(layout)
  const [slots, setSlots] = useState<Slots>(() => restoreSlots(initial.slots))
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

  // 任何設定變更都送給主程序，由主程序合併後寫入檔案（R10 AC3）
  useEffect(() => {
    window.multiview.saveView({
      layout,
      ratios: ratiosMap,
      slots: slots.map((s) => (s ? { url: s.url, muted: s.muted, volume: s.volume } : null))
    })
  }, [layout, ratiosMap, slots])

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

  const onWebMode = useCallback((id: number, mode: WebMode) => {
    setWebModes((prev) => (prev[id] === mode ? prev : { ...prev, [id]: mode }))
  }, [])

  const onToggleWebMode = (index: number) => {
    const s = slots[index]
    if (!s) return
    if ((webModes[s.id] ?? 'video') === 'page') players.current.get(s.id)?.requestVideoMode?.()
    else onWebMode(s.id, 'page')
  }

  const onFocusAudio = (index: number) => {
    const s = slots[index]
    // 空白格或錯誤狀態的格子不影響聲音（R7）
    if (s && statuses[s.id] !== 'error') setSlots(focusAudio(slots, index))
  }

  const controllable = controllableIndices(slots, layout, statuses)
  const playAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.play())
  const pauseAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.pause())

  // 快捷鍵（R9）。網址輸入框自己處理按鍵，不會傳到這裡。
  const runShortcut = (key: string): boolean => {
    const action = shortcutFor(key)
    if (!action) return false
    switch (action.type) {
      case 'toggleAll':
        if (toggleAllAction(slots, layout, statuses) === 'pause') pauseAll()
        else playAll()
        break
      case 'muteAll':
        setSlots(muteAll(slots))
        break
      case 'focusAudio':
        if (isVisible(action.index, layout)) onFocusAudio(action.index)
        break
      case 'toggleFullscreen':
        window.multiview.toggleFullscreen()
        break
      case 'exitFullscreen':
        window.multiview.exitFullscreen()
        break
    }
    return true
  }
  const runShortcutRef = useRef(runShortcut)
  runShortcutRef.current = runShortcut

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      // 只排除文字輸入框；音量滑桿有焦點時快捷鍵照樣有效
      const typing = t instanceof HTMLInputElement ? t.type !== 'range' : t.tagName === 'TEXTAREA'
      if (e.repeat || typing) return
      if (runShortcutRef.current(e.key)) e.preventDefault()
    }
    // 點擊網頁以外的地方時，把焦點從整頁模式的網頁拿回來，快捷鍵才會恢復（R14 AC5）
    const onPointerDown = () => {
      const el = document.activeElement as HTMLElement | null
      if (el?.tagName === 'WEBVIEW') el.blur()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    const offShortcut = window.multiview.onShortcut((key) => runShortcutRef.current(key))
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
      offShortcut()
    }
  }, [])

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
        webModes={webModes}
        onWebMode={onWebMode}
        onToggleWebMode={onToggleWebMode}
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
