// YouTube 小視窗（R78–R82）。主程序、主畫面、小視窗共用，不依賴 Electron。
import { parseSource } from './source'

export type CompanionTab = 'related' | 'comments' | 'chat' | 'search'
export const COMPANION_TABS: CompanionTab[] = ['related', 'comments', 'chat', 'search']
export const COMPANION_TAB_LABELS: Record<CompanionTab, string> = {
  related: '推薦',
  comments: '留言',
  chat: '聊天室',
  search: '搜尋'
}
/** 第一次開啟時的分頁（R78） */
export const DEFAULT_COMPANION_TAB: CompanionTab = 'search'

export const isCompanionTab = (v: unknown): v is CompanionTab => COMPANION_TABS.includes(v as CompanionTab)

/** 小視窗的位置、大小與上次的分頁（R78），保存在設定檔 */
export interface CompanionWindowState {
  x?: number
  y?: number
  width: number
  height: number
  tab: CompanionTab
}

export const COMPANION_MIN_WIDTH = 360
export const COMPANION_MIN_HEIGHT = 400
export const DEFAULT_COMPANION: CompanionWindowState = { width: 480, height: 760, tab: DEFAULT_COMPANION_TAB }

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function normalizeCompanion(raw: unknown): CompanionWindowState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_COMPANION }
  const r = raw as Record<string, unknown>
  const out: CompanionWindowState = {
    width: isFiniteNumber(r.width) && r.width > 0 ? r.width : DEFAULT_COMPANION.width,
    height: isFiniteNumber(r.height) && r.height > 0 ? r.height : DEFAULT_COMPANION.height,
    tab: isCompanionTab(r.tab) ? r.tab : DEFAULT_COMPANION_TAB
  }
  if (isFiniteNumber(r.x) && isFiniteNumber(r.y)) {
    out.x = r.x
    out.y = r.y
  }
  return out
}

/** 連結的格子目前的 YouTube 影片（R78）；cell 是畫面上的格子編號（從 1 開始） */
export interface CompanionVideo {
  id: string
  title: string | null
  /** 播放器回報的直播（R81） */
  live: boolean
}
export interface CompanionLink {
  cell: number | null
  video: CompanionVideo | null
}

/** 小視窗交給主畫面的操作 */
export type CompanionAction =
  /** 連結的格子換成這部影片（和「更換網址」相同，R79、R80） */
  | { type: 'play'; url: string }
  /** 連結的格子跳到這個時間（R80） */
  | { type: 'seek'; seconds: number }
  /** 依「放入格子的規則」放進格子（R82） */
  | { type: 'place'; url: string }

export const watchPageUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`
/** YouTube 的彈出式聊天室（R81） */
export const liveChatUrl = (videoId: string) => `https://www.youtube.com/live_chat?v=${videoId}`
/** 手機版 YouTube（R82） */
export const MOBILE_YOUTUBE_HOME = 'https://m.youtube.com/'
export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'

/** YouTube 連結的 t 參數（例如 195、195s、3m15s、1h2m3s）換成秒數；不是時間時回傳 null */
export function parseYouTubeTime(raw: string | null): number | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (/^\d+s?$/.test(s)) return parseInt(s, 10)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/**
 * 推薦、留言分頁裡點了 YouTube 影片連結（R79、R80）：同一部影片帶時間 → 跳到那個時間；
 * 同一部影片不帶時間 → 不做事；其他影片 → 連結的格子換成那部影片。
 */
export function companionLinkAction(href: string, currentVideoId: string | null): CompanionAction | null {
  const parsed = parseSource(href)
  if (parsed?.kind !== 'youtube') return null
  if (parsed.videoId === currentVideoId) {
    let t: string | null = null
    try {
      t = new URL(href).searchParams.get('t')
    } catch {
      return null
    }
    const seconds = parseYouTubeTime(t)
    return seconds === null ? null : { type: 'seek', seconds }
  }
  return { type: 'play', url: watchPageUrl(parsed.videoId) }
}

/** 小視窗上方「第 N 格：影片名稱」（R78） */
export function companionHeader(link: CompanionLink): string {
  if (link.cell === null) return '請從格子的「YouTube ▾」選擇要顯示的格子'
  if (!link.video) return `第 ${link.cell} 格`
  return `第 ${link.cell} 格：${link.video.title ?? '（讀取中）'}`
}

/** 網頁標題去掉結尾的「 - YouTube」 */
export const stripYouTubeSuffix = (title: string | null) => (title ? title.replace(/ - YouTube$/, '') : title)
