// 自訂版型（R170）：切割樹。每個節點是一格，或「左右排列」（row）／「上下排列」（col）的一組子節點。
// 這個檔案只有純函式：格子位置、分隔線、切開、刪除、影片跟著格子走、驗證、固定版型轉成切割樹。
import { MIN_CELL_FRACTION, MIN_CELL_HEIGHT_PX, MIN_CELL_WIDTH_PX, type Axis, type FracRect, type LayoutId, type Ratios } from './layout'

export type SplitDir = 'row' | 'col'

export type LayoutNode = { kind: 'cell' } | { kind: 'split'; dir: SplitDir; sizes: number[]; children: LayoutNode[] }

export interface CustomLayout {
  id: string
  tree: LayoutNode
}

/** 最多幾格（和格子的數量相同，SLOT_COUNT） */
export const MAX_CELLS = 9
/** 最多幾個自訂版型 */
export const MAX_CUSTOM_LAYOUTS = 5
/** 設定檔裡 layout 指向自訂版型時的前綴 */
export const CUSTOM_PREFIX = 'custom:'

const CELL: LayoutNode = { kind: 'cell' }

export const treeCellCount = (node: LayoutNode): number =>
  node.kind === 'cell' ? 1 : node.children.reduce((n, c) => n + treeCellCount(c), 0)

/** row 的子節點左右排，用 x 方向；col 的子節點上下排，用 y 方向 */
const axisOf = (dir: SplitDir): Axis => (dir === 'row' ? 'cols' : 'rows')

/** 每一格的位置，依格子編號（深度優先：先左後右、先上後下） */
export function treeRects(node: LayoutNode, rect: FracRect = { x: 0, y: 0, w: 1, h: 1 }): FracRect[] {
  if (node.kind === 'cell') return [rect]
  const out: FracRect[] = []
  let offset = 0
  node.children.forEach((child, i) => {
    const s = node.sizes[i]
    const r =
      node.dir === 'row'
        ? { x: rect.x + offset * rect.w, y: rect.y, w: s * rect.w, h: rect.h }
        : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: s * rect.h }
    offset += s
    out.push(...treeRects(child, r))
  })
  return out
}

/** 一條分隔線：path 是那一組在樹裡的位置，index 是第 index 與 index+1 個子節點之間 */
export interface TreeDivider {
  path: number[]
  index: number
  axis: Axis
  /** 在整個畫面中的位置（0–1） */
  pos: number
  /** 另一個方向的起點與終點（0–1） */
  from: number
  to: number
  /** 這一組在分隔線方向上的起點與長度（0–1），拖曳時換算成組內的比例 */
  start: number
  span: number
}

export function treeDividers(node: LayoutNode, rect: FracRect = { x: 0, y: 0, w: 1, h: 1 }, path: number[] = []): TreeDivider[] {
  if (node.kind === 'cell') return []
  const out: TreeDivider[] = []
  const row = node.dir === 'row'
  const start = row ? rect.x : rect.y
  const span = row ? rect.w : rect.h
  let offset = 0
  node.children.forEach((child, i) => {
    const s = node.sizes[i]
    const r = row
      ? { x: rect.x + offset * rect.w, y: rect.y, w: s * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: s * rect.h }
    offset += s
    if (i < node.children.length - 1) {
      out.push({
        path,
        index: i,
        axis: axisOf(node.dir),
        pos: start + offset * span,
        from: row ? rect.y : rect.x,
        to: row ? rect.y + rect.h : rect.x + rect.w,
        start,
        span
      })
    }
    out.push(...treeDividers(child, r, [...path, i]))
  })
  return out
}

/** 一個節點在 axis 方向上至少要幾格寬（排在這個方向的格子數，取最多的那一條） */
function minUnits(node: LayoutNode, axis: Axis): number {
  if (node.kind === 'cell') return 1
  const units = node.children.map((c) => minUnits(c, axis))
  return axisOf(node.dir) === axis ? units.reduce((a, b) => a + b, 0) : Math.max(...units)
}

/** 一格的最小長度（佔整個畫面的比例）：max(160px 或 90px, 10%)，R5 */
function minCellFraction(axis: Axis, containerPx: number) {
  const px = axis === 'cols' ? MIN_CELL_WIDTH_PX : MIN_CELL_HEIGHT_PX
  return Math.max(px / Math.max(containerPx, 1), MIN_CELL_FRACTION)
}

function nodeAt(node: LayoutNode, path: number[]): LayoutNode | null {
  let n: LayoutNode = node
  for (const i of path) {
    if (n.kind !== 'split' || !n.children[i]) return null
    n = n.children[i]
  }
  return n
}

function replaceAt(node: LayoutNode, path: number[], next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (node.kind !== 'split') return node
  const [i, ...rest] = path
  const children = [...node.children]
  children[i] = replaceAt(children[i], rest, next)
  return { ...node, children }
}

