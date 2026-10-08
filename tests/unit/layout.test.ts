// R4：版型與格子編號；R5：分隔線
import { describe, expect, it } from 'vitest'
import {
  cellCount,
  cellRects,
  defaultRatios,
  dividers,
  isValidRatios,
  LAYOUT_IDS,
  minFraction,
  moveDivider,
  resetDivider,
  type LayoutId
} from '../../src/lib/layout'

const round = (v: number) => Math.round(v * 1e6) / 1e6
const roundRect = (r: { x: number; y: number; w: number; h: number }) => ({
  x: round(r.x),
  y: round(r.y),
  w: round(r.w),
  h: round(r.h)
})

describe('版型（R4）', () => {
  it('每種版型的格數', () => {
    const counts = Object.fromEntries(LAYOUT_IDS.map((id) => [id, cellCount(id)]))
    expect(counts).toEqual({ '1': 1, '2': 2, '2x2': 4, '3x3': 9, '1+3': 4 })
  })

  it.each(LAYOUT_IDS)('%s 的格子數量與格數一致，而且剛好鋪滿整個畫面', (id: LayoutId) => {
    const rects = cellRects(id, defaultRatios(id))
    expect(rects).toHaveLength(cellCount(id))
    const area = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(area).toBeCloseTo(1, 9)
  })

  it('2x2 編號由左到右、由上到下', () => {
    expect(cellRects('2x2', defaultRatios('2x2')).map(roundRect)).toEqual([
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    ])
  })

  it('3x3 第 4 格在第二列最左邊，第 9 格在右下角', () => {
    const rects = cellRects('3x3', defaultRatios('3x3')).map(roundRect)
    expect(rects[3]).toEqual({ x: 0, y: round(1 / 3), w: round(1 / 3), h: round(1 / 3) })
    expect(rects[8]).toEqual({ x: round(2 / 3), y: round(2 / 3), w: round(1 / 3), h: round(1 / 3) })
  })

  it('1+3 第 1 格是左邊大畫面，第 2–4 格是右欄由上到下', () => {
    const rects = cellRects('1+3', defaultRatios('1+3')).map(roundRect)
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(rects.slice(1).map((r) => [r.x, r.y])).toEqual([
      [0.5, 0],
      [0.5, round(1 / 3)],
      [0.5, round(2 / 3)]
    ])
  })
})

describe('分隔線（R5）', () => {
  it('每種版型的分隔線數量', () => {
    const count = (id: LayoutId) => {
      const ds = dividers(id, defaultRatios(id))
      return [ds.filter((d) => d.axis === 'cols').length, ds.filter((d) => d.axis === 'rows').length]
    }
    expect(count('1')).toEqual([0, 0])
    expect(count('2')).toEqual([1, 0])
    expect(count('2x2')).toEqual([1, 1])
    expect(count('3x3')).toEqual([2, 2])
    expect(count('1+3')).toEqual([1, 2])
  })

  it('2x2、3x3 的分隔線貫穿整個畫面', () => {
    for (const id of ['2x2', '3x3'] as const)
      for (const d of dividers(id, defaultRatios(id))) expect([d.from, d.to]).toEqual([0, 1])
  })

  it('1+3 的橫線只在右欄', () => {
    const ratios = { cols: [0.7, 0.3], rows: [1 / 3, 1 / 3, 1 / 3] }
    const rows = dividers('1+3', ratios).filter((d) => d.axis === 'rows')
    for (const d of rows) expect([round(d.from), d.to]).toEqual([0.7, 1])
  })

  it('AC1：拖曳分隔線改變兩側比例，總和維持 1', () => {
    const next = moveDivider([0.5, 0.5], 0, 0.7, 0.1)
    expect(next.map(round)).toEqual([0.7, 0.3])
  })

  it('AC1：3 欄時只影響分隔線兩側的欄', () => {
    const next = moveDivider([1 / 3, 1 / 3, 1 / 3], 1, 0.8, 0.1)
    expect(next.map(round)).toEqual([round(1 / 3), round(0.8 - 1 / 3), round(0.2)])
  })

  it('AC2：拖過頭時停在最小比例', () => {
    expect(moveDivider([0.5, 0.5], 0, 0.99, 0.2).map(round)).toEqual([0.8, 0.2])
    expect(moveDivider([0.5, 0.5], 0, -1, 0.2).map(round)).toEqual([0.2, 0.8])
  })

  it('AC2：最小比例取 160px／90px 與 10% 中比較大的', () => {
    expect(minFraction('cols', 1000)).toBeCloseTo(0.16) // 160px > 10%
    expect(minFraction('cols', 3000)).toBeCloseTo(0.1) // 10% > 160px
    expect(minFraction('rows', 600)).toBeCloseTo(0.15) // 90px > 10%
    expect(minFraction('rows', 2000)).toBeCloseTo(0.1)
  })

  it('AC2：空間本來就不夠時維持原狀', () => {
    const sizes = [0.3, 0.3, 0.4]
    expect(moveDivider(sizes, 0, 0.5, 0.35)).toBe(sizes)
  })

  it('AC3：雙擊只把這條分隔線移回均分位置', () => {
    const next = resetDivider([0.2, 0.5, 0.3], 0, 0.1)
    expect(next.map(round)).toEqual([round(1 / 3), round(0.7 - 1 / 3), 0.3])
  })

  it('AC3：均分位置會擠壓到另一側時，停在最小比例', () => {
    // 第 2 條邊界在 0.6；第 1 條要回到 1/3，但右側最少要留 0.3
    const next = resetDivider([0.1, 0.5, 0.4], 0, 0.3)
    expect(next.map(round)).toEqual([0.3, 0.3, 0.4])
  })

  it('isValidRatios 檢查數量、正數與總和', () => {
    expect(isValidRatios('2x2', { cols: [0.6, 0.4], rows: [0.5, 0.5] })).toBe(true)
    expect(isValidRatios('2x2', { cols: [0.6, 0.4], rows: [0.5] })).toBe(false)
    expect(isValidRatios('2', { cols: [0.6, 0.6], rows: [1] })).toBe(false)
    expect(isValidRatios('2', { cols: [1.2, -0.2], rows: [1] })).toBe(false)
    expect(isValidRatios('2', null)).toBe(false)
  })
})
