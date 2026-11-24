// 播放方式的小標示（R109；R165 改成只有 yt-dlp 顯示綠色小圓點）。不依賴 DOM，方便測試。
import type { Source } from './slots'
import type { YtMode } from '../players/YouTubeSource'

export interface PlaybackBadge {
  /** 顯示 8px 的綠色小圓點：只有用 yt-dlp 播放時（R165） */
  dot: boolean
  /** 滑鼠停在聲音圖示（左上角）上時的說明：這一格的播放方式 */
  tip: string
}

const YTDLP_TIP = '用 yt-dlp 播放：可以選畫質、語音，音量可到 200%'
const FALLBACK_TIP = 'yt-dlp 無法播放，已改用原本的方式'

/**
 * 這一格的播放方式；沒有可選的播放方式（mp4、m3u8 網址）、解析中時回傳 null。
 * - YouTube：yt-dlp／內嵌播放器
 * - 網頁來源：其他網站是 yt-dlp／網頁；YouTube 網頁播放、YouTube 網站頁面固定是網頁
 * 「內嵌播放器」「網頁」與 yt-dlp 播不了時改用的方式都不顯示標示，只留說明（R165）。
 */
export function playbackBadge(source: Pick<Source, 'parsed'>, mode: YtMode | undefined): PlaybackBadge | null {
  const kind = source.parsed.kind
  if (kind !== 'youtube' && kind !== 'web') return null
  if (mode === 'resolving') return null
  if (mode === 'ytdlp-hls' || mode === 'ytdlp-mp4') return { dot: true, tip: YTDLP_TIP }
  const fallback = mode === 'fallback'
  if (kind === 'youtube') {
    return { dot: false, tip: fallback ? `內嵌播放器：${FALLBACK_TIP}` : '用 YouTube 官方的內嵌播放器播放' }
  }
  return {
    dot: false,
    tip: fallback ? '用網頁播放：yt-dlp 不支援這個網站或需要登入' : '用網頁播放：整個網頁放在格子裡'
  }
}
