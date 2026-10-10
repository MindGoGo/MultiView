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
  /** 廣告阻擋，只用於網頁來源（R17）；跟著來源移動和保存 */
  adblock: boolean
  /** 使用者放入的來源，第一次成功載入時記錄到歷史（R23）；自動還原、切換廣告阻擋時為 false。不保存 */
  record?: boolean
  /** 畫質，只用於 YouTube 和 m3u8（R24）；跟著來源移動和保存 */
  quality: Quality
  /** 字幕的選擇，只用於 YouTube；null 為關閉（R31）。跟著來源移動和保存 */
  captions: string | null
  /** 亮度 20–150（%）（R40）；跟著來源移動和保存 */
  brightness: number
  /** 改用 YouTube 網頁播放（R48）；跟著來源移動和保存 */
  youtubeWeb: boolean
  /** 載入時要跳到的位置（秒）：上次的觀看進度（R55）；從頭開始時為 null */
  resume: number | null
  /** 從 YouTube 網站開啟時，保留在背景的來源頁面（R63）；跟著來源移動，不保存 */
  back?: Source | null
  /** 來源頁面的網址（R63）；重開程式後用來重新載入，跟著來源移動和保存 */
  backUrl?: string | null
  /** YouTube 網頁模式（R66）：url 仍是切換前的影片，parsed 是那部影片的 YouTube 網頁；不保存 */
  youtubePage?: boolean
}

export type { Quality } from './quality'
import type { Quality } from './quality'

export type Slots = (Source | null)[]

let lastId = 0
export const newSourceId = () => ++lastId

export const emptySlots = (): Slots => Array.from({ length: SLOT_COUNT }, () => null)

/**
 * 是否為顯示中的格位。單格全螢幕時（solo 為放大的格位）只有那一格顯示中，
 * 其他都視為隱藏的來源（R20 共用定義）。
 */
export const isVisible = (index: number, layout: LayoutId, solo: number | null = null) =>
  solo !== null ? index === solo : index < cellCount(layout)

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
