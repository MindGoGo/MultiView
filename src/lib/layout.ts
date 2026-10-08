// 版型定義、格子位置計算（R4）與分隔線比例（R5）

export type LayoutId = '1' | '2' | '2x2' | '3x3' | '1+3'

export const LAYOUT_IDS: LayoutId[] = ['1', '2', '2x2', '3x3', '1+3']

export const LAYOUT_LABELS: Record<LayoutId, string> = {
  '1': '1',
  '2': '2',
  '2x2': '2×2',
  '3x3': '3×3',
  '1+3': '1+3'
}

export const DEFAULT_LAYOUT: LayoutId = '2x2'

/** 各軌道（欄或列）的寬度比例，總和為 1。`1+3` 的 rows 是右欄內的三列。 */
export interface Ratios {
  cols: number[]
  rows: number[]
}

interface LayoutDef {
  cells: number
  cols: number
  rows: number
}

const DEFS: Record<LayoutId, LayoutDef> = {
  '1': { cells: 1, cols: 1, rows: 1 },
  '2': { cells: 2, cols: 2, rows: 1 },
  '2x2': { cells: 4, cols: 2, rows: 2 },
  '3x3': { cells: 9, cols: 3, rows: 3 },
  '1+3': { cells: 4, cols: 2, rows: 3 }
}

export const cellCount = (layout: LayoutId) => DEFS[layout].cells

const even = (n: number) => Array.from({ length: n }, () => 1 / n)

export function defaultRatios(layout: LayoutId): Ratios {
  const def = DEFS[layout]
  return { cols: even(def.cols), rows: even(def.rows) }
}

export function isValidRatios(layout: LayoutId, r: unknown): r is Ratios {
  if (typeof r !== 'object' || r === null) return false
  const { cols, rows } = r as Ratios
  const def = DEFS[layout]
  const ok = (a: unknown, n: number) =>
    Array.isArray(a) &&
    a.length === n &&
    a.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) &&
    Math.abs(a.reduce((s: number, v: number) => s + v, 0) - 1) < 1e-6
  return ok(cols, def.cols) && ok(rows, def.rows)
}

/** 以 0–1 表示的矩形。 */
export interface FracRect {
  x: number
  y: number
  w: number
  h: number
}

const offsets = (sizes: number[]) => {
  const out = [0]
  for (const s of sizes) out.push(out[out.length - 1] + s)
  return out
}

/** 每一格的位置，索引 0 是第 1 格。編號由左到右、由上到下（R4）。 */
export function cellRects(layout: LayoutId, ratios: Ratios): FracRect[] {
  const xs = offsets(ratios.cols)
  const ys = offsets(ratios.rows)
  if (layout === '1+3') {
    const main = { x: 0, y: 0, w: ratios.cols[0], h: 1 }
    const side = ratios.rows.map((h, i) => ({ x: xs[1], y: ys[i], w: ratios.cols[1], h }))
    return [main, ...side]
  }
  const rects: FracRect[] = []
  ratios.rows.forEach((h, r) =>
    ratios.cols.forEach((w, c) => rects.push({ x: xs[c], y: ys[r], w, h }))
  )
  return rects
}

export type Axis = 'cols' | 'rows'

/** 一條分隔線：位於 axis 上第 index 條邊界（第 index 與 index+1 軌道之間）。 */
export interface DividerDef {
  axis: Axis
  index: number
  /** 分隔線的位置（0–1） */
  pos: number
  /** 分隔線在另一個方向上的起點與終點（0–1） */
  from: number
  to: number
}

export function dividers(layout: LayoutId, ratios: Ratios): DividerDef[] {
  const xs = offsets(ratios.cols)
  const ys = offsets(ratios.rows)
  const out: DividerDef[] = []
  for (let i = 0; i < ratios.cols.length - 1; i++)
    out.push({ axis: 'cols', index: i, pos: xs[i + 1], from: 0, to: 1 })
  // 1+3 的橫線只在右欄
  const rowFrom = layout === '1+3' ? xs[1] : 0
  for (let i = 0; i < ratios.rows.length - 1; i++)
    out.push({ axis: 'rows', index: i, pos: ys[i + 1], from: rowFrom, to: 1 })
  return out
}

export const MIN_CELL_WIDTH_PX = 160
export const MIN_CELL_HEIGHT_PX = 90
export const MIN_CELL_FRACTION = 0.1

/**
 * 一格在指定方向上的最小比例（R5 AC2）：max(160px 或 90px, 10%)。
 * containerPx 是格子所在方向的可用長度（`1+3` 的橫線用整個視窗高度）。
 */
export function minFraction(axis: Axis, containerPx: number): number {
  const px = axis === 'cols' ? MIN_CELL_WIDTH_PX : MIN_CELL_HEIGHT_PX
  return Math.max(px / Math.max(containerPx, 1), MIN_CELL_FRACTION)
}

/** 把第 index 條邊界移到 pos，兩側的軌道都不能小於 min。 */
export function moveDivider(sizes: number[], index: number, pos: number, min: number): number[] {
  const edges = offsets(sizes)
  const lo = edges[index] + min
  const hi = edges[index + 2] - min
  // 空間本來就不夠時維持原狀
  if (lo > hi) return sizes
  const clamped = Math.min(Math.max(pos, lo), hi)
  const next = [...sizes]
  next[index] = clamped - edges[index]
  next[index + 1] = edges[index + 2] - clamped
  return next
}

/** 雙擊分隔線：只把這條邊界移回均分的位置（R5 AC3）。 */
export function resetDivider(sizes: number[], index: number, min: number): number[] {
  return moveDivider(sizes, index, (index + 1) / sizes.length, min)
}
