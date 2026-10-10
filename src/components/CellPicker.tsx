// 沒有空格時選擇要取代的格子（R64）：蓋在清單面板與網頁上面，每一個顯示中的格子一個選擇框
import { useEffect } from 'react'

export interface PickerCell {
  index: number
  /** 格子的位置（視窗座標） */
  rect: DOMRect
  /** 目前影片的名稱 */
  name: string
}

interface Props {
  cells: PickerCell[]
  onChoose(index: number): void
  onCancel(): void
}

export function CellPicker({ cells, onChoose, onCancel }: Props) {
  // 先於全域快捷鍵處理 Esc，避免同時離開全螢幕
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    // 點格子以外的地方就取消（R64 AC4）
    <div className="cell-picker" onClick={onCancel}>
      {cells.map((c) => (
        <button
          key={c.index}
          className="cell-picker-cell"
          style={{ left: c.rect.left, top: c.rect.top, width: c.rect.width, height: c.rect.height }}
          title={`取代第 ${c.index + 1} 格`}
          onClick={(e) => {
            e.stopPropagation()
            onChoose(c.index)
          }}
        >
          <span className="cell-picker-number">{c.index + 1}</span>
          <span className="cell-picker-name">{c.name}</span>
        </button>
      ))}
      <div className="cell-picker-bar" onClick={(e) => e.stopPropagation()}>
        <span>選擇要取代的格子</span>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}
