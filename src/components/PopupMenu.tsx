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
  /** 右邊的灰字（R166 齒輪選單：目前的音量、畫質等） */
  detail?: string
  /** 紅字（R166 齒輪選單的「移除」） */
  danger?: boolean
}

interface Props {
  /** 按鈕的位置（視窗座標） */
  anchor: DOMRect
  /** 出現在按鈕上方（格子，預設）或下方（工具列，R49） */
  placement?: 'above' | 'below'
  /** 對齊按鈕的右邊（預設）或從左邊開始（R171：在游標位置打開時） */
  align?: 'start' | 'end'
  /** 開關這個選單的按鈕的 data-popup-toggle；按這些按鈕時不當作點在選單外面 */
  toggleKey?: string
  items: PopupItem[]
  onSelect(key: string): void
  onClose(): void
}

const MARGIN = 4

export function PopupMenu({ anchor, placement = 'above', align = 'end', toggleKey, items, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom?: number; top?: number; maxHeight: number }>(
    placement === 'above'
      ? { left: anchor.left, bottom: window.innerHeight - anchor.top + MARGIN, maxHeight: anchor.top - MARGIN * 2 }
      : { left: anchor.left, top: anchor.bottom + MARGIN, maxHeight: window.innerHeight - anchor.bottom - MARGIN * 2 }
  )

  // 量到選單寬度後限制在視窗內
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    const left = Math.min(Math.max(align === 'start' ? anchor.left : anchor.right - w, MARGIN), window.innerWidth - w - MARGIN)
    setPos((p) => ({ ...p, left }))
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // 按的是打開這個選單的按鈕：交給按鈕自己開關，否則這裡先關閉、按鈕又把它打開（R171 修正）
      const toggle = (e.target as Element | null)?.closest?.('[data-popup-toggle]')
      if (toggleKey && toggle?.getAttribute('data-popup-toggle') === toggleKey) return
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
  }, [onClose, toggleKey])

  return (
    <div className="popup-menu" ref={ref} style={pos}>
      {items.map((i) => (
        <button
          key={i.key}
          className={`popup-item ${i.checked ? 'checked' : ''} ${i.danger ? 'popup-danger' : ''}`}
          disabled={i.disabled}
          onClick={() => {
            onSelect(i.key)
            if (!i.keepOpen) onClose()
          }}
        >
          <span className="popup-check">{i.checked ? '✓' : ''}</span>
          {i.label}
          {i.detail && <span className="popup-detail">{i.detail}</span>}
        </button>
      ))}
    </div>
  )
}
