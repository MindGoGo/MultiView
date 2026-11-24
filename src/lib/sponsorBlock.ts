/*
 * SponsorBlock（R161）：跳過社群標記的業配等片段，只用在 yt-dlp 播放的 YouTube 一般影片。
 * 資料來自 SponsorBlock（https://sponsor.ajay.app），授權 CC BY-NC-SA 4.0。
 * 這個檔案只有規則，不連網路、不碰畫面；和手機版（`Phone` 分支 android/core 的 SponsorBlock.kt）的規則與測試相同。
 * 影片 ID 的雜湊在主程序算（electron/sponsorBlock.ts），這裡只組網址。
 */

/** 片段的類別。代碼是 API 與設定檔用的；顏色和 SponsorBlock 官方擴充功能的預設顏色相同。 */
export const SPONSOR_CATEGORIES = [
  { id: 'sponsor', label: '業配', color: '#00D400' },
  { id: 'selfpromo', label: '自我宣傳', color: '#FFFF00' },
  { id: 'interaction', label: '訂閱提醒', color: '#CC00FF' },
  { id: 'intro', label: '開場', color: '#00FFFF' },
  { id: 'outro', label: '片尾', color: '#0202ED' },
  { id: 'preview', label: '預告與回顧', color: '#008FD6' },
  { id: 'filler', label: '離題閒聊', color: '#7300FF' },
  { id: 'music_offtopic', label: '音樂影片的非音樂部分', color: '#FF9900' }
] as const

/** poi_highlight（精華時間點）不是要跳過的片段，第一版不列出。 */
export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number]['id']

const CATEGORY_IDS: readonly SponsorCategory[] = SPONSOR_CATEGORIES.map((c) => c.id)

export const isSponsorCategory = (v: unknown): v is SponsorCategory =>
  typeof v === 'string' && (CATEGORY_IDS as readonly string[]).includes(v)

export const categoryInfo = (c: SponsorCategory) => SPONSOR_CATEGORIES.find((x) => x.id === c)!

/** 一個要跳過的片段：start、end 是秒數；id 是 SponsorBlock 的 UUID（合併的片段用第一個的）。 */
export interface SponsorSegment {
  start: number
  end: number
  category: SponsorCategory
  id: string
}

/** 設定（預設開啟，只跳過業配）。 */
export interface SponsorBlockSettings {
  enabled: boolean
  categories: SponsorCategory[]
}

export const DEFAULT_SPONSOR_BLOCK: SponsorBlockSettings = { enabled: true, categories: ['sponsor'] }

/** 要不要跳過任何片段（關閉或一個類別都沒勾時不連 API）。 */
export const sponsorActive = (s: SponsorBlockSettings) => s.enabled && s.categories.length > 0

/** 自動跳過：跳到 target 秒（片段結尾；片段結尾在影片最後 1 秒內時是影片長度，視為播完）。 */
export interface SkipAction {
  segment: SponsorSegment
  target: number
}

/** 每一格各自的跳過狀態：已經處理過的片段（自動跳過過、使用者取消、使用者自己跳進去的）不再自動跳過。 */
export type SkipState = ReadonlySet<string>

export const markHandled = (state: SkipState, segment: SponsorSegment): SkipState => new Set([...state, segment.id])

/**
 * 使用者自己跳轉（拖曳進度條、← →、從上次的進度開始）到 time：
 * 落在片段裡面時，這個片段當作處理過，不會馬上又被跳走。
 */
export function userSeeked(state: SkipState, segments: readonly SponsorSegment[], time: number): SkipState {
  const inside = segments.filter((s) => time >= s.start && time < s.end).map((s) => s.id)
  return inside.length === 0 ? state : new Set([...state, ...inside])
}

/** 進度條上的一個色塊：start、end 是 0–1 的比例。 */
export interface SegmentMark {
  start: number
  end: number
  category: SponsorCategory
}

export const SPONSOR_API_BASE = 'https://sponsor.ajay.app/api/skipSegments/'
/** 請求逾時（毫秒）。逾時或失敗當作沒有片段，不影響播放。 */
export const SPONSOR_TIMEOUT_MS = 5000
/** 比這個短（秒）的片段忽略。 */
export const MIN_SEGMENT_SECONDS = 1
/** 片段結尾在影片最後這幾秒內時，跳到影片結尾（視為播完）。 */
export const END_MARGIN_SECONDS = 1
/** 播放位置離片段結尾不到這幾秒時不跳。 */
export const MIN_REMAINING_SECONDS = 0.3
/** 檢查播放位置的間隔（毫秒）。 */
export const CHECK_INTERVAL_MS = 250
/** 跳過提示顯示多久（毫秒）。 */
export const NOTICE_MS = 5000

