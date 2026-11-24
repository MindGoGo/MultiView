// 自訂版型（R170）：切割樹
import { describe, expect, it } from 'vitest'
import {
  customLabel,
  MAX_CELLS,
  moveTreeDivider,
  nextCustomId,
  normalizeCustomLayouts,
  normalizeTree,
  presetToTree,
  removeCell,
  resetTreeDivider,
  slotsAfterRemove,
  slotsAfterSplit,
  splitBlocked,
  splitCell,
  treeCellCount,
  treeDividers,
  treeRects,
  type LayoutNode
} from '../../src/lib/layoutTree'
import { cellRects, defaultRatios } from '../../src/lib/layout'
import { hiddenCount, isVisible } from '../../src/lib/slots'
import { normalizeSettings } from '../../src/lib/settings'

const C: LayoutNode = { kind: 'cell' }
const row = (sizes: number[], children: LayoutNode[]): LayoutNode => ({ kind: 'split', dir: 'row', sizes, children })
const col = (sizes: number[], children: LayoutNode[]): LayoutNode => ({ kind: 'split', dir: 'col', sizes, children })
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))
const rectsOf = (t: LayoutNode) => treeRects(t).map((r) => [r.x, r.y, r.w, r.h])

describe('格子位置與編號', () => {
  it('左邊 1 格、右邊上下 2 格：1 左、2 右上、3 右下', () => {
    const t = row([0.6, 0.4], [C, col([0.5, 0.5], [C, C])])
    expect(treeCellCount(t)).toBe(3)
    expect(rectsOf(t)).toEqual([
      [0, 0, 0.6, 1],
      [0.6, 0, 0.4, 0.5],
      [0.6, 0.5, 0.4, 0.5]
    ])
  })

  it('固定版型轉成切割樹，位置和原本相同', () => {
    for (const id of ['1', '2', '2x2', '3x3', '1+3'] as const) {
      const ratios = defaultRatios(id)
      const a = treeRects(presetToTree(id, ratios))
      const b = cellRects(id, ratios)
      expect(a.length).toBe(b.length)
      a.forEach((r, i) => close([r.x, r.y, r.w, r.h], [b[i].x, b[i].y, b[i].w, b[i].h]))
    }
    // 保留目前的比例
    const t = presetToTree('1+3', { cols: [0.7, 0.3], rows: [0.2, 0.3, 0.5] })
    close(treeRects(t)[0] ? [treeRects(t)[0].w, treeRects(t)[3].h] : [], [0.7, 0.5])
  })

  it('自訂版型也能判斷看不看得到、隱藏的來源', () => {
    const t = col([1 / 3, 1 / 3, 1 / 3], [C, C, C])
    expect(isVisible(2, t)).toBe(true)
    expect(isVisible(3, t)).toBe(false)
    expect(hiddenCount(['a', null, null, 'b', null, null, null, null, null] as never, t)).toBe(1)
  })
})

