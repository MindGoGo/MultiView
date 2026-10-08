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
import { controllableIndices, isPlayingStatus, toggleAllAction } from './lib/playback'
import { shortcutFor } from './lib/shortcuts'
import type { ViewSettings } from './lib/settings'
import type { NavState, PlayerHandle, PlayStatus } from './players/types'
import type { WebMode } from './players/webTypes'
import type { WebFailure } from './lib/webErrors'
import {
  addFavorite,
  clearHistory,
  defaultName,
  deleteItem,
  editItem,
  emptyLists,
  isFavorite,
  recordHistory,
  removeFavorite,
  LIST_ERROR,
  type ListItem,
  type ListKind,
  type Lists
} from './lib/lists'
import { ListPanel } from './components/ListPanel'

const TOAST_MS = 3000

/** 還原上次的來源：一律先暫停，等使用者按播放（R10 AC1） */
function restoreSlots(saved: ViewSettings['slots']): Slots {
  const slots = emptySlots()
  saved.forEach((s, i) => {
    const parsed = s && parseSource(s.url)
    if (s && parsed)
      slots[i] = {
        id: newSourceId(),
        url: s.url,
        parsed,
        muted: s.muted,
        volume: s.volume,
        autoplay: false,
        adblock: s.adblock,
        quality: s.quality
      }
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
  const [failures, setFailures] = useState<Record<number, WebFailure>>({})
  const [navStates, setNavStates] = useState<Record<number, NavState>>({})
  const onNavState = useCallback((id: number, s: NavState) => setNavStates((prev) => ({ ...prev, [id]: s })), [])
  const players = useRef(new Map<number, PlayerHandle>())
  const [move, setMove] = useState<{ from: number; over: number | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 單格全螢幕（R20）：放大的格位、進入前視窗是否已經全螢幕、離開時要恢復播放的來源 id */
  const [solo, setSolo] = useState<{ index: number; wasFullscreen: boolean; resume: number[] } | null>(null)
  const soloIndex = solo?.index ?? null

  // ---- 最愛與歷史清單（R21–R23） ----
  const [lists, setLists] = useState<Lists>(emptyLists)
  const listsLoaded = useRef(false)
  const [listOpen, setListOpen] = useState(false)
  const [listOver, setListOver] = useState<number | null>(null)
  useEffect(() => {
    void window.multiview.getLists().then((l) => {
      listsLoaded.current = true
      setLists(l)
    })
  }, [])
  // 讀回清單之前不寫入，避免用空的清單蓋掉檔案
  useEffect(() => {
    if (listsLoaded.current) window.multiview.saveLists(lists)
  }, [lists])
  /** 已經記錄過歷史的來源 id（每個來源只記一次） */
  const recorded = useRef(new Set<number>())
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
      slots: slots.map((s) =>
        s ? { url: s.url, muted: s.muted, volume: s.volume, adblock: s.adblock, quality: s.quality } : null
      )
    })
  }, [layout, ratiosMap, slots])

  const registerPlayer = useCallback((id: number, handle: PlayerHandle | null) => {
    if (handle) players.current.set(id, handle)
    else players.current.delete(id)
  }, [])

  // 使用者放入的來源第一次成功載入時記錄到歷史（R23）
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const onLoaded = useCallback((id: number) => {
    const s = slotsRef.current.find((x) => x?.id === id)
    if (!s || !s.record || recorded.current.has(id)) return
    recorded.current.add(id)
    const title = players.current.get(id)?.getTitle() ?? null
    setLists((l) => recordHistory(l, s.url, title, Date.now()))
  }, [])

  const onStatus = useCallback((id: number, status: PlayStatus, failure?: WebFailure) => {
    // 網頁來源以「網頁載入完成」為準，其他來源以開始播放或暫停為準
    const s = slotsRef.current.find((x) => x?.id === id)
    if (s && s.parsed.kind !== 'web' && (status === 'playing' || status === 'paused' || status === 'ended')) onLoaded(id)
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
    if (failure) setFailures((prev) => (prev[id] === failure ? prev : { ...prev, [id]: failure }))
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
        muted: existing ? existing.muted : initialMuted(slots, layout, soloIndex),
        volume: existing ? existing.volume : 100,
        autoplay: true,
        // 廣告阻擋預設開啟（R17）
        adblock: true,
        record: true,
        // 更換網址時保留原本的畫質設定，新的格子預設自動（R24）
        quality: existing ? existing.quality : 'auto'
      })
    )
    return null
  }

  const onRemove = (index: number) => {
    // 移除放大的那一格時離開單格全螢幕（R20 AC7）
    if (solo?.index === index) exitSolo()
    setSlots(setSlot(slots, index, null))
  }

  // 切換畫質：不換 id，不重新載入（R24）
  const onToggleQuality = (index: number) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, quality: s.quality === 'high' ? 'auto' : 'high' }))
  }

  // ---- 清單操作（R21–R23） ----
  const applyResult = (r: { lists: Lists } | { error: string }): string | null => {
    if ('error' in r) return r.error
    setLists(r.lists)
    return null
  }
  const onToggleFavorite = (index: number) => {
    const s = slots[index]
    if (!s) return
    if (isFavorite(lists, s.url)) setLists(removeFavorite(lists, s.url))
    else {
      const title = players.current.get(s.id)?.getTitle() ?? null
      applyResult(addFavorite(lists, s.url, defaultName(s.url, title), Date.now()))
    }
  }
  /** 放進格子：空格就放入，有影片就更換網址（保留靜音和音量） */
  const putItem = (index: number, item: ListItem) => {
    const err = onSubmitUrl(index, item.url)
    if (err) showToast(LIST_ERROR.unsupported)
  }
  // 點一下：放進第一個顯示中的空格（R21）
  const onPickItem = (item: ListItem) => {
    const empty = slots.findIndex((s, i) => s === null && isVisible(i, layout, soloIndex))
    if (empty < 0) showToast('沒有空格，請拖到要更換的格子')
    else putItem(empty, item)
  }
  const onDropItem = (item: ListItem, cell: number | null) => {
    setListOver(null)
    if (cell !== null) putItem(cell, item)
  }
  /** 游標下的格子；被清單面板蓋住的地方不算（R21） */
  const cellAt = (x: number, y: number): number | null => {
    const panel = document.querySelector('.list-panel')?.getBoundingClientRect()
    if (panel && x >= panel.left && x < panel.right && y >= panel.top && y < panel.bottom) return null
    for (const el of document.querySelectorAll<HTMLElement>('.cell')) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return Number(el.dataset.index)
    }
    return null
  }

  // ---- 單格全螢幕（R20） ----
  const enterSolo = (index: number) => {
    if (!slots[index] || solo) return
    // 只記下「顯示中、而且正在播放」的其他來源，離開時恢復（R20 AC2、AC3、AC9）
    const resume = slots.flatMap((s, i) =>
      s && i !== index && isVisible(i, layout) && statuses[s.id] === 'playing' ? [s.id] : []
    )
    // 視窗狀態向主程序查詢：畫面這邊記的狀態可能還沒更新（R20 AC4）
    void window.multiview.getWindowState().then(({ fullscreen }) => {
      setSolo({ index, wasFullscreen: fullscreen, resume })
      if (!fullscreen) window.multiview.toggleFullscreen()
    })
  }
  const exitSolo = () => {
    if (!solo) return
    if (!solo.wasFullscreen) window.multiview.exitFullscreen()
    const ids = new Set(slots.map((s) => s?.id))
    solo.resume.forEach((id) => ids.has(id) && players.current.get(id)?.play())
    setSolo(null)
  }
  const exitSoloRef = useRef(exitSolo)
  exitSoloRef.current = exitSolo


  const onRetry = (index: number) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, id: newSourceId(), autoplay: true, record: true }))
  }

  // 切換廣告阻擋：換新的 id 讓網頁重新載入，比照「重試」（R17 AC2）
  const onToggleAdblock = (index: number) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, adblock: !s.adblock, id: newSourceId(), autoplay: true, record: false }))
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

  // 進度條（R19）
  const getProgress = (index: number) => {
    const s = slots[index]
    return (s && players.current.get(s.id)?.getProgress()) ?? null
  }
  const onSeek = (index: number, seconds: number) => {
    const s = slots[index]
    if (s) players.current.get(s.id)?.seek(seconds)
  }

  // 整頁模式的上一頁／下一頁（R28）
  const onNav = (index: number, back: boolean) => {
    const s = slots[index]
    if (!s || s.parsed.kind !== 'web' || webModes[s.id] !== 'page') return
    const p = players.current.get(s.id)
    if (back) p?.goBack?.()
    else p?.goForward?.()
  }

  // 每格的播放／暫停按鈕：只影響這一格（R26）
  const onTogglePlay = (index: number) => {
    const s = slots[index]
    const p = s && players.current.get(s.id)
    if (!p) return
    if (isPlayingStatus(statuses[s.id])) p.pause()
    else p.play()
  }

  const controllable = controllableIndices(slots, layout, statuses, soloIndex)
  const playAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.play())
  const pauseAll = () => controllable.forEach((i) => players.current.get(slots[i]!.id)?.pause())

  // 快捷鍵（R9）。網址輸入框自己處理按鍵，不會傳到這裡。
  const runShortcut = (key: string): boolean => {
    const action = shortcutFor(key)
    if (!action) return false
    switch (action.type) {
      case 'toggleAll':
        if (toggleAllAction(slots, layout, statuses, soloIndex) === 'pause') pauseAll()
        else playAll()
        break
      case 'muteAll':
        setSlots(muteAll(slots))
        break
      case 'focusAudio':
        // 單格全螢幕時數字鍵不作用（R20 AC5）
        if (soloIndex === null && isVisible(action.index, layout)) onFocusAudio(action.index)
        break
      case 'toggleFullscreen':
        // 單格全螢幕時 F11、Esc 先離開單格全螢幕（R20）
        if (solo) exitSolo()
        else window.multiview.toggleFullscreen()
        break
      case 'exitFullscreen':
        if (solo) exitSolo()
        else window.multiview.exitFullscreen()
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
    // 單格全螢幕時先回到分割畫面，再切換版型（R20 AC6）
    exitSoloRef.current()
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
        failures={failures}
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
        onToggleAdblock={onToggleAdblock}
        solo={soloIndex}
        onToggleSolo={(i) => (solo ? exitSolo() : enterSolo(i))}
        onTogglePlay={onTogglePlay}
        navStates={navStates}
        onNavState={onNavState}
        onNav={onNav}
        onLoaded={onLoaded}
        listOver={listOver}
        isFavorite={(url) => isFavorite(lists, url)}
        onToggleFavorite={onToggleFavorite}
        onToggleQuality={onToggleQuality}
        getProgress={getProgress}
        onSeek={onSeek}
      />
      <Toolbar
        visible={toolbarVisible || toast !== null || listOpen}
        win={win}
        layout={layout}
        onLayout={changeLayout}
        toast={toast}
        canControl={controllable.length > 0}
        onPlayAll={playAll}
        onPauseAll={pauseAll}
        onMuteAll={() => setSlots(muteAll(slots))}
        listOpen={listOpen}
        onToggleList={() => setListOpen((o) => !o)}
        onToggleFullscreen={() => runShortcutRef.current('F11')}
      />
      {listOpen && (
        <ListPanel
          lists={lists}
          onClose={() => setListOpen(false)}
          onAddFavorite={(url, name) => applyResult(addFavorite(lists, url, name, Date.now()))}
          onEdit={(kind: ListKind, i, url, name) => applyResult(editItem(lists, kind, i, url, name))}
          onDelete={(kind: ListKind, i) => setLists(deleteItem(lists, kind, i))}
          onClearHistory={() => setLists(clearHistory(lists))}
          onPick={onPickItem}
          onDragOver={setListOver}
          onDrop={onDropItem}
          cellAt={cellAt}
        />
      )}
    </div>
  )
}