/**
 * 請求網址：`<API_BASE><雜湊前綴>?categories=[...]`（JSON 陣列，網址編碼）。
 * 一律要全部的類別（只有幾 KB），在本機依設定過濾：改設定時不用重新抓。
 */
export function sponsorRequestUrl(hashPrefix: string, categories: readonly SponsorCategory[] = CATEGORY_IDS): string {
  const list = CATEGORY_IDS.filter((c) => categories.includes(c))
    .map((c) => `%22${c}%22`)
    .join('%2C')
  return `${SPONSOR_API_BASE}${hashPrefix}?categories=%5B${list}%5D`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 解析 API 的回應（HTTP 200 的內容；404 代表沒有片段，直接當作空的）：
 * 只取 videoID 相同的；只要 actionType 是 skip（沒有這個欄位也當作 skip）、起訖合理、類別認得的片段。
 * 格式不對時回傳空的。順序照 API，還沒過濾、合併（見 selectSegments）。
 */
export function parseSegments(text: string, videoId: string): SponsorSegment[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: SponsorSegment[] = []
  for (const video of raw) {
    if (!isObject(video) || video.videoID !== videoId || !Array.isArray(video.segments)) continue
    for (const item of video.segments) {
      if (!isObject(item)) continue
      const action = typeof item.actionType === 'string' ? item.actionType : 'skip'
      if (action !== 'skip' || !isSponsorCategory(item.category) || !Array.isArray(item.segment)) continue
      const [start, end] = item.segment
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) continue
      if (end <= start) continue
      const id = typeof item.UUID === 'string' && item.UUID ? item.UUID : `${item.category}@${start}`
      out.push({ start: Math.max(start, 0), end, category: item.category, id })
    }
  }
  return out
}

/**
 * 依設定挑出要跳過的片段：只留勾選的類別、忽略太短的，依開始時間排序，重疊或相接的合併成一段
 * （合併後的類別與 id 用最早開始的那一段）。關閉時回傳空的。
 */
export function selectSegments(segments: readonly SponsorSegment[], settings: SponsorBlockSettings): SponsorSegment[] {
  if (!sponsorActive(settings)) return []
  const sorted = segments
    .filter((s) => settings.categories.includes(s.category) && s.end - s.start >= MIN_SEGMENT_SECONDS)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: SponsorSegment[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) {
      if (s.end > last.end) merged[merged.length - 1] = { ...last, end: s.end }
    } else {
      merged.push({ ...s })
    }
  }
  return merged
}

/**
 * 定時檢查：播放位置 time 在還沒處理過的片段裡面時，回傳要跳到哪裡；不用跳時回傳 null。
 * duration 是影片長度（秒；不知道時傳 NaN）。跳過之後由呼叫的一方把片段標成處理過。
 */
export function checkSkip(
  segments: readonly SponsorSegment[],
  state: SkipState,
  time: number,
  duration: number
): SkipAction | null {
  if (!Number.isFinite(time)) return null
  const segment = segments.find((s) => !state.has(s.id) && time >= s.start && time < s.end - MIN_REMAINING_SECONDS)
  if (!segment) return null
  const known = Number.isFinite(duration) && duration > 0
  const target = known && segment.end >= duration - END_MARGIN_SECONDS ? duration : segment.end
  return { segment, target }
}

/** 跳過提示的文字，例如「已跳過業配」。 */
export const skippedLabel = (c: SponsorCategory) => `已跳過${categoryInfo(c).label}`

/** 這個時間在哪一個片段裡（進度條預覽顯示類別用）；不在任何片段裡時回傳 null。 */
export const segmentAt = (segments: readonly SponsorSegment[], time: number) =>
  segments.find((s) => time >= s.start && time < s.end) ?? null

/** 進度條色塊的比例位置；影片長度不知道時沒有色塊。超出影片長度的部分截掉。 */
export function segmentMarks(segments: readonly SponsorSegment[], duration: number): SegmentMark[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1)
  return segments.flatMap((s) => {
    const start = clamp(s.start / duration)
    const end = clamp(s.end / duration)
    return end > start ? [{ start, end, category: s.category }] : []
  })
}

/**
 * 讀設定（settings.json 的 sponsorBlock 欄位，和手機版相同的格式）：
 * 沒有這個欄位或格式不對時用預設值；enabled 不是布林值時用預設值；不認得的類別忽略；空的陣列保留。
 * 類別依定義的順序。
 */
export function normalizeSponsorBlock(raw: unknown): SponsorBlockSettings {
  if (!isObject(raw)) return { ...DEFAULT_SPONSOR_BLOCK, categories: [...DEFAULT_SPONSOR_BLOCK.categories] }
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SPONSOR_BLOCK.enabled
  const categories = Array.isArray(raw.categories)
    ? CATEGORY_IDS.filter((c) => (raw.categories as unknown[]).includes(c))
    : [...DEFAULT_SPONSOR_BLOCK.categories]
  return { enabled, categories }
}
