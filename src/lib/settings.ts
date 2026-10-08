// 設定檔的資料結構與驗證（R10）。主程序與畫面共用，不依賴 Electron。

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  alwaysOnTop: boolean
}

export interface Settings {
  version: 1
  window: WindowState
}

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 720, alwaysOnTop: false }

export function defaultSettings(): Settings {
  return { version: 1, window: { ...DEFAULT_WINDOW } }
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

/** 把讀到的 JSON 轉成合法設定；整體結構不對時回傳 null（視為損毀）。個別欄位不合法時改用預設值。 */
export function normalizeSettings(raw: unknown): Settings | null {
  if (!isObject(raw) || raw.version !== 1) return null
  return { version: 1, window: normalizeWindow(raw.window) }
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
