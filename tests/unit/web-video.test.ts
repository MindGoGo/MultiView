// R13：主要影片的挑選規則、子框架座標換算、影片模式的排版大小
import { describe, expect, it } from 'vitest'
import {
  clipToViewport,
  MIN_VIDEO_H,
  MIN_VIDEO_W,
  pickMain,
  toParentRect,
  videoModeScale,
  type Candidate
} from '../../src/lib/webVideo'

const VW = 1280
const VH = 720
const c = (item: string, x: number, y: number, w: number, h: number, order: number): Candidate<string> => ({
  item,
  rect: { x, y, w, h },
  order
})

describe('pickMain（R13 共用定義「主要影片」）', () => {
  it('AC3：選顯示面積最大的', () => {
    const picked = pickMain([c('small', 0, 30, 240, 135, 0), c('big', 250, 30, 400, 225, 1), c('mid', 0, 300, 320, 180, 2)], VW, VH)
    expect(picked?.item).toBe('big')
    expect(picked?.area).toBe(400 * 225)
  })

  it('面積相同時取頁面中較前面的', () => {
    expect(pickMain([c('a', 0, 0, 300, 200, 0), c('b', 400, 0, 300, 200, 1)], VW, VH)?.item).toBe('a')
    expect(pickMain([c('b', 400, 0, 300, 200, 1), c('a', 0, 0, 300, 200, 0)], VW, VH)?.item).toBe('a')
  })

  it('AC3：太小的影片不列入（寬小於 200 或高小於 112）', () => {
    expect(pickMain([c('tiny', 0, 0, 150, 84, 0)], VW, VH)).toBeNull()
    expect(pickMain([c('narrow', 0, 0, MIN_VIDEO_W - 1, 400, 0)], VW, VH)).toBeNull()
    expect(pickMain([c('short', 0, 0, 400, MIN_VIDEO_H - 1, 0)], VW, VH)).toBeNull()
    expect(pickMain([c('edge', 0, 0, MIN_VIDEO_W, MIN_VIDEO_H, 0)], VW, VH)?.item).toBe('edge')
  })

  it('AC3：完全在可視範圍外的不列入', () => {
    expect(pickMain([c('below', 0, 3000, 900, 500, 0)], VW, VH)).toBeNull()
    expect(pickMain([c('left', -1000, 0, 900, 500, 0)], VW, VH)).toBeNull()
  })

  it('只計算和可視範圍重疊的面積：大部分在畫面外的大影片輸給完整顯示的影片', () => {
    const picked = pickMain([c('mostlyOut', 0, 600, 1280, 720, 0), c('inView', 0, 0, 400, 300, 1)], VW, VH)
    // mostlyOut 只露出 1280 × 120 = 153600，inView 是 400 × 300 = 120000
    expect(picked?.item).toBe('mostlyOut')
    const picked2 = pickMain([c('mostlyOut', 0, 650, 1280, 720, 0), c('inView', 0, 0, 400, 300, 1)], VW, VH)
    // mostlyOut 只露出 70px 高，小於 112，不列入
    expect(picked2?.item).toBe('inView')
  })

  it('回傳裁切後的位置', () => {
    expect(pickMain([c('v', -100, -50, 600, 400, 0)], VW, VH)?.rect).toEqual({ x: 0, y: 0, w: 500, h: 350 })
  })

  it('沒有候選時回傳 null', () => {
    expect(pickMain([], VW, VH)).toBeNull()
  })
})

describe('clipToViewport', () => {
  it('完全在內時不變', () => {
    expect(clipToViewport({ x: 10, y: 10, w: 100, h: 50 }, VW, VH)).toEqual({ x: 10, y: 10, w: 100, h: 50 })
  })
  it('沒有重疊（包括剛好碰到邊）回傳 null', () => {
    expect(clipToViewport({ x: VW, y: 0, w: 100, h: 50 }, VW, VH)).toBeNull()
    expect(clipToViewport({ x: 0, y: -50, w: 100, h: 50 }, VW, VH)).toBeNull()
  })
})

describe('toParentRect（R13 AC3-1：子框架中的影片）', () => {
  it('子框架沒有縮放時只平移', () => {
    const content = { x: 14, y: 34, w: 400, h: 250 }
    expect(toParentRect({ x: 0, y: 24, w: 400, h: 226 }, content, 400, 250)).toEqual({ x: 14, y: 58, w: 400, h: 226 })
  })

  it('子框架回報時的可視範圍和上層看到的大小不同時（例如子框架正在放大顯示），依比例換算', () => {
    const content = { x: 100, y: 50, w: 400, h: 225 }
    // 子框架可視範圍 1280×720，影片填滿 → 換算回上層等於整個子框架
    expect(toParentRect({ x: 0, y: 0, w: 1280, h: 720 }, content, 1280, 720)).toEqual(content)
  })

  it('可視範圍為 0 時不縮放', () => {
    expect(toParentRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 10, y: 10, w: 0, h: 0 }, 0, 0)).toEqual({ x: 11, y: 12, w: 3, h: 4 })
  })
})

describe('videoModeScale（R13：影片模式至少以 1280×720 排版）', () => {
  it('格子夠大時不縮放', () => {
    expect(videoModeScale(1280, 720)).toBe(1)
    expect(videoModeScale(1920, 1080)).toBe(1)
  })

  it('AC7：3×3 的格子（約 426×239）以至少 1280×720 排版', () => {
    const f = videoModeScale(426, 239)
    expect(426 / f).toBeGreaterThanOrEqual(1280 - 1e-9)
    expect(239 / f).toBeGreaterThanOrEqual(720 - 1e-9)
  })

  it('寬或高其中一邊不夠時，兩邊都至少達到 1280×720，長寬比和格子相同', () => {
    const f = videoModeScale(640, 720)
    expect(640 / f).toBeCloseTo(1280)
    expect(720 / f).toBeCloseTo(1440)
  })

  it('格子大小為 0（還沒排版）時不縮放', () => {
    expect(videoModeScale(0, 0)).toBe(1)
  })
})