/**
 * 拖曳分隔線：pos 是游標在整個畫面中的位置（0–1），containerPx 是這個方向的畫面長度。
 * 兩側的子節點都不能小於它們裡面的格子需要的最小長度。
 */
export function moveTreeDivider(tree: LayoutNode, d: Pick<TreeDivider, 'path' | 'index' | 'start' | 'span'>, pos: number, containerPx: number): LayoutNode {
  const group = nodeAt(tree, d.path)
  if (!group || group.kind !== 'split' || d.span <= 0) return tree
  const axis = axisOf(group.dir)
  const unit = minCellFraction(axis, containerPx) / d.span
  const edges = [0]
  for (const s of group.sizes) edges.push(edges[edges.length - 1] + s)
  const lo = edges[d.index] + minUnits(group.children[d.index], axis) * unit
  const hi = edges[d.index + 2] - minUnits(group.children[d.index + 1], axis) * unit
  if (lo > hi) return tree
  const local = Math.min(Math.max((pos - d.start) / d.span, lo), hi)
  const sizes = [...group.sizes]
  sizes[d.index] = local - edges[d.index]
  sizes[d.index + 1] = edges[d.index + 2] - local
  return replaceAt(tree, d.path, { ...group, sizes })
}

/** 雙擊分隔線：這條邊界移回這一組平分的位置 */
export function resetTreeDivider(tree: LayoutNode, d: Pick<TreeDivider, 'path' | 'index' | 'start' | 'span'>, containerPx: number): LayoutNode {
  const group = nodeAt(tree, d.path)
  if (!group || group.kind !== 'split') return tree
  const pos = d.start + ((d.index + 1) / group.children.length) * d.span
  return moveTreeDivider(tree, d, pos, containerPx)
}

/** 第 index 格在樹裡的位置 */
function cellPath(node: LayoutNode, index: number): number[] | null {
  let count = 0
  const walk = (n: LayoutNode, path: number[]): number[] | null => {
    if (n.kind === 'cell') return count++ === index ? path : null
    for (let i = 0; i < n.children.length; i++) {
      const found = walk(n.children[i], [...path, i])
      if (found) return found
    }
    return null
  }
  return walk(node, [])
}

export type SplitBlock = 'max' | 'small' | null

/**
 * 能不能把第 index 格切開：已經 9 格（max），或切開後兩格會小於最小格子（small）時不能。
 * width、height 是格子區域的大小（px）。
 */
export function splitBlocked(tree: LayoutNode, index: number, dir: SplitDir, width: number, height: number): SplitBlock {
  if (treeCellCount(tree) >= MAX_CELLS) return 'max'
  const r = treeRects(tree)[index]
  if (!r) return 'small'
  const axis = axisOf(dir)
  const length = axis === 'cols' ? r.w : r.h
  const px = axis === 'cols' ? width : height
  return length / 2 < minCellFraction(axis, px) - 1e-9 ? 'small' : null
}

/**
 * 把第 index 格平分成兩格，新的格子在右邊（row）或下面（col），編號是 index + 1。
 * 這一格原本就在同方向的一組裡時，在同一層多加一格（這一格和新格平分它原本的大小）。
 */
export function splitCell(tree: LayoutNode, index: number, dir: SplitDir): LayoutNode {
  const path = cellPath(tree, index)
  if (!path) return tree
  const parentPath = path.slice(0, -1)
  const parent = path.length > 0 ? nodeAt(tree, parentPath) : null
  if (parent && parent.kind === 'split' && parent.dir === dir) {
    const i = path[path.length - 1]
    const half = parent.sizes[i] / 2
    const sizes = [...parent.sizes]
    sizes.splice(i, 1, half, half)
    const children = [...parent.children]
    children.splice(i + 1, 0, CELL)
    return replaceAt(tree, parentPath, { ...parent, sizes, children })
  }
  return replaceAt(tree, path, { kind: 'split', dir, sizes: [0.5, 0.5], children: [CELL, CELL] })
}

/**
 * 拿掉第 index 格：空間交給同一層的前一格（沒有時給後一格）；
 * 同一層只剩一個時，它往上併入上一層（和上一層同方向時把它的子節點攤平進去）。只剩 1 格時不變。
 */
export function removeCell(tree: LayoutNode, index: number): LayoutNode {
  const path = cellPath(tree, index)
  if (!path || path.length === 0) return tree
  const parentPath = path.slice(0, -1)
  const parent = nodeAt(tree, parentPath)
  if (!parent || parent.kind !== 'split') return tree
  const i = path[path.length - 1]
  const sizes = [...parent.sizes]
  const children = [...parent.children]
  const receiver = i > 0 ? i - 1 : i + 1
  sizes[receiver] += sizes[i]
  sizes.splice(i, 1)
  children.splice(i, 1)
  if (children.length > 1) return replaceAt(tree, parentPath, { ...parent, sizes, children })
  // 這一組只剩一個：用它取代這一組
  const only = children[0]
  if (parentPath.length === 0) return only
  const grandPath = parentPath.slice(0, -1)
  const grand = nodeAt(tree, grandPath)
  if (grand && grand.kind === 'split' && only.kind === 'split' && only.dir === grand.dir) {
    // 和上一層同方向：攤平
    const j = parentPath[parentPath.length - 1]
    const gs = [...grand.sizes]
    const gc = [...grand.children]
    const share = gs[j]
    gs.splice(j, 1, ...only.sizes.map((s) => s * share))
    gc.splice(j, 1, ...only.children)
    return replaceAt(tree, grandPath, { ...grand, sizes: gs, children: gc })
  }
  return replaceAt(tree, parentPath, only)
}

