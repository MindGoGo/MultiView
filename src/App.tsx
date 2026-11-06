import { useCallback, useEffect, useRef, useState } from 'react'
import { parseTakeoutCsv } from './lib/youtubeFeed'
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
  type Slots,
  type Source
} from './lib/slots'
import { isYouTubeSite, parseSource, resolveSource } from './lib/source'
import { focusAudio, initialMuted, muteAll, setVolume, toggleMute } from './lib/audio'
import { controllableIndices, isPlayingStatus, toggleAllAction } from './lib/playback'
import { shortcutFor, isRepeatableKey } from './lib/shortcuts'
import type { ViewSettings } from './lib/settings'
import type { NavState, PlayerHandle, PlayStatus } from './players/types'
import type { WebMode } from './players/webTypes'
import type { Failure } from './lib/webErrors'
import type { Quality } from './lib/quality'
import { BRIGHTNESS_DEFAULT } from './lib/brightness'
import type { YtMode } from './players/YouTubeSource'
import { SettingsDialog } from './components/SettingsDialog'
import { canonicalYouTubeUrl, classifyLink, youtubePageUrl } from './lib/links'
import { skipTarget, resumePosition } from './lib/progress'
import {
  addChannel,
  addChannels,
  addFavorite,
  CHANNEL_ERROR,
  removeChannel,
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
import { ListPanel, type ListTab } from './components/ListPanel'
import { CellPicker, type PickerCell } from './components/CellPicker'
import { isCompanionTab, stripYouTubeSuffix, type CompanionAction, type CompanionLink, type CompanionVideo } from './lib/companion'

const TOAST_MS = 3000
const YT_FALLBACK_TOAST = 'yt-dlp 無法播放，已改用內嵌播放器'
/** 觀看進度多久讀一次（R55） */
const POSITION_SAVE_MS = 5000
/** 多久確認一次小視窗連結的格子目前的影片（R78） */
const COMPANION_LINK_MS = 1000

/** 改用 YouTube 網頁播放：廣告阻擋預設關閉；使用者放入的影片在網頁載入完成時記錄到歷史（R48） */
function toYoutubeWeb(s: Source, autoplay: boolean): Source | null {
  const parsed = resolveSource(s.url, true)
  return parsed && { ...s, id: newSourceId(), parsed, youtubeWeb: true, adblock: false, autoplay }
}

/** 還原上次的來源：一律先暫停，等使用者按播放（R10 AC1） */
function restoreSlots(saved: ViewSettings['slots']): Slots {
  const slots = emptySlots()
  saved.forEach((s, i) => {
    const parsed = s && resolveSource(s.url, s.youtubeWeb)
    if (s && parsed)
      slots[i] = {
        id: newSourceId(),
        url: s.url,
        parsed,
        muted: s.muted,
        volume: s.volume,
        autoplay: false,
        adblock: s.adblock,
        quality: s.quality,
        captions: s.captions,
        audioLang: s.audioLang,
        brightness: s.brightness,
        youtubeWeb: s.youtubeWeb,
        resume: s.position,
        backUrl: s.backUrl,
        pageAdblock: s.pageAdblock
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
  /** 總亮度（R41） */
  const [masterBrightness, setMasterBrightness] = useState(initial.brightness)
  /** YouTube 無法嵌入時自動改用網頁播放（R49） */
  const [autoYoutubeWeb, setAutoYoutubeWeb] = useState(initial.autoYoutubeWeb)
  const autoYoutubeWebRef = useRef(autoYoutubeWeb)
  autoYoutubeWebRef.current = autoYoutubeWeb
  /** YouTube 直播、一般影片的播放方式（R88） */
  const [youtubeMethods, setYoutubeMethods] = useState(initial.youtubeMethods)
  /** YouTube 格子目前的播放方式，依來源 id（R89） */
  const [ytModes, setYtModes] = useState<Record<number, YtMode>>({})
  const onYtMode = useCallback(
    (id: number, mode: YtMode) => setYtModes((prev) => (prev[id] === mode ? prev : { ...prev, [id]: mode })),
    []
  )
  /** 工具列的總亮度選單開著時，工具列不自動隱藏（R41 AC4） */
  const [toolbarPopup, setToolbarPopup] = useState(false)
  /** 設定視窗（R96） */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const settingsOpenRef = useRef(settingsOpen)
  settingsOpenRef.current = settingsOpen
  const ratios = ratiosMap[layout] ?? defaultRatios(layout)
  const [slots, setSlots] = useState<Slots>(() => restoreSlots(initial.slots))
  const [statuses, setStatuses] = useState<Record<number, PlayStatus>>({})
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const [failures, setFailures] = useState<Record<number, Failure>>({})
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
  /** 清單面板上次的那一邊和分頁（R58） */
  const [listTab, setListTab] = useState<ListTab>(initial.listTab)
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

  const toastRef = useRef(toast)
  toastRef.current = toast
  const showToast = (message: string) => {
    toastRef.current = message
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }

  // 退回內嵌播放器的提示：提示還在顯示時不重複、不延長（R90）
  const onYtFallback = useCallback(() => {
    if (toastRef.current !== YT_FALLBACK_TOAST) showToast(YT_FALLBACK_TOAST)
  }, [])

  // 觀看進度（R55）：來源 id → 要保存的位置。每 5 秒讀一次，改變超過 1 秒才更新（才會寫檔）
  const [positions, setPositions] = useState<Record<number, number | null>>({})
  const readPositions = (prev: Record<number, number | null>) => {
    const next: Record<number, number | null> = {}
    let changed = false
    for (const s of slotsRef.current) {
      if (!s) continue
      const p = players.current.get(s.id)?.getProgress() ?? null
      // 還不知道進度（例如影片資訊還沒讀到）時保留原本的值
      const pos = p ? resumePosition(p, statusesRef.current[s.id] === 'ended') : (prev[s.id] ?? s.resume)
      next[s.id] = pos
      const old = prev[s.id] ?? s.resume
      if (pos === null ? old !== null : old === null || Math.abs(pos - old) > 1) changed = true
    }
    return changed ? next : prev
  }
  useEffect(() => {
    const timer = setInterval(() => setPositions((prev) => readPositions(prev)), POSITION_SAVE_MS)
    return () => clearInterval(timer)
  }, [])
  const viewOf = (pos: Record<number, number | null>): ViewSettings => ({
    layout,
    ratios: ratiosMap,
    brightness: masterBrightness,
    autoYoutubeWeb,
    youtubeMethods,
    listTab,
    slots: slots.map((s) =>
      s
        ? {
            url: s.youtubePage ? pageVideoUrl(s) : s.url,
            muted: s.muted,
            volume: s.volume,
            adblock: s.adblock,
            quality: s.quality,
            captions: s.captions,
            audioLang: s.audioLang ?? null,
            brightness: s.brightness,
            youtubeWeb: s.youtubeWeb,
            position: s.id in pos ? pos[s.id] : s.resume,
            backUrl: s.backUrl ?? null,
            pageAdblock: s.pageAdblock ?? true
          }
        : null
    )
  })
  const viewOfRef = useRef(viewOf)
  viewOfRef.current = viewOf
  // 關閉前送出每一格最新的觀看進度（R55 AC9）
  useEffect(
    () =>
      window.multiview.onClosing(() => {
        window.multiview.saveView(viewOfRef.current(readPositions({})))
        window.multiview.closingDone()
      }),
    []
  )

  // 任何設定變更都送給主程序，由主程序合併後寫入檔案（R10 AC3）
  useEffect(() => {
    window.multiview.saveView(viewOf(positions))
  }, [layout, ratiosMap, slots, masterBrightness, autoYoutubeWeb, youtubeMethods, positions, listTab])


  const registerPlayer = useCallback((id: number, handle: PlayerHandle | null) => {
    if (handle) players.current.set(id, handle)
    else players.current.delete(id)
  }, [])

  // 使用者放入的來源第一次成功載入時記錄到歷史（R23）
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const onLoaded = useCallback((id: number) => {
    const s = slotsRef.current.find((x) => x?.id === id)
    // YouTube 網站頁面不是影片，不記錄到歷史（R57）
    if (!s || !s.record || recorded.current.has(id) || isYouTubeSite(s.url)) return
    recorded.current.add(id)
    const raw = players.current.get(id)?.getTitle() ?? null
    // YouTube 網頁播放的名稱是網頁標題，去掉結尾的「 - YouTube」（R48）
    const title = s.youtubeWeb && raw ? raw.replace(/ - YouTube$/, '') : raw
    setLists((l) => recordHistory(l, s.url, title, Date.now()))
  }, [])

  const onStatus = useCallback((id: number, status: PlayStatus, failure?: Failure) => {
    // 自動改用網頁播放：不顯示錯誤，維持原本是否自動播放（開啟程式時還原的格子仍然先暫停）（R49）
    if (failure === 'embed' && autoYoutubeWebRef.current) {
      setSlots((prev) => {
        const index = prev.findIndex((x) => x?.id === id)
        const next = index >= 0 && prev[index] ? toYoutubeWeb(prev[index]!, prev[index]!.autoplay) : null
        return next ? setSlot(prev, index, next) : prev
      })
      return
    }
    // 網頁來源以「網頁載入完成」為準，其他來源以開始播放或暫停為準
    const s = slotsRef.current.find((x) => x?.id === id)
    if (s && s.parsed.kind !== 'web' && (status === 'playing' || status === 'paused' || status === 'ended')) onLoaded(id)
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
    if (failure) setFailures((prev) => (prev[id] === failure ? prev : { ...prev, [id]: failure }))
  }, [])

  /** 這一格放入新的網址時的來源（更換網址的規則，R2 AC8）；背景的來源頁面關閉（R63） */
  const sourceFor = (index: number, text: string): Source | null => {
    const parsed = parseSource(text)
    if (!parsed) return null
    const existing = slots[index]
    return {
        id: newSourceId(),
        url: text.trim(),
        parsed,
        // 更換網址時保留原本的聲音設定（R2 AC8）
        muted: existing ? existing.muted : initialMuted(slots, layout, soloIndex),
        volume: existing ? existing.volume : 100,
        autoplay: true,
        // 廣告阻擋預設開啟（R17）；YouTube 網站頁面預設關閉（R57）
        adblock: !isYouTubeSite(text),
        record: true,
        // 更換網址時保留原本的畫質設定，新的格子預設自動（R24）
        quality: existing ? existing.quality : 'auto',
        // 更換網址時保留字幕的選擇，新影片有同一種語言就自動開啟（R31）
        captions: existing ? existing.captions : null,
        // 更換網址時保留語音的語言，新影片有這種語言就用（R95）
        audioLang: existing ? existing.audioLang : null,
        // 更換網址時保留亮度（R40）
        brightness: existing ? existing.brightness : BRIGHTNESS_DEFAULT,
        // 新的網址先用一般的判斷（R48 AC6）
        youtubeWeb: false,
        // 新的影片從頭開始（R55 AC7）
        resume: null
    }
  }
  const onSubmitUrl = (index: number, text: string): string | null => {
    const next = sourceFor(index, text)
    if (!next) return '不支援的網址'
    setSlots(setSlot(slots, index, next))
    return null
  }

  // YouTube 網頁模式（R66）：網頁上目前的影片；網頁還沒回報網址時用切換前的影片
  const pageVideoId = (s: Source): string | null => {
    const current = players.current.get(s.id)?.getUrl?.()
    const parsed = (current && parseSource(current)) || parseSource(s.url)
    return parsed?.kind === 'youtube' ? parsed.videoId : null
  }
  const pageVideoUrl = (s: Source): string => {
    const id = pageVideoId(s)
    return id ? canonicalYouTubeUrl(id) : s.url
  }
  const onYouTubeMenu = (index: number, key: string) => {
    const s = slots[index]
    if (!s) return
    if (key === 'back') onBack(index)
    else if (isCompanionTab(key)) {
      // 開啟小視窗並切到對應的分頁，連結的格子換成這一格（R78）
      setCompanionCell(index)
      window.multiview.openCompanion(key)
    } else if (key === 'page' && s.parsed.kind === 'youtube') {
      // 從播放器目前的時間接著播；暫停時網頁也停在那裡（R66 AC1、AC4）
      const t = players.current.get(s.id)?.getProgress()?.current ?? 0
      setSlots(
        setSlot(slots, index, {
          ...s,
          id: newSourceId(),
          parsed: { kind: 'web', url: youtubePageUrl(s.parsed.videoId, t) },
          youtubePage: true,
          // 預設開啟，沿用這一格上次在網頁模式的選擇（R70）
          adblock: s.pageAdblock ?? true,
          autoplay: isPlayingStatus(statuses[s.id]),
          record: false,
          resume: null
        })
      )
    } else if (key === 'player' && s.youtubePage) {
      // 播放網頁上目前的影片，從網頁上的時間接著播（R66 AC2、AC3）；換過影片時記錄到歷史
      const videoId = pageVideoId(s)
      const before = parseSource(s.url)
      const next = videoId ? sourceFor(index, canonicalYouTubeUrl(videoId)) : null
      if (!next) return
      setSlots(
        setSlot(slots, index, {
          ...next,
          autoplay: isPlayingStatus(statuses[s.id]),
          resume: players.current.get(s.id)?.getProgress()?.current ?? null,
          record: !(before?.kind === 'youtube' && before.videoId === videoId),
          back: s.back,
          backUrl: s.backUrl,
          pageAdblock: s.pageAdblock
        })
      )
    }
  }

  // 回到 YouTube 頁面（R63）：背景的來源頁面換回前景（id 不變，停在原本的位置），聲音與亮度沿用影片的設定；
  // 重開程式後沒有背景頁面，重新載入來源頁面的網址
  const onBack = (index: number) => {
    const s = slots[index]
    if (!s) return
    if (s.back) setSlots(setSlot(slots, index, { ...s.back, muted: s.muted, volume: s.volume, brightness: s.brightness }))
    else if (s.backUrl) onSubmitUrl(index, s.backUrl)
  }

  const onRemove = (index: number) => {
    // 移除放大的那一格時離開單格全螢幕（R20 AC7）
    if (solo?.index === index) exitSolo()
    setSlots(setSlot(slots, index, null))
  }

  // 選擇畫質：不換 id，不重新載入（R32）
  const onQuality = (index: number, quality: Quality) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, quality }))
  }
  const getQualityOptions = (index: number) => {
    const s = slots[index]
    return (s && players.current.get(s.id)?.getQualityOptions?.()) ?? []
  }

  // 亮度（R40）：不換 id，不重新載入
  const onBrightness = (index: number, brightness: number) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, brightness }))
  }

  // 語音（R95）：null 為自動；不換 id，不重新載入
  const onAudioLang = (index: number, lang: string | null) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, audioLang: lang }))
  }
  // 字幕（R31）：不換 id，不重新載入
  const onCaptions = (index: number, key: string | null) => {
    const s = slots[index]
    if (s) setSlots(setSlot(slots, index, { ...s, captions: key }))
  }
  const getCaptionTracks = (index: number) => {
    const s = slots[index]
    return (s && players.current.get(s.id)?.getCaptionTracks?.()) ?? null
  }
  const getAudioTracks = (index: number) => {
    const s = slots[index]
    return (s && players.current.get(s.id)?.getAudioTracks?.()) ?? null
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
  // 清單面板裡的 ☆（訂閱的最新影片，R59）
  const onToggleFavoriteUrl = (url: string, name: string) => {
    if (isFavorite(lists, url)) setLists(removeFavorite(lists, url))
    else applyResult(addFavorite(lists, url, name, Date.now()))
  }
  // 訂閱頻道（R59）：由網址取得頻道代碼與名稱；讀取期間清單可能改變，所以用最新的清單加入
  const listsRef = useRef(lists)
  listsRef.current = lists
  const onAddChannel = async (input: string): Promise<string | null> => {
    const info = await window.multiview.ytChannelInfo(input.trim())
    if (!info) return CHANNEL_ERROR.notFound
    const r = addChannel(listsRef.current, info, Date.now())
    if ('error' in r) return r.error
    setLists(r.lists)
    return null
  }
  // 從 Google Takeout 匯入訂閱（R61）
  const onImportChannels = async () => {
    const text = await window.multiview.pickTakeout()
    if (text === null) return
    const channels = parseTakeoutCsv(text)
    if (!channels) {
      showToast('這個檔案不是 YouTube 訂閱清單')
      return
    }
    const r = addChannels(listsRef.current, channels, Date.now())
    setLists(r.lists)
    showToast(`已匯入 ${r.added} 個頻道（略過 ${r.skipped} 個已訂閱）`)
  }
  /** 放進格子：空格就放入，有影片就更換網址（保留靜音和音量） */
  const putItem = (index: number, item: ListItem) => {
    const err = onSubmitUrl(index, item.url)
    if (err) showToast(LIST_ERROR.unsupported)
  }
  // 點一下：放進第一個顯示中的空格（R21）
  // 點一下：放進第一個顯示中的空格（R21）；沒有空格時，單格顯示直接取代那一格，其他情況選擇要取代的格子（R64）
  const [picking, setPicking] = useState<{ item: ListItem; cells: PickerCell[] } | null>(null)
  /** 回傳是否跳出選擇要取代的格子 */
  const onPickItem = (item: ListItem): boolean => {
    const visible = slots.map((_, i) => i).filter((i) => isVisible(i, layout, soloIndex))
    const empty = visible.find((i) => slots[i] === null)
    if (empty !== undefined) putItem(empty, item)
    else if (visible.length === 1) putItem(visible[0], item)
    else {
      const cells: PickerCell[] = []
      for (const el of document.querySelectorAll<HTMLElement>('.cell[data-index]')) {
        const index = Number(el.dataset.index)
        const s = slots[index]
        if (!s || !visible.includes(index)) continue
        cells.push({ index, rect: el.getBoundingClientRect(), name: players.current.get(s.id)?.getTitle() ?? defaultName(s.url) })
      }
      setPicking({ item, cells })
      return true
    }
    return false
  }
  const cancelPicking = useCallback(() => setPicking(null), [])
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

  // ---- YouTube 小視窗（R78–R82） ----
  /** 小視窗連結的格子（格子的位置）；還沒從格子開啟過時為 null */
  const [companionCell, setCompanionCell] = useState<number | null>(null)
  /** 格子目前的 YouTube 影片：一般播放的影片，或網頁模式網頁上目前的影片（R78） */
  const cellVideo = (index: number): CompanionVideo | null => {
    const s = slots[index]
    if (!s) return null
    let id: string | null = null
    if (s.youtubePage) id = pageVideoId(s)
    else {
      const parsed = parseSource(s.url)
      if (parsed?.kind === 'youtube') id = parsed.videoId
    }
    if (!id) return null
    const p = players.current.get(s.id)
    const progress = p?.getProgress() ?? null
    return { id, title: stripYouTubeSuffix(p?.getTitle() ?? null), live: progress ? progress.live : pageLive(id) }
  }
  /** 播放器還沒回報進度時（例如還沒播放過），由影片網頁判斷是不是直播（R81）；每部影片只查一次 */
  const liveChecks = useRef(new Map<string, boolean | null>())
  const pageLive = (id: string): boolean => {
    const known = liveChecks.current.get(id)
    if (known !== undefined) return known === true
    liveChecks.current.set(id, null)
    void window.multiview.ytVideoLive(id).then((live) => liveChecks.current.set(id, live))
    return false
  }
  const companionLinkRef = useRef(() => ({ cell: null, video: null }) as CompanionLink)
  companionLinkRef.current = () => ({
    cell: companionCell === null ? null : companionCell + 1,
    video: companionCell === null ? null : cellVideo(companionCell)
  })
  // 連結的格子換了影片時（包括網頁模式在網頁裡換影片）通知小視窗；只在改變時送出
  const sentLink = useRef('')
  const sendCompanionLink = () => {
    const link = companionLinkRef.current()
    const key = JSON.stringify(link)
    if (key === sentLink.current) return
    sentLink.current = key
    window.multiview.sendCompanionLink(link)
  }
  useEffect(() => {
    const timer = setInterval(sendCompanionLink, COMPANION_LINK_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(sendCompanionLink, [slots, companionCell])
  const onCompanionActionRef = useRef<(a: CompanionAction) => void>(() => undefined)
  onCompanionActionRef.current = (a: CompanionAction) => {
    if (a.type === 'place') {
      // 放入格子的規則和清單面板「點一下」相同；需要選擇格子時主視窗切到最前面（R82）
      if (onPickItem({ url: a.url, name: '', time: 0 })) window.multiview.focusWindow()
      return
    }
    if (companionCell === null) return
    // 推薦、留言裡的影片：連結的格子換成那部影片，和「更換網址」相同（R79、R80）
    if (a.type === 'play') {
      if (onSubmitUrl(companionCell, a.url)) showToast(LIST_ERROR.unsupported)
    } else if (a.type === 'seek') onSeek(companionCell, a.seconds)
  }
  useEffect(() => window.multiview.onCompanionAction((a) => onCompanionActionRef.current(a)), [])

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
    // 換新的 id 重新載入時，觀看進度跟著帶過去（R55）
    if (s) setSlots(setSlot(slots, index, { ...s, id: newSourceId(), autoplay: true, record: true, resume: positions[s.id] ?? s.resume }))
  }

  // YouTube 網站頁面（R57）與 YouTube 網頁模式（R66）固定是整頁模式
  useEffect(() => {
    const ids = slots
      .filter((s): s is Source => !!s && (isYouTubeSite(s.url) || !!s.youtubePage) && webModes[s.id] !== 'page')
      .map((s) => s.id)
    if (ids.length) setWebModes((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, 'page' as const])) }))
  }, [slots, webModes])

  // 在 YouTube 網站頁面點了影片：這一格換成那部影片的嵌入播放，和「更換網址」相同（R57）
  const onYouTubeVideoRef = useRef<(id: number, url: string, from: string) => void>(() => undefined)
  onYouTubeVideoRef.current = (id: number, url: string, from: string) => {
    const index = slots.findIndex((s) => s?.id === id)
    const parsed = parseSource(url)
    const page = slots[index]
    const next = index >= 0 && parsed?.kind === 'youtube' ? sourceFor(index, canonicalYouTubeUrl(parsed.videoId)) : null
    // 來源頁面保留在背景，可以回去（R63）
    if (next && page) setSlots(setSlot(slots, index, { ...next, back: page, backUrl: isYouTubeSite(from) ? from : page.url }))
  }
  const onYouTubeVideo = useCallback((id: number, url: string, from: string) => onYouTubeVideoRef.current(id, url, from), [])

  const onUseYoutubeWeb = (index: number) => {
    const s = slots[index]
    const next = s && toYoutubeWeb(s, true)
    if (next) setSlots(setSlot(slots, index, next))
  }

  // 切換廣告阻擋：換新的 id 讓網頁重新載入，比照「重試」（R17 AC2）
  const onToggleAdblock = (index: number) => {
    const s = slots[index]
    // YouTube 網頁模式：記住選擇，重新載入時接續網頁上目前的影片與時間（R70）
    const videoId = s?.youtubePage ? pageVideoId(s) : null
    if (s && videoId) {
      setSlots(
        setSlot(slots, index, {
          ...s,
          id: newSourceId(),
          adblock: !s.adblock,
          pageAdblock: !s.adblock,
          parsed: { kind: 'web', url: youtubePageUrl(videoId, players.current.get(s.id)?.getProgress()?.current ?? 0) },
          autoplay: isPlayingStatus(statuses[s.id]),
          record: false,
          resume: null
        })
      )
      return
    }
    if (s)
      setSlots(
        setSlot(slots, index, {
          ...s,
          adblock: !s.adblock,
          id: newSourceId(),
          autoplay: true,
          record: false,
          resume: positions[s.id] ?? s.resume
        })
      )
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

  // 快轉、倒轉（R51）：維持原本的播放或暫停狀態；跳轉後顯示那一格的操作區，看得到跳轉後的時間
  const [poke, setPoke] = useState({ index: -1, n: 0 })
  const onSkip = (index: number, seconds: number) => {
    const s = slots[index]
    const p = s && players.current.get(s.id)
    const progress = p?.getProgress()
    const t = progress ? skipTarget(progress, seconds) : null
    if (!p || t === null) return
    p.seek(t)
    setPoke((prev) => ({ index, n: prev.n + 1 }))
  }
  /** 游標最後的位置；離開視窗時為 null */
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => (pointer.current = { x: e.clientX, y: e.clientY })
    const onLeave = () => (pointer.current = null)
    window.addEventListener('mousemove', onMove, true)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove, true)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])
  const cellAtPointer = (): number | null => {
    const p = pointer.current
    if (!p) return null
    for (const el of document.elementsFromPoint(p.x, p.y)) {
      const cell = el.closest<HTMLElement>('.cell[data-index]')
      if (cell) return Number(cell.dataset.index)
    }
    return null
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
      case 'back': {
        // 目前操作的格子是從 YouTube 網站開啟的影片時才作用（R63 AC8）
        const index = soloIndex ?? cellAtPointer()
        const s = index !== null ? slots[index] : null
        if (index === null || !s || !(s.back || s.backUrl)) return false
        onBack(index)
        break
      }
      case 'skip': {
        // 目前操作的格子：單格全螢幕時是放大的那一格，否則是游標所在的格子（R51）
        const index = soloIndex ?? cellAtPointer()
        if (index !== null) onSkip(index, action.seconds)
        break
      }
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

  // YouTube 播放器裡的連結：影片在直接操作中的那一格播放，其他用瀏覽器開啟（R45）
  const onLink = (url: string) => {
    const s = direct !== null ? slots[direct] : null
    const youtube = s?.parsed.kind === 'youtube' ? s.parsed : null
    const action = classifyLink(url, youtube ? direct : null, youtube?.videoId ?? null)
    if (action.kind === 'play') onSubmitUrl(action.index, action.url)
    else if (action.kind === 'external') window.multiview.openExternal(action.url)
  }
  const onLinkRef = useRef(onLink)
  onLinkRef.current = onLink
  useEffect(() => window.multiview.onLink((url) => onLinkRef.current(url)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      // 只排除文字輸入框；音量滑桿有焦點時快捷鍵照樣有效
      const typing = t instanceof HTMLInputElement ? t.type !== 'range' : t.tagName === 'TEXTAREA'
      // 設定視窗開著時快捷鍵都不作用（R96）
      if ((e.repeat && !isRepeatableKey(e.key)) || typing || settingsOpenRef.current) return
      if (runShortcutRef.current(e.key)) e.preventDefault()
    }
    // 點擊網頁以外的地方時，把焦點從整頁模式的網頁拿回來，快捷鍵才會恢復（R14 AC5）
    const onPointerDown = () => {
      const el = document.activeElement as HTMLElement | null
      if (el?.tagName === 'WEBVIEW') el.blur()
    }
    // 滑鼠的「上一頁」側鍵：游標在格子上時回到 YouTube 頁面（R63）
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3 && runShortcutRef.current('BrowserBack')) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    const offShortcut = window.multiview.onShortcut((key) => !settingsOpenRef.current && runShortcutRef.current(key))
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
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
        youtubeMethods={youtubeMethods}
        ytModes={ytModes}
        onYtMode={onYtMode}
        onYtFallback={onYtFallback}
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
        onUseYoutubeWeb={onUseYoutubeWeb}
        onYouTubeVideo={onYouTubeVideo}
        onBack={onBack}
        onYouTubeMenu={onYouTubeMenu}
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
        onQuality={onQuality}
        getQualityOptions={getQualityOptions}
        onCaptions={onCaptions}
        onAudioLang={onAudioLang}
        getAudioTracks={getAudioTracks}
        onBrightness={onBrightness}
        masterBrightness={masterBrightness}
        getCaptionTracks={getCaptionTracks}
        getProgress={getProgress}
        onSeek={onSeek}
        onSkip={onSkip}
        poke={poke}
      />
      <Toolbar
        visible={toolbarVisible || toast !== null || listOpen || toolbarPopup || settingsOpen}
        win={win}
        solo={solo !== null}
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
        brightness={masterBrightness}
        onBrightness={setMasterBrightness}
        onPopupChange={setToolbarPopup}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCompanion={() => window.multiview.openCompanion(null)}
      />
      {settingsOpen && (
        <SettingsDialog
          onClose={closeSettings}
          autoYoutubeWeb={autoYoutubeWeb}
          onAutoYoutubeWeb={setAutoYoutubeWeb}
          youtubeMethods={youtubeMethods}
          onYoutubeMethods={setYoutubeMethods}
          onToast={showToast}
        />
      )}
      {picking && (
        <CellPicker
          cells={picking.cells}
          onChoose={(index) => {
            putItem(index, picking.item)
            setPicking(null)
          }}
          onCancel={cancelPicking}
        />
      )}
      {listOpen && (
        <ListPanel
          lists={lists}
          initialTab={listTab}
          onTabChange={setListTab}
          onToast={showToast}
          onClose={() => setListOpen(false)}
          onAddFavorite={(url, name) => applyResult(addFavorite(lists, url, name, Date.now()))}
          onEdit={(kind: ListKind, i, url, name) => applyResult(editItem(lists, kind, i, url, name))}
          onDelete={(kind: ListKind, i) => setLists(deleteItem(lists, kind, i))}
          onClearHistory={(group) => setLists(clearHistory(lists, group))}
          onAddChannel={onAddChannel}
          onRemoveChannel={(id) => setLists((l) => removeChannel(l, id))}
          onImportChannels={() => void onImportChannels()}
          isFavorite={(url) => isFavorite(lists, url)}
          onToggleFavoriteUrl={onToggleFavoriteUrl}
          onPick={onPickItem}
          onDragOver={setListOver}
          onDrop={onDropItem}
          cellAt={cellAt}
        />
      )}
    </div>
  )
}
