// 設定檔的資料結構與驗證（R10）。主程序與畫面共用，不依賴 Electron。
import { DEFAULT_LAYOUT, isValidRatios, LAYOUT_IDS, type LayoutId, type Ratios } from './layout'
import { isYouTubeSite, parseSource } from './source'
import { SLOT_COUNT, type Quality } from './slots'
import { normalizeQuality } from './quality'
import { BRIGHTNESS_DEFAULT, normalizeBrightness } from './brightness'
import { DEFAULT_COMPANION, normalizeCompanion, type CompanionWindowState } from './companion'
import { DEFAULT_METHODS, normalizeMethods, type YouTubeMethods } from './ytdlp'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  alwaysOnTop: boolean
}

export interface SavedSource {
  url: string
  muted: boolean
  volume: number
  /** 廣告阻擋（R17）；舊的設定檔沒有這個欄位時視為開啟 */
  adblock: boolean
  /** 畫質（R24）；舊的設定檔沒有這個欄位時視為自動 */
  quality: Quality
  /** 字幕的選擇（R31）；舊的設定檔沒有這個欄位時視為關閉 */
  captions: string | null
  /** 亮度（R40）；舊的設定檔沒有這個欄位時視為 100 */
  brightness: number
  /** 改用 YouTube 網頁播放（R48）；舊的設定檔沒有這個欄位時視為否 */
  youtubeWeb: boolean
  /** 觀看進度（秒，R55）；舊的設定檔沒有這個欄位時從頭開始 */
  position: number | null
  /** yt-dlp 播放時記住的語音語言（R95）；舊的設定檔沒有時為自動 */
  audioLang: string | null
  /** 從 YouTube 網站開啟時的來源頁面（R63）；舊的設定檔沒有時沒有「回到」 */
  backUrl: string | null
  /** YouTube 網頁模式的廣告阻擋（R70）；舊的設定檔沒有時視為開啟 */
  pageAdblock: boolean
}

/** 畫面這一側的設定，由畫面送給主程序保存 */
export interface ViewSettings {
  layout: LayoutId
  ratios: Partial<Record<LayoutId, Ratios>>
  slots: (SavedSource | null)[]
  /** 總亮度（R41）；舊的設定檔沒有這個欄位時視為 100 */
  brightness: number
  /** YouTube 無法嵌入時自動改用網頁播放（R49）；舊的設定檔沒有這個欄位時視為否 */
  autoYoutubeWeb: boolean
  /** YouTube 直播、一般影片的播放方式（R88）；舊的設定檔沒有這個欄位時都是內嵌播放器 */
  youtubeMethods: YouTubeMethods
  /** 清單面板上次的那一邊和分頁（R58）；舊的設定檔視為 YouTube 的最愛 */
  listTab: { group: 'youtube' | 'other'; tab: 'subscriptions' | 'favorites' | 'history' }
}

export interface Settings extends ViewSettings {
  version: 1
  window: WindowState
  /** YouTube 小視窗的位置、大小與上次的分頁（R78）；舊的設定檔沒有時用預設值 */
  companion: CompanionWindowState
}

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 720, alwaysOnTop: false }

export function defaultSettings(): Settings {
  return {
    version: 1,
    window: { ...DEFAULT_WINDOW },
    companion: { ...DEFAULT_COMPANION },
    layout: DEFAULT_LAYOUT,
    ratios: {},
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    brightness: BRIGHTNESS_DEFAULT,
    autoYoutubeWeb: false,
    youtubeMethods: { ...DEFAULT_METHODS },
    listTab: DEFAULT_LIST_TAB
  }
}

const DEFAULT_LIST_TAB: ViewSettings['listTab'] = { group: 'youtube', tab: 'favorites' }

