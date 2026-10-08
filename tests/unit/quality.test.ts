// R24：畫質。m3u8 自動時的上限、YouTube 高畫質時的縮放、設定檔相容
import { describe, expect, it } from 'vitest'
import { capLevelFor } from '../../src/lib/quality'
import { HIGH_QUALITY_H, HIGH_QUALITY_W, layoutScale } from '../../src/lib/webVideo'
import { normalizeView } from '../../src/lib/settings'

const LEVELS = [
  { width: 320, height: 184 },
  { width: 512, height: 288 },
  { width: 848, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 }
]

describe('capLevelFor（R24 m3u8 自動）', () => {
  it('AC2：3×3 的格子（425×239）上限是 512×288', () => {
    expect(capLevelFor(LEVELS, 425, 239)).toBe(1)
  })

  it('格子剛好等於某個等級時用那個等級', () => {
    expect(capLevelFor(LEVELS, 1280, 720)).toBe(3)
  })

  it('寬或高其中一邊超過就往上一級', () => {
    expect(capLevelFor(LEVELS, 1280, 721)).toBe(4)
  })

  it('格子比最高畫質還大時用最高的等級', () => {
    expect(capLevelFor(LEVELS, 2560, 1440)).toBe(4)
  })

  it('沒有等級時不限制', () => {
    expect(capLevelFor([], 400, 300)).toBe(-1)
  })
})

describe('layoutScale（R24 YouTube 高畫質）', () => {
  it('3×3 的格子以至少 1920×1080 載入', () => {
    const f = layoutScale(426, 239, HIGH_QUALITY_W, HIGH_QUALITY_H)
    expect(426 / f).toBeGreaterThanOrEqual(HIGH_QUALITY_W - 1e-9)
    expect(239 / f).toBeGreaterThanOrEqual(HIGH_QUALITY_H - 1e-9)
  })

  it('格子比 1920×1080 大時不縮放', () => {
    expect(layoutScale(2560, 1440, HIGH_QUALITY_W, HIGH_QUALITY_H)).toBe(1)
  })
})

describe('設定檔中的畫質（R24 AC4、AC5）', () => {
  const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

  it('AC4：高畫質原樣讀回', () => {
    expect(normalizeView({ slots: [{ url: YT, quality: 'high' }] }).slots[0]?.quality).toBe('high')
  })

  it('AC5：舊版設定檔沒有畫質欄位時是自動；不合法的值也是自動', () => {
    const view = normalizeView({ slots: [{ url: YT }, { url: YT, quality: 'ultra' }, { url: YT, quality: 1 }] })
    expect(view.slots.slice(0, 3).map((s) => s?.quality)).toEqual(['auto', 'auto', 'auto'])
  })
})
