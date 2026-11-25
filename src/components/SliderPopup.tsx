// 滑桿選單（R40 亮度、R41 總亮度、R42 音量）：滑桿＋目前數值＋「重設」。
// 拖曳時立即生效；按 Esc 或點選單外面關閉。格子裡出現在按鈕上方，工具列出現在按鈕下方。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createWheelStepper, sliderKeyValue, sliderWheelValue } from '../lib/sliderInput'

interface Props {
  anchor: DOMRect
  placement: 'above' | 'below'
  title: string
  min: number
  max: number
  step: number
  /** 超過這個值的那一段用不同顏色標示（R98：音量超過 100%） */
  boostFrom?: number
  value: number
  format(value: number): string
  onChange(value: number): void
  onReset(): void
  onClose(): void
  /** 開關這個滑桿的按鈕的 data-popup-toggle；按這些按鈕時不當作點在滑桿外面 */
  toggleKey?: string
}

const MARGIN = 4

export function SliderPopup(props: Props) {
  const { anchor, placement, onClose, toggleKey } = props
  const ref = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const wheel = useRef(createWheelStepper())
  const [left, setLeft] = useState(anchor.left)

  // 量到寬度後限制在視窗內
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    setLeft(Math.min(Math.max(anchor.right - w, MARGIN), window.innerWidth - w - MARGIN))
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // 按的是打開這個選單的按鈕：交給按鈕自己開關，否則這裡先關閉、按鈕又把它打開（R171 修正）
      const toggle = (e.target as Element | null)?.closest?.('[data-popup-toggle]')
      if (toggleKey && toggle?.getAttribute('data-popup-toggle') === toggleKey) return
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // 先於全域快捷鍵處理 Esc，避免同時離開全螢幕；滑桿開著時方向鍵等調整數值（R172），不當作快轉、倒轉
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      const p = propsRef.current
      const next = sliderKeyValue(e.key, p.value, p)
      if (next === null) return
      e.stopPropagation()
      e.preventDefault()
      if (next !== p.value) p.onChange(next)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, toggleKey])

  const style =
    placement === 'above'
      ? { left, bottom: window.innerHeight - anchor.top + MARGIN }
      : { left, top: anchor.bottom + MARGIN }

  return (
    <div
      className="slider-popup"
      ref={ref}
      style={style}
      title="滾輪或方向鍵也可以調整"
      onWheel={(e) => {
        // 滾輪調整（R172）：往上加、往下減
        const steps = wheel.current(e.deltaY, e.deltaMode)
        if (steps) props.onChange(sliderWheelValue(steps, props.value, props))
      }}
    >
      <div className="slider-popup-head">
        <span>{props.title}</span>
        <span className="slider-popup-value">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
        className={props.boostFrom !== undefined && props.value > props.boostFrom ? 'boosted' : ''}
        style={sliderFill(props)}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <button className="slider-popup-reset" onClick={props.onReset}>
        重設
      </button>
    </div>
  )
}

/** 滑桿的填色位置：目前值與放大起點（百分比） */
function sliderFill(p: Props): CSSProperties {
  const pct = (v: number) => `${((v - p.min) / (p.max - p.min)) * 100}%`
  return {
    '--fill': pct(p.value),
    '--boost': p.boostFrom !== undefined ? pct(p.boostFrom) : '100%'
  } as CSSProperties
}
