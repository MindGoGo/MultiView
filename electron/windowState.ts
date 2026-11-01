// 視窗位置還原（R1 AC4）。純函式，不依賴 Electron，方便測試。

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 480
export const MIN_HEIGHT = 270

/** 視窗至少要有這麼大的面積落在某個螢幕內，才算「還在螢幕範圍內」。 */
const MIN_VISIBLE = 100

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

export function isOnSomeDisplay(bounds: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((area) => {
    const o = overlap(bounds, area)
    return o.width >= MIN_VISIBLE && o.height >= MIN_VISIBLE
  })
}

/**
 * 決定開啟時的視窗位置與大小。
 * 沒有記錄位置、或位置已經不在任何螢幕內時，就在主螢幕置中。
 */
export function resolveBounds(
  saved: { x?: number; y?: number; width: number; height: number },
  workAreas: Rect[],
  primary: Rect,
  min: { width: number; height: number } = { width: MIN_WIDTH, height: MIN_HEIGHT }
): Rect {
  if (saved.x !== undefined && saved.y !== undefined) {
    const candidate = {
      x: saved.x,
      y: saved.y,
      width: Math.max(saved.width, min.width),
      height: Math.max(saved.height, min.height)
    }
    if (isOnSomeDisplay(candidate, workAreas)) return candidate
  }
  // 置中時不能比主螢幕大
  const width = Math.max(Math.min(saved.width, primary.width), min.width)
  const height = Math.max(Math.min(saved.height, primary.height), min.height)
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height
  }
}
