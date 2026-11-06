// 播放方式的小標示（R109）。不依賴 DOM，方便測試。
import type { Source } from './slots'
import type { YtMode } from '../players/YouTubeSource'

export interface PlaybackBadge {
  /** 一般的文字 */
  text: string
  /** 格子窄的時候的短字 */
  short: string
  tone: 'ytdlp' | 'plain'
  /** 滑鼠停在小標示上時的說明 */
  tip: string
}

const YTDLP_TIP = '用 yt-dlp 播放：可以選畫質、語音，音量可到 200%'
const FALLBACK_TIP = 'yt-dlp 無法播放，已改用原本的方式'

/**
 * 這一格的小標示；沒有可選的播放方式（mp4、m3u8 網址）、解析中時回傳 null。
 * - YouTube：yt-dlp／內嵌播放器
 * - 網頁來源：其他網站是 yt-dlp／網頁；YouTube 網頁播放、YouTube 網站頁面固定是網頁
 */
export function playbackBadge(source: Pick<Source, 'parsed'>, mode: YtMode | undefined): PlaybackBadge | null {
  const kind = source.parsed.kind
  if (kind !== 'youtube' && kind !== 'web') return null
  if (mode === 'resolving') return null
  if (mode === 'ytdlp-hls' || mode === 'ytdlp-mp4') return { text: 'yt-dlp', short: 'yt-dlp', tone: 'ytdlp', tip: YTDLP_TIP }
  const fallback = mode === 'fallback'
  if (kind === 'youtube') {
    return fallback
      ? { text: '內嵌播放器（yt-dlp 無法播放）', short: '內嵌', tone: 'plain', tip: FALLBACK_TIP }
      : { text: '內嵌播放器', short: '內嵌', tone: 'plain', tip: '用 YouTube 官方的內嵌播放器播放' }
  }
  return fallback
    ? { text: '網頁（yt-dlp 無法播放）', short: '網頁', tone: 'plain', tip: '用網頁播放：yt-dlp 不支援這個網站或需要登入' }
    : { text: '網頁', short: '網頁', tone: 'plain', tip: '用網頁播放：整個網頁放在格子裡' }
}
