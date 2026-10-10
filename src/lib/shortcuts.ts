// 快捷鍵對應（R9）

export type ShortcutAction =
  | { type: 'toggleAll' }
  | { type: 'muteAll' }
  | { type: 'focusAudio'; index: number }
  | { type: 'toggleFullscreen' }
  | { type: 'exitFullscreen' }
  /** 目前操作的格子快轉（正數）或倒轉（負數）（R51） */
  | { type: 'skip'; seconds: number }

/** 方向鍵每次快轉、倒轉的秒數（R51） */
export const SKIP_SECONDS = 5

/** 按住時可以連續作用的按鍵（R51）；其他快捷鍵按住只作用一次 */
export function isRepeatableKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight'
}

/**
 * 焦點在網頁來源裡時按下的鍵要怎麼處理（R14 AC4、AC6，R9 AC3）：
 * - fullscreen：F11 一律切換全螢幕
 * - page：整頁模式，其他按鍵（包括 Esc）都交給網頁
 * - forward：影片模式下焦點只會因為「直接操作」進到網頁，快捷鍵轉給程式
 * - null：不是快捷鍵，交給網頁
 */
export function guestKeyAction(key: string, mode: 'video' | 'page' | undefined): 'fullscreen' | 'page' | 'forward' | null {
  if (key === 'F11') return 'fullscreen'
  if (mode === 'page') return 'page'
  return shortcutFor(key) ? 'forward' : null
}

/** key 為 KeyboardEvent.key；不是快捷鍵時回傳 null。 */
export function shortcutFor(key: string): ShortcutAction | null {
  if (key === ' ') return { type: 'toggleAll' }
  if (key === 'm' || key === 'M') return { type: 'muteAll' }
  if (/^[1-9]$/.test(key)) return { type: 'focusAudio', index: Number(key) - 1 }
  if (key === 'F11') return { type: 'toggleFullscreen' }
  if (key === 'Escape') return { type: 'exitFullscreen' }
  if (key === 'ArrowLeft') return { type: 'skip', seconds: -SKIP_SECONDS }
  if (key === 'ArrowRight') return { type: 'skip', seconds: SKIP_SECONDS }
  return null
}
