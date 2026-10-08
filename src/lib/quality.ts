// m3u8 的畫質上限（R24）。不依賴 hls.js，方便測試。

/**
 * 「自動」時的畫質上限：第一個寬和高都不小於播放器大小的等級（影片會稍微縮小顯示）；
 * 都比播放器小時用最高的等級。levels 依畫質由低到高排序；沒有等級時回傳 -1（不限制）。
 */
export function capLevelFor(levels: { width: number; height: number }[], playerW: number, playerH: number): number {
  if (levels.length === 0) return -1
  const i = levels.findIndex((l) => l.width >= playerW && l.height >= playerH)
  return i >= 0 ? i : levels.length - 1
}
