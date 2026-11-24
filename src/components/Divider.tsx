// 可拖曳的分隔線（R5）
import { useRef, type CSSProperties, type PointerEvent } from 'react'
import type { Axis } from '../lib/layout'

interface Props {
  /** 方向、位置與另一個方向的起訖（0–1）；固定版型與自訂版型（R170）共用 */
  def: { axis: Axis; pos: number; from: number; to: number }
  /** pos：游標在格子容器中的位置（0–1）；containerPx：該方向的容器長度 */
  onDrag(pos: number, containerPx: number): void
  onReset(containerPx: number): void
}

const pct = (v: number) => `${v * 100}%`

export function Divider({ def, onDrag, onReset }: Props) {
  const dragging = useRef(false)
  const vertical = def.axis === 'cols'

  const style: CSSProperties = vertical
    ? { left: pct(def.pos), top: pct(def.from), height: pct(def.to - def.from) }
    : { top: pct(def.pos), left: pct(def.from), width: pct(def.to - def.from) }

  const measure = (e: PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const grid = e.currentTarget.parentElement!.getBoundingClientRect()
    return vertical
      ? { pos: (e.clientX - grid.left) / grid.width, px: grid.width }
      : { pos: (e.clientY - grid.top) / grid.height, px: grid.height }
  }

  return (
    <div
      className={`divider ${vertical ? 'vertical' : 'horizontal'}`}
      style={style}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const { pos, px } = measure(e)
        onDrag(pos, px)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onDoubleClick={(e) => onReset(measure(e).px)}
    />
  )
}
