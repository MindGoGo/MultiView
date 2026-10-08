// 聲音規則（R7、R8）
import type { LayoutId } from './layout'
import { isVisible, type Slots, type Source } from './slots'

export const isAudible = (s: Source) => !s.muted && s.volume > 0

/** 新來源是否靜音：已經有顯示中的來源有聲音時就靜音（R7 AC1）。 */
export function initialMuted(slots: Slots, layout: LayoutId): boolean {
  return slots.some((s, i) => s !== null && isVisible(i, layout) && isAudible(s))
}

const mapSources = (slots: Slots, fn: (s: Source, i: number) => Source): Slots =>
  slots.map((s, i) => (s ? fn(s, i) : s))

/** 獨占聲音：只有第 index 格取消靜音，其他全部靜音（R7 AC2）。 */
export function focusAudio(slots: Slots, index: number): Slots {
  if (!slots[index]) return slots
  return mapSources(slots, (s, i) => ({ ...s, muted: i !== index }))
}

/** 喇叭按鈕：只切換這一格（R7 AC3）。 */
export function toggleMute(slots: Slots, index: number): Slots {
  return mapSources(slots, (s, i) => (i === index ? { ...s, muted: !s.muted } : s))
}

export function setVolume(slots: Slots, index: number, volume: number): Slots {
  const v = Math.round(Math.min(Math.max(volume, 0), 100))
  return mapSources(slots, (s, i) => (i === index ? { ...s, volume: v } : s))
}

/** 全部靜音，音量設定不變（R8 AC3）。 */
export function muteAll(slots: Slots): Slots {
  return mapSources(slots, (s) => ({ ...s, muted: true }))
}
