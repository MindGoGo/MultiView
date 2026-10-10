// YouTube 訂閱（R59–R61）：頻道網址辨識、頻道資訊、頻道摘要的解析。不依賴 DOM 與 Electron，方便測試。
import { parseSource } from './source'

/** 訂閱的頻道（R59） */
export interface Channel {
  /** 頻道代碼：UC 開頭的 24 個字元 */
  id: string
  name: string
  /** 頻道頁網址 */
  url: string
  /** 加入的時間（毫秒） */
  time: number
}

/** 頻道摘要裡的一部影片（R59） */
export interface FeedVideo {
  videoId: string
  title: string
  /** 發布時間（毫秒） */
  published: number
}

const CHANNEL_ID = /^UC[\w-]{22}$/

export const isChannelId = (id: unknown): id is string => typeof id === 'string' && CHANNEL_ID.test(id)

export const channelPageUrl = (id: string) => `https://www.youtube.com/channel/${id}`
export const channelFeedUrl = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
export const channelLiveUrl = (id: string) => `https://www.youtube.com/channel/${id}/live`

/**
 * 加入頻道時貼上的網址（R59）：頻道頁（/@帳號、/channel/UC…、/c/…、/user/…）或影片網址。
 * 回傳要讀取的網頁網址；不是頻道或影片時回傳 null。
 */
export function channelLookupUrl(input: string): { page: string; kind: 'channel' | 'video' } | null {
  const parsed = parseSource(input)
  if (!parsed) return null
  if (parsed.kind === 'youtube') return { page: `https://www.youtube.com/watch?v=${parsed.videoId}`, kind: 'video' }
  if (parsed.kind !== 'web') return null
  const url = new URL(parsed.url)
  const host = url.hostname.toLowerCase()
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null
  const [first, second] = url.pathname.split('/').filter(Boolean)
  if (!first) return null
  if (first.startsWith('@')) return { page: `https://www.youtube.com/${first}`, kind: 'channel' }
  if (first === 'channel' && isChannelId(second)) return { page: channelPageUrl(second), kind: 'channel' }
  if ((first === 'c' || first === 'user') && second) return { page: `https://www.youtube.com/${first}/${second}`, kind: 'channel' }
  return null
}

/** 解碼 HTML／XML 的字元參照 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** JSON 字串內容的跳脫字元（例如 &、\"） */
function decodeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

/** 從頻道頁或影片頁的 HTML 取出頻道代碼與名稱；取不到時回傳 null */
export function extractChannelInfo(html: string, kind: 'channel' | 'video'): { id: string; name: string } | null {
  if (kind === 'video') {
    const id = html.match(/"channelId":"(UC[\w-]{22})"/)?.[1]
    const name = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)?.[1] ?? html.match(/"author":"((?:[^"\\]|\\.)*)"/)?.[1]
    return id && name ? { id, name: decodeJsonString(name) } : null
  }
  const id =
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1]
  const name = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]
  return id && name ? { id, name: decodeEntities(name) } : null
}

/** 解析頻道摘要（Atom XML），新的在上面；格式不對時回傳 null */
export function parseFeed(xml: string): FeedVideo[] | null {
  if (!xml.includes('<feed')) return null
  const videos: FeedVideo[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1]
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1]
    const published = Date.parse(entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? '')
    if (videoId && title !== undefined && Number.isFinite(published))
      videos.push({ videoId, title: decodeEntities(title), published })
  }
  return videos.sort((a, b) => b.published - a.published)
}

/** 名稱旁顯示的新影片：24 小時內發布的（R59） */
export const NEW_VIDEO_MS = 24 * 3600 * 1000

export function countNew(videos: FeedVideo[], now: number): number {
  return videos.filter((v) => now - v.published < NEW_VIDEO_MS).length
}

/** 發布時間的簡短說明，例如「3 小時前」「2 天前」 */
export function formatAgo(published: number, now: number): string {
  const min = Math.max(0, Math.floor((now - published) / 60000))
  if (min < 60) return `${Math.max(min, 1)} 分鐘前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小時前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo} 個月前` : `${Math.floor(mo / 12)} 年前`
}
