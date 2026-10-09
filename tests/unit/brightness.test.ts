// R40：每格亮度；R41：總亮度和各格亮度相乘
import { describe, expect, it } from 'vitest'
import { brightnessFilter, effectiveBrightness, normalizeBrightness } from '../../src/lib/brightness'
import { defaultSettings, normalizeView } from '../../src/lib/settings'

const YT = 'https://www.youtube.com/watch?v=jfKfPfyJRdk'

describe('normalizeBrightness（R40 AC7、R41 AC3）', () => {
  it('合法值原樣保留', () => {
    expect(normalizeBrightness(20)).toBe(20)
    expect(normalizeBrightness(60)).toBe(60)
    expect(normalizeBrightness(150)).toBe(150)
  })

  it('超出範圍時限制在 20–150', () => {
    expect(normalizeBrightness(0)).toBe(20)
    expect(normalizeBrightness(-50)).toBe(20)
    expect(normalizeBrightness(500)).toBe(150)
  })

  it('不是 5 的倍數時取最接近的 5 的倍數', () => {
    expect(normalizeBrightness(62)).toBe(60)
    expect(normalizeBrightness(63)).toBe(65)
    expect(normalizeBrightness(149)).toBe(150)
  })

  it('沒有欄位或不合法時為 100', () => {
    expect(normalizeBrightness(undefined)).toBe(100)
    expect(normalizeBrightness(null)).toBe(100)
    expect(normalizeBrightness('60')).toBe(100)
    expect(normalizeBrightness(NaN)).toBe(100)
    expect(normalizeBrightness(Infinity)).toBe(100)
  })
})

describe('實際亮度＝格子亮度 × 總亮度（R41 AC1、AC2）', () => {
  it('格子 120%、總亮度 80% → 96%；格子 100%、總亮度 80% → 80%', () => {
    expect(effectiveBrightness(120, 80)).toBe(96)
    expect(effectiveBrightness(100, 80)).toBe(80)
  })

  it('不另外設上限：150% × 150% = 225%；最低 20% × 20% = 4%', () => {
    expect(effectiveBrightness(150, 150)).toBe(225)
    expect(effectiveBrightness(20, 20)).toBe(4)
  })

  it('濾鏡：實際亮度 100% 時不套用，其他時候套用對應的 brightness()', () => {
    expect(brightnessFilter(100, 100)).toBeUndefined()
    expect(brightnessFilter(50, 100)).toBe('brightness(0.5)')
    expect(brightnessFilter(150, 100)).toBe('brightness(1.5)')
    expect(brightnessFilter(120, 80)).toBe('brightness(0.96)')
    // 兩者相乘剛好 100 時也不套用
    expect(brightnessFilter(125, 80)).toBeUndefined()
  })
})

describe('設定檔中的亮度（R40 AC5、AC7；R41 AC3）', () => {
  it('預設設定的總亮度是 100', () => {
    expect(defaultSettings().brightness).toBe(100)
  })

  it('舊的設定檔：沒有總亮度、來源沒有亮度 → 都是 100', () => {
    const v = normalizeView({ layout: '2x2', slots: [{ url: YT, muted: false, volume: 50 }] })
    expect(v.brightness).toBe(100)
    expect(v.slots[0]?.brightness).toBe(100)
  })

  it('保存的亮度讀回來不變，不合法的值被修正', () => {
    const v = normalizeView({ brightness: 80, slots: [{ url: YT, brightness: 60 }, { url: YT, brightness: 999 }] })
    expect(v.brightness).toBe(80)
    expect(v.slots[0]?.brightness).toBe(60)
    expect(v.slots[1]?.brightness).toBe(150)
  })
})
