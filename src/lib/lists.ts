// 最愛清單與歷史紀錄（R21–R23）。主程序與畫面共用，不依賴 Electron。
import { isYouTubeSite, parseSource } from './source'
import { isChannelId, type Channel } from './youtubeFeed'

export interface ListItem {
  url: string
  name: string
  /** 最愛：加入的時間；歷史：最後播放的時間（毫秒） */
  time: number
}

export interface Lists {
  favorites: ListItem[]
  history: ListItem[]
  /** 訂閱的 YouTube 頻道（R59） */
  channels: Channel[]
}

export type ListKind = 'favorites' | 'history'

/** 清單的兩邊（R58）：YouTube 影片與 YouTube 網站頁面、其他網站 */
export type ListGroup = 'youtube' | 'other'

export function groupOf(url: string): ListGroup {
  const parsed = parseSource(url)
  return parsed?.kind === 'youtube' || isYouTubeSite(url) ? 'youtube' : 'other'
}

/** 歷史最多保留的筆數（R23）；YouTube 和其他網站各自計算（R58） */
export const HISTORY_MAX = 200

/** 每一邊只保留最新的 max 筆（清單已依時間由新到舊排列） */
function capPerGroup(items: ListItem[], max: number): ListItem[] {
  const count: Record<ListGroup, number> = { youtube: 0, other: 0 }
  return items.filter((i) => ++count[groupOf(i.url)] <= max)
}

export const LIST_ERROR = {
  unsupported: '不支援的網址',
  duplicate: '清單中已經有這個網址'
} as const

export type ListResult = { lists: Lists } | { error: string }

export const emptyLists = (): Lists => ({ favorites: [], history: [], channels: [] })

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
  return {
    favorites: normalizeItems(obj.favorites),
    history: capPerGroup(normalizeItems(obj.history), HISTORY_MAX),
    channels: normalizeChannels(obj.channels)
  }
}

/** 只留下合法、不重複的頻道（舊的清單檔沒有訂閱時為空） */
function normalizeChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return []
  const out: Channel[] = []
  for (const r of raw) {
    if (!isObject(r) || !isChannelId(r.id) || out.some((c) => c.id === r.id)) continue
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.id
    const url = typeof r.url === 'string' && r.url ? r.url : `https://www.youtube.com/channel/${r.id}`
    const time = typeof r.time === 'number' && Number.isFinite(r.time) ? r.time : 0
    out.push({ id: r.id, name, url, time })
  }
  return out
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
  return { ...lists, history: capPerGroup([item, ...rest], HISTORY_MAX) }
}

/** 清除一邊的歷史（R58 AC3） */
export function clearHistory(lists: Lists, group: ListGroup): Lists {
  return { ...lists, history: lists.history.filter((i) => groupOf(i.url) !== group) }
}

export const CHANNEL_ERROR = {
  duplicate: '已經訂閱這個頻道',
  notFound: '找不到這個頻道'
} as const

/** 訂閱頻道（R59） */
export function addChannel(lists: Lists, channel: Omit<Channel, 'time'>, now: number): ListResult {
  if (lists.channels.some((c) => c.id === channel.id)) return { error: CHANNEL_ERROR.duplicate }
  return { lists: { ...lists, channels: [...lists.channels, { ...channel, time: now }] } }
}

export function removeChannel(lists: Lists, id: string): Lists {
  return { ...lists, channels: lists.channels.filter((c) => c.id !== id) }
}

/** 歷史的最後播放時間：`YYYY/MM/DD HH:mm`（R23） */
export function formatListTime(time: number): string {
  const d = new Date(time)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
