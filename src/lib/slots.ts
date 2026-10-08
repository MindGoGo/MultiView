// 9 個固定格位（R4、R6）。移除來源時不往前遞補。
import { cellCount, type LayoutId } from './layout'
import type { ParsedSource } from './source'

export const SLOT_COUNT = 9

export interface Source {
  /** 每次放入新網址都換一個 id；畫面以 id 對應播放器，id 不變就不會重新載入 */
  id: number
  url: string
  parsed: ParsedSource
  muted: boolean
  volume: number
  /** 載入後是否自動播放；從設定檔還原的來源為 false（R10 AC1） */
  autoplay: boolean
}

export type Slots = (Source | null)[]

let lastId = 0
export const newSourceId = () => ++lastId

export const emptySlots = (): Slots => Array.from({ length: SLOT_COUNT }, () => null)

export const isVisible = (index: number, layout: LayoutId) => index < cellCount(layout)

export function setSlot(slots: Slots, index: number, source: Source | null): Slots {
  const next = [...slots]
  next[index] = source
  return next
}

/** 互換兩個格位的內容（R6）。 */
export function swapSlots(slots: Slots, a: number, b: number): Slots {
  if (a === b) return slots
  const next = [...slots]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

/** 不在目前版型中、但有來源的格位數（R4 AC4）。 */
export function hiddenCount(slots: Slots, layout: LayoutId): number {
  return slots.filter((s, i) => s !== null && !isVisible(i, layout)).length
}
