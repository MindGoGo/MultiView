// 網址解析與分類（R2、R12）

export type ParsedSource =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'hls'; url: string }
  | { kind: 'mp4'; url: string }
  | { kind: 'web'; url: string }

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (host === 'youtu.be') {
    id = segments.length === 1 ? segments[0] : null
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') id = url.searchParams.get('v')
    else if (segments.length === 2 && (segments[0] === 'live' || segments[0] === 'embed'))
      id = segments[1]
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** youtube.com、youtu.be 和它們的子網域 */
function isYouTubeDomain(host: string): boolean {
  return ['youtube.com', 'youtu.be'].some((d) => host === d || host.endsWith('.' + d))
}

/** 解析使用者輸入的網址；不支援時回傳 null。 */
export function parseSource(input: string): ParsedSource | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const videoId = youtubeId(url)
  if (videoId) return { kind: 'youtube', videoId }

  const pathname = url.pathname.toLowerCase()
  if (pathname.endsWith('.m3u8')) return { kind: 'hls', url: url.href }
  if (pathname.endsWith('.mp4')) return { kind: 'mp4', url: url.href }
  // YouTube 網域但格式不支援的（Shorts、播放清單頁、頻道頁）維持不支援（R12）
  if (isYouTubeDomain(url.hostname.toLowerCase())) return null
  return { kind: 'web', url: url.href }
}
