// 滑桿選單（R40 亮度、R41 總亮度、R42 音量）：滑桿＋目前數值＋「重設」。
// 拖曳時立即生效；按 Esc 或點選單外面關閉。格子裡出現在按鈕上方，工具列出現在按鈕下方。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Props {
  anchor: DOMRect
  placement: 'above' | 'below'
  title: string
  min: number
  max: number
  step: number
  value: number
  format(value: number): string
  onChange(value: number): void
  onReset(): void
  onClose(): void
}

const MARGIN = 4

export function SliderPopup(props: Props) {
  const { anchor, placement, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(anchor.left)

  // 量到寬度後限制在視窗內
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    setLeft(Math.min(Math.max(anchor.right - w, MARGIN), window.innerWidth - w - MARGIN))
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // 先於全域快捷鍵處理 Esc，避免同時離開全螢幕
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const style =
    placement === 'above'
      ? { left, bottom: window.innerHeight - anchor.top + MARGIN }
      : { left, top: anchor.bottom + MARGIN }

  return (
    <div className="slider-popup" ref={ref} style={style}>
      <div className="slider-popup-head">
        <span>{props.title}</span>
        <span className="slider-popup-value">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
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