/**
 * 切開第 index 格後，格子裡的影片跟著格子走：新的空白格在 index + 1，後面的往後移一格。
 * 從後面找一個空位拿掉；沒有空位時，最後一個（暫時隱藏的）來源放進新的格子，不會弄丟。
 */
export function slotsAfterSplit<T>(slots: (T | null)[], index: number): (T | null)[] {
  const next = [...slots]
  let j = -1
  for (let k = next.length - 1; k > index; k--) {
    if (next[k] === null) {
      j = k
      break
    }
  }
  if (j >= 0) {
    next.splice(j, 1)
    next.splice(index + 1, 0, null)
  } else {
    const last = next.pop() ?? null
    next.splice(index + 1, 0, last)
  }
  return next
}

/**
 * 拿掉第 index 格後：後面的格子往前移一格，這一格的影片放到第一個隱藏的位置（count 是拿掉之後的格數），
 * 變成暫時隱藏的來源。
 */
export function slotsAfterRemove<T>(slots: (T | null)[], index: number, count: number): (T | null)[] {
  const next = [...slots]
  const [removed] = next.splice(index, 1)
  next.splice(count, 0, removed ?? null)
  return next
}

const even = (n: number) => Array.from({ length: n }, () => 1 / n)

/** 固定版型轉成切割樹（複製成自訂版型時用），保留目前的比例 */
export function presetToTree(layout: LayoutId, ratios: Ratios): LayoutNode {
  const cells = (n: number): LayoutNode[] => Array.from({ length: n }, () => CELL)
  switch (layout) {
    case '1':
      return CELL
    case '2':
      return { kind: 'split', dir: 'row', sizes: [...ratios.cols], children: cells(2) }
    case '1+3':
      return {
        kind: 'split',
        dir: 'row',
        sizes: [...ratios.cols],
        children: [CELL, { kind: 'split', dir: 'col', sizes: [...ratios.rows], children: cells(3) }]
      }
    case '2x2':
    case '3x3': {
      const n = layout === '2x2' ? 2 : 3
      const cols = ratios.cols.length === n ? ratios.cols : even(n)
      const rows = ratios.rows.length === n ? ratios.rows : even(n)
      return {
        kind: 'split',
        dir: 'col',
        sizes: [...rows],
        children: rows.map(() => ({ kind: 'split', dir: 'row', sizes: [...cols], children: cells(n) }) as LayoutNode)
      }
    }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 讀設定檔的切割樹；不合法時回傳 null */
export function normalizeTree(raw: unknown, depth = 0): LayoutNode | null {
  if (!isObject(raw) || depth > MAX_CELLS) return null
  if (raw.kind === 'cell') return CELL
  if (raw.kind !== 'split' || (raw.dir !== 'row' && raw.dir !== 'col')) return null
  const { sizes, children } = raw
  if (!Array.isArray(sizes) || !Array.isArray(children) || children.length < 2 || sizes.length !== children.length) return null
  if (!sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return null
  if (Math.abs((sizes as number[]).reduce((a, b) => a + b, 0) - 1) > 1e-6) return null
  const kids = children.map((c) => normalizeTree(c, depth + 1))
  if (kids.some((k) => k === null)) return null
  const node: LayoutNode = { kind: 'split', dir: raw.dir, sizes: [...(sizes as number[])], children: kids as LayoutNode[] }
  return treeCellCount(node) <= MAX_CELLS ? node : null
}

/** 讀設定檔的自訂版型：不合法的略過，id 重複的只留第一個，最多 5 個 */
export function normalizeCustomLayouts(raw: unknown): CustomLayout[] {
  if (!Array.isArray(raw)) return []
  const out: CustomLayout[] = []
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== 'string' || !/^c\d{1,6}$/.test(item.id)) continue
    if (out.some((l) => l.id === item.id)) continue
    const tree = normalizeTree(item.tree)
    if (tree) out.push({ id: item.id, tree })
    if (out.length >= MAX_CUSTOM_LAYOUTS) break
  }
  return out
}

/** 新的自訂版型的 id：c1、c2…，用沒用過的最小號碼 */
export function nextCustomId(layouts: readonly CustomLayout[]): string {
  for (let n = 1; ; n++) if (!layouts.some((l) => l.id === `c${n}`)) return `c${n}`
}

/** 顯示的名稱：「自訂 1」 */
export const customLabel = (id: string) => `自訂 ${id.slice(1)}`
