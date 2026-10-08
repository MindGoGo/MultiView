// 全部播放／暫停的對象（R8、R9、R20）
import type { LayoutId } from './layout'
import { isVisible, type Slots } from './slots'
import type { PlayStatus } from '../players/types'

/** 顯示中、有來源、而且不是錯誤狀態的格位（R8）。 */
export function controllableIndices(
  slots: Slots,
  layout: LayoutId,
  statuses: Record<number, PlayStatus>,
  solo: number | null = null
): number[] {
  const out: number[] = []
  slots.forEach((s, i) => {
    if (s && isVisible(i, layout, solo) && statuses[s.id] !== 'error') out.push(i)
  })
  return out
}

/** Space：只要有任何一格在播放就全部暫停，否則全部播放（R9）。 */
export function toggleAllAction(
  slots: Slots,
  layout: LayoutId,
  statuses: Record<number, PlayStatus>,
  solo: number | null = null
): 'play' | 'pause' {
  const anyPlaying = controllableIndices(slots, layout, statuses, solo).some(
    (i) => statuses[slots[i]!.id] === 'playing'
  )
  return anyPlaying ? 'pause' : 'play'
}

/** 每格的播放／暫停按鈕（R26）：播放中或緩衝中顯示暫停，其他（暫停、播完）顯示播放 */
export function isPlayingStatus(status: PlayStatus | undefined): boolean {
  return status === 'playing' || status === 'loading'
}
