// 畫質（R24、R32）。不依賴 hls.js 和 YouTube API，方便測試。

/** 畫質的選擇：自動，或畫面高度（例如 720） */
export type Quality = 'auto' | number

/** YouTube 的畫質代碼 → 畫面高度（R32 共用定義） */
const YT_HEIGHT: Record<string, number> = {
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480,
  hd720: 720,
  hd1080: 1080,
  hd1440: 1440,
  hd2160: 2160,
  highres: 4320
}

/** YouTube 內嵌播放器在小尺寸時最低仍然選這個畫質，更低的選項不會生效（R32） */
export const YOUTUBE_MIN_HEIGHT = 480

/** YouTube 可用畫質（getAvailableQualityLevels）→ 畫面高度，由高到低，不含 auto 和低於 480p 的 */
export function youtubeHeights(levels: string[] | null | undefined): number[] {
  if (!Array.isArray(levels)) return []
  return uniqueDesc(
    levels.map((l) => YT_HEIGHT[l]).filter((h): h is number => h !== undefined && h >= YOUTUBE_MIN_HEIGHT)
  )
}

/** m3u8 的畫質等級 → 畫面高度，由高到低，同一高度只列一次 */
export function hlsHeights(levels: { height: number }[]): number[] {
  return uniqueDesc(levels.map((l) => l.height).filter((h) => h > 0))
}

function uniqueDesc(hs: number[]): number[] {
  return [...new Set(hs)].sort((a, b) => b - a)
}

/**
 * m3u8 選擇特定畫質時用哪一個等級（R32）：不高於選擇的最高畫質（同高度取位元率最高的，也就是最後一個）；
 * 都比它高時用最低的。levels 依位元率由低到高排序。
 */
export function pickHlsLevel(levels: { height: number }[], height: number): number {
  if (levels.length === 0) return -1
  let best = -1
  levels.forEach((l, i) => {
    if (l.height <= height && (best < 0 || l.height >= levels[best].height)) best = i
  })
  if (best >= 0) return best
  let lowest = 0
  levels.forEach((l, i) => l.height < levels[lowest].height && (lowest = i))
  return lowest
}

/**
 * 「自動」時 m3u8 的畫質上限（R24）：第一個寬和高都不小於播放器大小的等級（影片會稍微縮小顯示）；
 * 都比播放器小時用最高的等級。levels 依畫質由低到高排序；沒有等級時回傳 -1（不限制）。
 */
export function capLevelFor(levels: { width: number; height: number }[], playerW: number, playerH: number): number {
  if (levels.length === 0) return -1
  const i = levels.findIndex((l) => l.width >= playerW && l.height >= playerH)
  return i >= 0 ? i : levels.length - 1
}

/** YouTube 選擇特定畫質時播放器的排版大小（16:9），例如 720 → 1280×720（R32） */
export function qualitySize(height: number): { w: number; h: number } {
  return { w: Math.round((height * 16) / 9), h: height }
}

/**
 * YouTube 播放器的縮放比例：選擇的畫質大小放進格子（長寬比和格子相同）。
 * 自動時為 1；比格子小的畫質會大於 1（放大顯示）。
 */
export function qualityScale(quality: Quality, cellW: number, cellH: number): number {
  if (quality === 'auto' || cellW <= 0 || cellH <= 0) return 1
  const { w, h } = qualitySize(quality)
  return Math.min(cellW / w, cellH / h)
}

/** 選單與按鈕上的名稱 */
export function qualityLabel(quality: Quality): string {
  return quality === 'auto' ? '自動' : `${quality}p`
}

/** 合理的畫面高度範圍 */
const MIN_HEIGHT = 100
const MAX_HEIGHT = 10000

/** 設定檔中的畫質（R32 AC5）：舊版的「高」是 1080p，合理範圍內的整數是畫面高度，其他都是自動 */
export function normalizeQuality(raw: unknown): Quality {
  if (raw === 'high') return 1080
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= MIN_HEIGHT && raw <= MAX_HEIGHT) return raw
  return 'auto'
}
