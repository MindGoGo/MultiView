// 廣告阻擋的判斷規則（R17）。不依賴 Electron，方便測試。

const YOUTUBE_FRAME_DOMAINS = ['youtube.com', 'youtube-nocookie.com']

/** 網頁中內嵌的 YouTube 播放器框架不阻擋，維持第一版的合規要求（R17） */
export function isYouTubeFrame(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return YOUTUBE_FRAME_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
}

/** Electron 的請求類型 → 廣告清單使用的請求類型 */
const TYPE_MAP: Record<string, string> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xhr',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
}

export function toFilterType(resourceType: string): string {
  return TYPE_MAP[resourceType] ?? 'other'
}

export interface RequestInfo {
  /** 發出請求的網頁；不是網頁發出的（例如瀏覽器本身）時為 undefined */
  webContentsId: number | undefined
  resourceType: string
  /** 發出請求的框架網址 */
  frameUrl: string | null | undefined
  /** 發出請求的框架所屬的最上層框架網址（R73）；不知道時為 undefined */
  topUrl?: string | null
}

/**
 * 不阻擋的 YouTube 框架（第二版 R17 AC4、R73）：其他網站裡內嵌的 YouTube 播放器。
 * 整個格子就是 YouTube 網頁時（網頁播放、逛 YouTube、網頁模式），依格子的廣告阻擋開關阻擋。
 */
export function isEmbeddedYouTube(frameUrl: string | null | undefined, topUrl: string | null | undefined): boolean {
  return isYouTubeFrame(frameUrl) && !isYouTubeFrame(topUrl)
}

/**
 * 這個請求要不要拿去比對廣告清單。
 * 不比對：不是網頁發出的、網頁本身（使用者輸入的網址）、關閉廣告阻擋的格子、其他網站裡內嵌的 YouTube 播放器。
 */
export function shouldCheck(req: RequestInfo, disabled: ReadonlySet<number>): boolean {
  if (req.webContentsId === undefined) return false
  if (req.resourceType === 'mainFrame') return false
  if (disabled.has(req.webContentsId)) return false
  return !isEmbeddedYouTube(req.frameUrl, req.topUrl)
}
