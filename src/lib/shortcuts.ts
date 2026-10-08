// 快捷鍵對應（R9）

export type ShortcutAction =
  | { type: 'toggleAll' }
  | { type: 'muteAll' }
  | { type: 'focusAudio'; index: number }
  | { type: 'toggleFullscreen' }
  | { type: 'exitFullscreen' }

/** key 為 KeyboardEvent.key；不是快捷鍵時回傳 null。 */
export function shortcutFor(key: string): ShortcutAction | null {
  if (key === ' ') return { type: 'toggleAll' }
  if (key === 'm' || key === 'M') return { type: 'muteAll' }
  if (/^[1-9]$/.test(key)) return { type: 'focusAudio', index: Number(key) - 1 }
  if (key === 'F11') return { type: 'toggleFullscreen' }
  if (key === 'Escape') return { type: 'exitFullscreen' }
  return null
}
