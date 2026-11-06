// 音量（第一版 R7、R42、R98）：可放大音量的來源最高 200%，其他來源最高 100%。不依賴 DOM，方便測試。
import type { Source } from './slots'
import type { YtMode } from '../players/YouTubeSource'

export const VOLUME_DEFAULT = 100
/** 一般的上限；也是放大的起點 */
export const VOLUME_NORMAL_MAX = 100
/** 可放大音量的來源的上限（R98） */
export const VOLUME_BOOST_MAX = 200

/** 保存的音量：0–200 的整數；不合法時用預設值 */
export function normalizeVolume(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(Math.max(v, 0), VOLUME_BOOST_MAX))
    : VOLUME_DEFAULT
}

/**
 * 可放大音量的來源（R98 第 3 節）：yt-dlp 播放、m3u8 網址。
 * 內嵌播放器、網頁、一般的 mp4 網址拿不到聲音資料，最高 100%。
 */
export function canBoost(source: Pick<Source, 'parsed'>, ytMode: YtMode | undefined): boolean {
  if (source.parsed.kind === 'hls') return true
  return source.parsed.kind === 'youtube' && (ytMode === 'ytdlp-hls' || ytMode === 'ytdlp-mp4')
}

/** 實際使用的音量：不能放大時最多 100（保存的值不變） */
export const effectiveVolume = (volume: number, boostable: boolean) =>
  boostable ? volume : Math.min(volume, VOLUME_NORMAL_MAX)

export const volumeMax = (boostable: boolean) => (boostable ? VOLUME_BOOST_MAX : VOLUME_NORMAL_MAX)

/** 播放器的音量（0–1）與放大倍數（1–2）：100% 以下只用播放器的音量，不經過聲音處理 */
export function volumeParts(volume: number): { element: number; gain: number } {
  return {
    element: Math.min(volume, VOLUME_NORMAL_MAX) / VOLUME_NORMAL_MAX,
    gain: Math.max(volume, VOLUME_NORMAL_MAX) / VOLUME_NORMAL_MAX
  }
}
