// 格子選單（R31 字幕、R32 畫質）：出現在按鈕上方並限制在視窗內，太長時可以捲動；
// 按 Esc、點選單外面或選了項目後關閉
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface PopupItem {
  key: string
  label: string
  checked?: boolean
  disabled?: boolean
  /** 選了之後選單不關閉（R93：更新 yt-dlp 後在選單裡看狀態） */
  keepOpen?: boolean
}

interface Props {
  /** 按鈕的位置（視窗座標） */
  anchor: DOMRect
  /** 出現在按鈕上方（格子，預設）或下方（工具列，R49） */
  placement?: 'above' | 'below'
  items: PopupItem[]
  onSelect(key: string): void
  onClose(): void
}

const MARGIN = 4

export function PopupMenu({ anchor, placement = 'above', items, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom?: number; top?: number; maxHeight: number }>(
    placement === 'above'
      ? { left: anchor.left, bottom: window.innerHeight - anchor.top + MARGIN, maxHeight: anchor.top - MARGIN * 2 }
      : { left: anchor.left, top: anchor.bottom + MARGIN, maxHeight: window.innerHeight - anchor.bottom - MARGIN * 2 }
  )

  // 量到選單寬度後限制在視窗內
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    const left = Math.min(Math.max(anchor.right - w, MARGIN), window.innerWidth - w - MARGIN)
    setPos((p) => ({ ...p, left }))
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

  return (
    <div className="popup-menu" ref={ref} style={pos}>
      {items.map((i) => (
        <button
          key={i.key}
          className={`popup-item ${i.checked ? 'checked' : ''}`}
          disabled={i.disabled}
          onClick={() => {
            onSelect(i.key)
            if (!i.keepOpen) onClose()
          }}
        >
          <span className="popup-check">{i.checked ? '✓' : ''}</span>
          {i.label}
        </button>
      ))}
    </div>
  )
}