function normalizeListTab(raw: unknown): ViewSettings['listTab'] {
  if (!isObject(raw)) return DEFAULT_LIST_TAB
  const group = raw.group === 'other' ? 'other' : raw.group === 'youtube' ? 'youtube' : null
  // 訂閱只在 YouTube 那一邊（R59）
  const tab =
    raw.tab === 'favorites' || raw.tab === 'history' || (raw.tab === 'subscriptions' && group === 'youtube') ? raw.tab : null
  return group && tab ? { group, tab } : DEFAULT_LIST_TAB
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function normalizeWindow(raw: unknown): WindowState {
  if (!isObject(raw)) return { ...DEFAULT_WINDOW }
  const win: WindowState = {
    width: isFiniteNumber(raw.width) && raw.width > 0 ? raw.width : DEFAULT_WINDOW.width,
    height: isFiniteNumber(raw.height) && raw.height > 0 ? raw.height : DEFAULT_WINDOW.height,
    alwaysOnTop: raw.alwaysOnTop === true
  }
  if (isFiniteNumber(raw.x) && isFiniteNumber(raw.y)) {
    win.x = raw.x
    win.y = raw.y
  }
  return win
}

function normalizeRatios(raw: unknown): Partial<Record<LayoutId, Ratios>> {
  const out: Partial<Record<LayoutId, Ratios>> = {}
  if (!isObject(raw)) return out
  for (const id of LAYOUT_IDS) {
    const r = raw[id]
    if (isValidRatios(id, r)) out[id] = { cols: [...r.cols], rows: [...r.rows] }
  }
  return out
}

function normalizeSource(raw: unknown): SavedSource | null {
  if (!isObject(raw) || typeof raw.url !== 'string' || !parseSource(raw.url)) return null
  const volume = isFiniteNumber(raw.volume) ? Math.round(Math.min(Math.max(raw.volume, 0), 100)) : 100
  return {
    url: raw.url,
    muted: raw.muted === true,
    volume,
    adblock: raw.adblock !== false,
    quality: normalizeQuality(raw.quality),
    captions: typeof raw.captions === 'string' && raw.captions ? raw.captions : null,
    audioLang: typeof raw.audioLang === 'string' && raw.audioLang ? raw.audioLang : null,
    brightness: normalizeBrightness(raw.brightness),
    youtubeWeb: raw.youtubeWeb === true,
    position: isFiniteNumber(raw.position) && raw.position > 0 ? raw.position : null,
    backUrl: typeof raw.backUrl === 'string' && isYouTubeSite(raw.backUrl) ? raw.backUrl : null,
    pageAdblock: raw.pageAdblock !== false
  }
}

function normalizeSlots(raw: unknown): (SavedSource | null)[] {
  const list = Array.isArray(raw) ? raw : []
  return Array.from({ length: SLOT_COUNT }, (_, i) => normalizeSource(list[i]))
}

/** 只接受合法的版型、比例與來源；其餘換成預設值。 */
export function normalizeView(raw: unknown): ViewSettings {
  const obj = isObject(raw) ? raw : {}
  return {
    layout: LAYOUT_IDS.includes(obj.layout as LayoutId) ? (obj.layout as LayoutId) : DEFAULT_LAYOUT,
    ratios: normalizeRatios(obj.ratios),
    slots: normalizeSlots(obj.slots),
    brightness: normalizeBrightness(obj.brightness),
    autoYoutubeWeb: obj.autoYoutubeWeb === true,
    youtubeMethods: normalizeMethods(obj.youtubeMethods),
    listTab: normalizeListTab(obj.listTab)
  }
}

/** 把讀到的 JSON 轉成合法設定；整體結構不對時回傳 null（視為損毀）。個別欄位不合法時改用預設值。 */
export function normalizeSettings(raw: unknown): Settings | null {
  if (!isObject(raw) || raw.version !== 1) return null
  return { version: 1, window: normalizeWindow(raw.window), companion: normalizeCompanion(raw.companion), ...normalizeView(raw) }
}

/** 解析設定檔內容。JSON 錯誤或結構不對時 corrupt 為 true，settings 為預設值。 */
export function parseSettings(text: string): { settings: Settings; corrupt: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { settings: defaultSettings(), corrupt: true }
  }
  const settings = normalizeSettings(raw)
  return settings ? { settings, corrupt: false } : { settings: defaultSettings(), corrupt: true }
}