describe('切開', () => {
  it('上下切兩次：上中下 3 格平分（在同一層多加一格）', () => {
    const t1 = splitCell(C, 0, 'col')
    expect(t1).toEqual(col([0.5, 0.5], [C, C]))
    // 切下面那格：它和新格平分它原本的大小
    const t2 = splitCell(t1, 1, 'col')
    expect(t2).toEqual(col([0.5, 0.25, 0.25], [C, C, C]))
    // 切中間那格
    const t3 = splitCell(col([0.5, 0.5], [C, C]), 0, 'col')
    expect(t3).toEqual(col([0.25, 0.25, 0.5], [C, C, C]))
  })

  it('不同方向時把這一格換成新的一組，新格的編號是下一號', () => {
    const t = splitCell(row([0.5, 0.5], [C, C]), 1, 'col')
    expect(t).toEqual(row([0.5, 0.5], [C, col([0.5, 0.5], [C, C])]))
    expect(rectsOf(t)[2]).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('太小或已經 9 格時不能切', () => {
    // 1280×720 的畫面：一格寬 1280，切成兩半 640 ≥ 160、≥ 10%
    expect(splitBlocked(C, 0, 'row', 1280, 720)).toBeNull()
    // 寬 0.15 的格子：切成 0.075 < 10%
    const narrow = row([0.85, 0.15], [C, C])
    expect(splitBlocked(narrow, 1, 'row', 1280, 720)).toBe('small')
    expect(splitBlocked(narrow, 1, 'col', 1280, 720)).toBeNull()
    // 高 180px 的畫面：切成 90px 剛好可以；170px 不行
    expect(splitBlocked(C, 0, 'col', 1280, 180)).toBeNull()
    expect(splitBlocked(C, 0, 'col', 1280, 170)).toBe('small')
    const nine = presetToTree('3x3', defaultRatios('3x3'))
    expect(treeCellCount(nine)).toBe(MAX_CELLS)
    expect(splitBlocked(nine, 0, 'row', 4000, 4000)).toBe('max')
  })
})

describe('刪除', () => {
  it('空間交給前一格；第一格交給後一格', () => {
    expect(removeCell(col([0.2, 0.3, 0.5], [C, C, C]), 1)).toEqual(col([0.5, 0.5], [C, C]))
    expect(removeCell(col([0.2, 0.3, 0.5], [C, C, C]), 0)).toEqual(col([0.5, 0.5], [C, C]))
  })

  it('同一層只剩一個時往上併入上一層；同方向時攤平', () => {
    // 左 | (右上 / 右下) → 刪右下 → 左 | 右
    expect(removeCell(row([0.6, 0.4], [C, col([0.5, 0.5], [C, C])]), 2)).toEqual(row([0.6, 0.4], [C, C]))
    // 上 / (左 | 右) 的外面是 col；刪掉上 → 只剩 (左 | 右)
    expect(removeCell(col([0.5, 0.5], [C, row([0.5, 0.5], [C, C])]), 0)).toEqual(row([0.5, 0.5], [C, C]))
    // 左 | (上 / (中左 | 中右)) → 刪上 → (中左 | 中右) 和外層同方向，攤平成三格
    const t = row([0.5, 0.5], [C, col([0.5, 0.5], [C, row([0.5, 0.5], [C, C])])])
    const after = removeCell(t, 1)
    expect(after.kind === 'split' && after.dir).toBe('row')
    close(after.kind === 'split' ? after.sizes : [], [0.5, 0.25, 0.25])
    expect(treeCellCount(after)).toBe(3)
  })

  it('只剩一格時不變', () => {
    expect(removeCell(C, 0)).toBe(C)
  })
})

describe('影片跟著格子走', () => {
  it('切開：新的空白格插在下一號，後面的往後移，從後面拿掉一個空位', () => {
    expect(slotsAfterSplit(['a', 'b', 'c', null, null], 0)).toEqual(['a', null, 'b', 'c', null])
    expect(slotsAfterSplit(['a', 'b', null, 'h', null], 1)).toEqual(['a', 'b', null, null, 'h'])
  })

  it('切開時沒有空位：最後一個隱藏的來源放進新的格子，不會弄丟', () => {
    expect(slotsAfterSplit(['a', 'b', 'x', 'y'], 0)).toEqual(['a', 'y', 'b', 'x'])
  })

  it('刪除：後面的往前移，這一格的影片變成第一個隱藏的來源', () => {
    // 3 格刪掉第 2 格 → 剩 2 格，b 放到第 3 個位置（隱藏）
    expect(slotsAfterRemove(['a', 'b', 'c', 'h', null], 1, 2)).toEqual(['a', 'c', 'b', 'h', null])
    expect(slotsAfterRemove(['a', null, 'c', null], 1, 2)).toEqual(['a', 'c', null, null])
  })
})

describe('分隔線', () => {
  it('每一組的分隔線與它在畫面中的位置', () => {
    const t = row([0.6, 0.4], [C, col([0.5, 0.5], [C, C])])
    const d = treeDividers(t)
    expect(d.map((x) => [x.axis, x.path.join('.'), x.index, x.pos, x.from, x.to])).toEqual([
      ['cols', '', 0, 0.6, 0, 1],
      ['rows', '1', 0, 0.5, 0.6, 1]
    ])
  })

  it('拖曳：換算成組內的比例，兩邊不能小於最小格子', () => {
    const t = row([0.6, 0.4], [C, col([0.5, 0.5], [C, C])])
    const [, inner] = treeDividers(t)
    // 右欄的橫線拖到畫面高度 0.25 的位置
    const moved = moveTreeDivider(t, inner, 0.25, 720)
    expect(rectsOf(moved)[1][3]).toBeCloseTo(0.25)
    // 拖到最上面：停在最小格子（max(90/720, 10%) = 12.5%）
    const top = moveTreeDivider(t, inner, 0, 720)
    expect(rectsOf(top)[1][3]).toBeCloseTo(0.125)
    // 雙擊回到平分
    expect(rectsOf(resetTreeDivider(moved, inner, 720))[1][3]).toBeCloseTo(0.5)
  })

  it('裡面有好幾格的一側，最小寬度是那幾格加起來', () => {
    // 左 | (中 | 右) 不會出現（同方向會在同一層），用 左 | (上 /(左 | 右)) 測：右側寬度至少 2 格
    const t = row([0.5, 0.5], [C, col([0.5, 0.5], [C, row([0.5, 0.5], [C, C])])])
    const [outer] = treeDividers(t)
    // 1280 寬：一格至少 max(160/1280, 10%) = 12.5%，右側至少 25%
    const moved = moveTreeDivider(t, outer, 1, 1280)
    expect(moved.kind === 'split' && moved.sizes[1]).toBeCloseTo(0.25)
  })
})

describe('設定檔', () => {
  it('讀回合法的樹，略過不合法的', () => {
    const good = row([0.5, 0.5], [C, col([0.5, 0.5], [C, C])])
    expect(normalizeTree(JSON.parse(JSON.stringify(good)))).toEqual(good)
    expect(normalizeTree({ kind: 'split', dir: 'row', sizes: [1], children: [C] })).toBeNull()
    expect(normalizeTree({ kind: 'split', dir: 'row', sizes: [0.5, 0.6], children: [C, C] })).toBeNull()
    expect(normalizeTree({ kind: 'split', dir: 'x', sizes: [0.5, 0.5], children: [C, C] })).toBeNull()
    expect(normalizeTree({ kind: 'split', dir: 'row', sizes: [0.5, 0.5], children: [C, { kind: 'bad' }] })).toBeNull()
    // 超過 9 格
    const ten = { kind: 'split', dir: 'row', sizes: Array(10).fill(0.1), children: Array(10).fill(C) }
    expect(normalizeTree(ten)).toBeNull()
    expect(
      normalizeCustomLayouts([
        { id: 'c1', tree: good },
        { id: 'c2', tree: { kind: 'nope' } },
        { id: 'bad id', tree: C },
        { id: 'c1', tree: C },
        { id: 'c3', tree: C }
      ])
    ).toEqual([
      { id: 'c1', tree: good },
      { id: 'c3', tree: C }
    ])
  })

  it('layout 指向存在的自訂版型才保留，否則用 2×2', () => {
    const customLayouts = [{ id: 'c2', tree: col([0.5, 0.5], [C, C]) }]
    const ok = normalizeSettings({ version: 1, layout: 'custom:c2', customLayouts })!
    expect(ok.layout).toBe('custom:c2')
    expect(ok.customLayouts).toEqual(customLayouts)
    expect(normalizeSettings({ version: 1, layout: 'custom:c9', customLayouts })!.layout).toBe('2x2')
    expect(normalizeSettings({ version: 1, layout: '1+3' })!.customLayouts).toEqual([])
  })

  it('新的 id 與名稱', () => {
    expect(nextCustomId([])).toBe('c1')
    expect(nextCustomId([{ id: 'c1', tree: C }, { id: 'c3', tree: C }])).toBe('c2')
    expect(customLabel('c2')).toBe('自訂 2')
  })
})
