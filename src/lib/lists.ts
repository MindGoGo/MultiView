// 最愛清單與歷史紀錄（R21–R23）。主程序與畫面共用，不依賴 Electron。
import { parseSource } from './source'

export interface ListItem {
  url: string
  name: string
  /** 最愛：加入的時間；歷史：最後播放的時間（毫秒） */
  time: number
}

export interface Lists {
  favorites: ListItem[]
  history: ListItem[]
}

export type ListKind = keyof Lists

/** 歷史最多保留的筆數（R23） */
export const HISTORY_MAX = 200

export const LIST_ERROR = {
  unsupported: '不支援的網址',
  duplicate: '清單中已經有這個網址'
} as const

export type ListResult = { lists: Lists } | { error: string }

export const emptyLists = (): Lists => ({ favorites: [], history: [] })

/** 以去掉前後空白後的完整網址比對（共用定義「網址比對」） */
export const sameUrl = (a: string, b: string) => a.trim() === b.trim()

/** 影片名稱（共用定義）：標題 → mp4 / m3u8 的檔名 → 網址 */
export function defaultName(url: string, title?: string | null): string {
  const t = title?.trim()
  if (t) return t
  const parsed = parseSource(url)
  if (parsed && (parsed.kind === 'mp4' || parsed.kind === 'hls')) {
    const file = decodeURIComponent(new URL(parsed.url).pathname.split('/').pop() ?? '')
    if (file) return file
  }
  return url.trim()
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function normalizeItems(raw: unknown, max = Infinity): ListItem[] {
  if (!Array.isArray(raw)) return []
  const out: ListItem[] = []
  for (const r of raw) {
    if (!isObject(r) || typeof r.url !== 'string' || !parseSource(r.url)) continue
    if (out.some((i) => sameUrl(i.url, r.url as string))) continue
    const url = r.url.trim()
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : url
    const time = typeof r.time === 'number' && Number.isFinite(r.time) ? r.time : 0
    out.push({ url, name, time })
    if (out.length >= max) break
  }
  return out
}

/** 只留下合法的項目（網址必須支援、不重複）；歷史最多 200 筆 */
export function normalizeLists(raw: unknown): Lists {
  const obj = isObject(raw) ? raw : {}
  return { favorites: normalizeItems(obj.favorites), history: normalizeItems(obj.history, HISTORY_MAX) }
}

/** 讀取清單檔；JSON 格式錯誤或整體結構不對時視為損毀（R21 AC11） */
export function parseLists(text: string): { lists: Lists; corrupt: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { lists: emptyLists(), corrupt: true }
  }
  if (!isObject(raw)) return { lists: emptyLists(), corrupt: true }
  return { lists: normalizeLists(raw), corrupt: false }
}

/** 驗證網址與名稱；except 是編輯中的那一筆（不和自己比重複） */
function validate(items: ListItem[], url: string, name: string, except = -1): { item: Omit<ListItem, 'time'> } | { error: string } {
  const u = url.trim()
  if (!parseSource(u)) return { error: LIST_ERROR.unsupported }
  if (items.some((i, k) => k !== except && sameUrl(i.url, u))) return { error: LIST_ERROR.duplicate }
  // 名稱清空時用網址當名稱（R21）
  return { item: { url: u, name: name.trim() || u } }
}

/** 加入最愛，排在最上面（R22） */
export function addFavorite(lists: Lists, url: string, name: string, now: number): ListResult {
  const v = validate(lists.favorites, url, name)
  if ('error' in v) return v
  return { lists: { ...lists, favorites: [{ ...v.item, time: now }, ...lists.favorites] } }
}

export function isFavorite(lists: Lists, url: string): boolean {
  return lists.favorites.some((i) => sameUrl(i.url, url))
}

export function removeFavorite(lists: Lists, url: string): Lists {
  return { ...lists, favorites: lists.favorites.filter((i) => !sameUrl(i.url, url)) }
}

/** 編輯一筆的名稱和網址（R21） */
export function editItem(lists: Lists, kind: ListKind, index: number, url: string, name: string): ListResult {
  const items = lists[kind]
  if (!items[index]) return { lists }
  const v = validate(items, url, name, index)
  if ('error' in v) return v
  const next = items.map((i, k) => (k === index ? { ...i, ...v.item } : i))
  return { lists: { ...lists, [kind]: next } }
}

export function deleteItem(lists: Lists, kind: ListKind, index: number): Lists {
  return { ...lists, [kind]: lists[kind].filter((_, k) => k !== index) }
}

/**
 * 記錄一次播放（R23）：同一個網址只留一筆，移到最上面並更新時間，名稱維持原本的；
 * 超過 200 筆時刪掉最舊的。
 */
export function recordHistory(lists: Lists, url: string, title: string | null | undefined, now: number): Lists {
  const u = url.trim()
  const existing = lists.history.find((i) => sameUrl(i.url, u))
  const item: ListItem = existing ? { ...existing, time: now } : { url: u, name: defaultName(u, title), time: now }
  const rest = lists.history.filter((i) => !sameUrl(i.url, u))
  return { ...lists, history: [item, ...rest].slice(0, HISTORY_MAX) }
}

export function clearHistory(lists: Lists): Lists {
  return { ...lists, history: [] }
}

/** 歷史的最後播放時間：`YYYY/MM/DD HH:mm`（R23） */
export function formatListTime(time: number): string {
  const d = new Date(time)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
