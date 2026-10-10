// 進度條的判斷與換算（R19）。不依賴 DOM，方便測試。

/** 播放器回報的進度，單位是秒 */
export interface Progress {
  current: number
  /** 一般影片是 0；直播是可回放範圍的開始 */
  start: number
  /** 一般影片是總長度；直播是直播最新位置（可回放範圍的結束） */
  end: number
  live: boolean
}

/** 可回放範圍至少這麼長，才算可回放的直播（R19 共用定義） */
export const DVR_MIN_SECONDS = 60
/** 距離直播最新位置這麼近以內，視為正在看直播 */
export const LIVE_EDGE_SECONDS = 10
/** 長度超過這個值的影片當作直播（有些網站的直播回報一個極大的長度，而不是無限大） */
const LIVE_DURATION_SECONDS = 10 * 24 * 3600

export type ProgressKind = 'vod' | 'dvr' | 'live'

export interface ProgressView {
  kind: ProgressKind
  /** 目前位置在進度條上的比例 0–1（live 沒有進度條，為 0） */
  fraction: number
  /** 是否正在看直播（只有 dvr 有意義） */
  atLive: boolean
}

export function progressView(p: Progress): ProgressView {
  const span = p.end - p.start
  if (!p.live) return { kind: 'vod', fraction: span > 0 ? clamp01((p.current - p.start) / span) : 0, atLive: false }
  if (span < DVR_MIN_SECONDS) return { kind: 'live', fraction: 0, atLive: true }
  return {
    kind: 'dvr',
    fraction: clamp01((p.current - p.start) / span),
    atLive: p.end - p.current <= LIVE_EDGE_SECONDS
  }
}

/** 進度條上的比例 → 要跳到的秒數 */
export function seekTarget(p: Progress, fraction: number): number {
  return p.start + clamp01(fraction) * (p.end - p.start)
}

/**
 * 快轉、倒轉後的秒數（R51）：限制在可跳轉的範圍內（開頭／可回放範圍的開始 ～ 結尾／直播最新位置）。
 * 沒有進度條（沒有回放範圍的直播）時回傳 null。
 */
export function skipTarget(p: Progress, seconds: number): number | null {
  if (progressView(p).kind === 'live') return null
  return Math.min(Math.max(p.current + seconds, p.start), p.end)
}

/** `m:ss`，一小時以上 `h:mm:ss` */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 距離直播的時間，例如 `-1:23` */
export function formatBehind(seconds: number): string {
  return `-${formatTime(seconds)}`
}

/** `<video>` 元素的資訊（mp4、m3u8、網頁中的主要影片共用） */
export interface MediaInfo {
  duration: number
  currentTime: number
  /** video.seekable 的各段範圍 */
  seekable: [number, number][]
  /** 已知是否為直播（例如 hls.js 的播放清單資訊）；不知道時省略，依長度判斷 */
  live?: boolean
}

/** 從 `<video>` 的資訊算出進度；還不知道長度時回傳 null */
export function progressFromMedia(m: MediaInfo): Progress | null {
  // 長度是 NaN 表示還沒載入，不是直播
  if (m.live === undefined && Number.isNaN(m.duration)) return null
  const live = m.live ?? (m.duration === Infinity || m.duration > LIVE_DURATION_SECONDS)
  if (!live) {
    if (!(m.duration > 0)) return null
    return { current: m.currentTime, start: 0, end: m.duration, live: false }
  }
  if (m.seekable.length === 0) return { current: m.currentTime, start: m.currentTime, end: m.currentTime, live: true }
  const start = m.seekable[0][0]
  const end = m.seekable[m.seekable.length - 1][1]
  return { current: m.currentTime, start, end, live: true }
}

/** 把 TimeRanges 轉成陣列 */
export function rangesOf(r: TimeRanges): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < r.length; i++) out.push([r.start(i), r.end(i)])
  return out
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0
}
