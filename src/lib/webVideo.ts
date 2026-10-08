// 網頁來源的主要影片挑選規則（R13 共用定義「主要影片」）。不依賴 DOM，方便測試。

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 和可視範圍重疊的部分至少要這麼大，才算主要影片的候選 */
export const MIN_VIDEO_W = 200
export const MIN_VIDEO_H = 112

/** 影片模式下網頁至少以這個大小排版，再縮小顯示在格子裡（R13） */
export const VIDEO_LAYOUT_MIN_W = 1280
export const VIDEO_LAYOUT_MIN_H = 720

/**
 * 影片模式的縮小比例：格子比 1280×720 小時，網頁以 (w / 比例) × (h / 比例) 排版再縮小，
 * 長寬比和格子相同；格子夠大時不縮放（1）。
 */
export function videoModeScale(w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1
  return Math.min(1, w / VIDEO_LAYOUT_MIN_W, h / VIDEO_LAYOUT_MIN_H)
}

/** 和可視範圍 (0, 0, vw, vh) 重疊的部分；沒有重疊時回傳 null */
export function clipToViewport(r: Rect, vw: number, vh: number): Rect | null {
  const x1 = Math.max(r.x, 0)
  const y1 = Math.max(r.y, 0)
  const x2 = Math.min(r.x + r.w, vw)
  const y2 = Math.min(r.y + r.h, vh)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export interface Candidate<T> {
  item: T
  /** 在這個框架可視範圍中的位置（未裁切） */
  rect: Rect
  /** 在頁面中的先後順序，面積相同時取較前面的 */
  order: number
}

export interface Picked<T> {
  item: T
  /** 裁切到可視範圍後的位置 */
  rect: Rect
  area: number
}

/**
 * 挑出顯示面積最大的候選；重疊部分小於 MIN_VIDEO_W × MIN_VIDEO_H 的不列入。
 * 「看得見」（沒有被隱藏、不透明度大於 0）由呼叫端先過濾。
 */
export function pickMain<T>(candidates: Candidate<T>[], vw: number, vh: number): Picked<T> | null {
  let best: (Picked<T> & { order: number }) | null = null
  for (const c of candidates) {
    const clipped = clipToViewport(c.rect, vw, vh)
    if (!clipped || clipped.w < MIN_VIDEO_W || clipped.h < MIN_VIDEO_H) continue
    const area = clipped.w * clipped.h
    if (!best || area > best.area || (area === best.area && c.order < best.order))
      best = { item: c.item, rect: clipped, area, order: c.order }
  }
  return best && { item: best.item, rect: best.rect, area: best.area }
}

/**
 * 把子框架回報的位置換算到上層框架的座標。
 * content 是子框架元素的內容區（上層座標），childVw / childVh 是子框架回報時的可視範圍大小。
 */
export function toParentRect(child: Rect, content: Rect, childVw: number, childVh: number): Rect {
  const sx = childVw > 0 ? content.w / childVw : 1
  const sy = childVh > 0 ? content.h / childVh : 1
  return {
    x: content.x + child.x * sx,
    y: content.y + child.y * sy,
    w: child.w * sx,
    h: child.h * sy
  }
}
