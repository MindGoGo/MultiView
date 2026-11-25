// 滑桿的滾輪與鍵盤調整（R172）：音量、亮度共用。不依賴 DOM，方便測試。

export interface SliderRange {
  min: number
  max: number
  step: number
}

/** 滾輪、方向鍵每次調整的量：至少 5（音量的 step 是 1，一格一格太慢） */
export const coarseStep = (r: SliderRange) => Math.max(r.step, 5)

const clamp = (v: number, r: SliderRange) => Math.min(Math.max(v, r.min), r.max)

/**
 * 按鍵調整後的值；不是調整用的鍵時回傳 null。
 * ↑ → 加、↓ ← 減；PageUp／PageDown 一次五格；Home／End 到最小／最大。
 */
export function sliderKeyValue(key: string, value: number, r: SliderRange): number | null {
  const s = coarseStep(r)
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clamp(value + s, r)
    case 'ArrowDown':
    case 'ArrowLeft':
      return clamp(value - s, r)
    case 'PageUp':
      return clamp(value + s * 5, r)
    case 'PageDown':
      return clamp(value - s * 5, r)
    case 'Home':
      return r.min
    case 'End':
      return r.max
    default:
      return null
  }
}

/** 滑鼠滾輪一格的 deltaY（像素模式；Windows 通常是 100） */
export const WHEEL_NOTCH_PX = 100

/**
 * 滾輪累積器：滑鼠滾輪一格調整一次；觸控板的小幅捲動累積到一格才調整。
 * 回傳的函式傳入 WheelEvent 的 deltaY、deltaMode，回傳要調整幾格（往上捲為正）。
 */
export function createWheelStepper() {
  let acc = 0
  return (deltaY: number, deltaMode = 0): number => {
    // deltaMode 1 是「行」、2 是「頁」：每個事件就是一格
    if (deltaMode !== 0) return deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0
    // 換方向時從頭累積
    if (Math.sign(deltaY) !== Math.sign(acc)) acc = 0
    acc += deltaY
    const steps = Math.trunc(acc / WHEEL_NOTCH_PX)
    acc -= steps * WHEEL_NOTCH_PX
    return steps === 0 ? 0 : -steps
  }
}

/** 滾輪調整後的值 */
export const sliderWheelValue = (steps: number, value: number, r: SliderRange) => clamp(value + steps * coarseStep(r), r)
