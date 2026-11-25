// R172：滑桿的滾輪與鍵盤調整
import { describe, expect, it } from 'vitest'
import { createWheelStepper, sliderKeyValue, sliderWheelValue } from '../../src/lib/sliderInput'

const volume = { min: 0, max: 200, step: 1 }
const brightness = { min: 20, max: 150, step: 5 }

describe('鍵盤（R172）', () => {
  it('↑ → 加 5、↓ ← 減 5', () => {
    expect(sliderKeyValue('ArrowUp', 100, volume)).toBe(105)
    expect(sliderKeyValue('ArrowRight', 100, volume)).toBe(105)
    expect(sliderKeyValue('ArrowDown', 100, volume)).toBe(95)
    expect(sliderKeyValue('ArrowLeft', 100, brightness)).toBe(95)
  })
  it('PageUp／PageDown 一次 25；Home／End 到最小／最大', () => {
    expect(sliderKeyValue('PageUp', 100, volume)).toBe(125)
    expect(sliderKeyValue('PageDown', 100, brightness)).toBe(75)
    expect(sliderKeyValue('Home', 100, brightness)).toBe(20)
    expect(sliderKeyValue('End', 100, volume)).toBe(200)
  })
  it('不超出範圍；其他鍵回傳 null', () => {
    expect(sliderKeyValue('ArrowUp', 198, volume)).toBe(200)
    expect(sliderKeyValue('ArrowDown', 22, brightness)).toBe(20)
    expect(sliderKeyValue(' ', 100, volume)).toBeNull()
    expect(sliderKeyValue('m', 100, volume)).toBeNull()
  })
})

describe('滾輪（R172）', () => {
  it('滑鼠滾輪一格調一次：往上加、往下減', () => {
    const step = createWheelStepper()
    expect(step(-100)).toBe(1)
    expect(step(100)).toBe(-1)
    expect(sliderWheelValue(1, 100, volume)).toBe(105)
    expect(sliderWheelValue(-1, 100, brightness)).toBe(95)
  })
  it('觸控板的小幅捲動累積到一格才調整；換方向重新累積', () => {
    const step = createWheelStepper()
    expect(step(-30)).toBe(0)
    expect(step(-30)).toBe(0)
    expect(step(-50)).toBe(1)
    expect(step(40)).toBe(0)
    expect(step(70)).toBe(-1)
  })
  it('行、頁模式每個事件一格', () => {
    const step = createWheelStepper()
    expect(step(-3, 1)).toBe(1)
    expect(step(1, 2)).toBe(-1)
  })
  it('不超出範圍', () => {
    expect(sliderWheelValue(3, 195, volume)).toBe(200)
    expect(sliderWheelValue(-2, 25, brightness)).toBe(20)
  })
})
