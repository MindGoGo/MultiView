// 設定檔的資料結構與驗證（R10）。主程序與畫面共用，不依賴 Electron。
import { DEFAULT_LAYOUT, isValidRatios, LAYOUT_IDS, type LayoutId, type Ratios } from './layout'
import { parseSource } from './source'
import { SLOT_COUNT } from './slots'

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
}

/** 畫面這一側的設定，由畫面送給主程序保存 */
export interface ViewSettings {
  layout: LayoutId
  ratios: Partial<Record<LayoutId, Ratios>>
  slots: (SavedSource | null)[]
}

export interface Settings extends ViewSettings {
  version: 1
  window: WindowState
}

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 720, alwaysOnTop: false }

export function defaultSettings(): Settings {
  return {
    version: 1,
    window: { ...DEFAULT_WINDOW },
    layout: DEFAULT_LAYOUT,
    ratios: {},
    slots: Array.from({ length: SLOT_COUNT }, () => null)
  }
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
  return { url: raw.url, muted: raw.muted === true, volume, adblock: raw.adblock !== false }
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
    slots: normalizeSlots(obj.slots)
  }
}

/** 把讀到的 JSON 轉成合法設定；整體結構不對時回傳 null（視為損毀）。個別欄位不合法時改用預設值。 */
export function normalizeSettings(raw: unknown): Settings | null {
  if (!isObject(raw) || raw.version !== 1) return null
  return { version: 1, window: normalizeWindow(raw.window), ...normalizeView(raw) }
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
