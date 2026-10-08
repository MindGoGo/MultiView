// R4：格位與隱藏；R6：換位；R7、R8：聲音與全部控制；R9：快捷鍵
import { describe, expect, it } from 'vitest'
import { emptySlots, hiddenCount, isVisible, setSlot, swapSlots, type Slots, type Source } from '../../src/lib/slots'
import { focusAudio, initialMuted, isAudible, muteAll, setVolume, toggleMute } from '../../src/lib/audio'
import { controllableIndices, toggleAllAction } from '../../src/lib/playback'
import { shortcutFor } from '../../src/lib/shortcuts'
import type { PlayStatus } from '../../src/players/types'

let nextId = 1000
function src(over: Partial<Source> = {}): Source {
  return {
    id: nextId++,
    url: 'https://x.com/a.mp4',
    parsed: { kind: 'mp4', url: 'https://x.com/a.mp4' },
    muted: true,
    volume: 100,
    autoplay: true,
    adblock: true,
    quality: 'auto',
    ...over
  }
}

/** 建立指定格位有來源的 slots */
function slotsWith(entries: Record<number, Partial<Source>>): Slots {
  let slots = emptySlots()
  for (const [i, over] of Object.entries(entries)) slots = setSlot(slots, Number(i), src(over))
  return slots
}

const audible = (slots: Slots) => slots.flatMap((s, i) => (s && isAudible(s) ? [i + 1] : []))

describe('格位（R4）', () => {
  it('固定 9 個格位', () => {
    expect(emptySlots()).toHaveLength(9)
  })

  it('AC3：格位編號超過版型格數的來源是隱藏的', () => {
    expect([0, 3, 4].map((i) => isVisible(i, '2x2'))).toEqual([true, true, false])
    expect(isVisible(8, '3x3')).toBe(true)
    expect(isVisible(1, '1')).toBe(false)
  })

  it('AC4：計算隱藏的來源數量', () => {
    const slots = slotsWith({ 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {} })
    expect(hiddenCount(slots, '2x2')).toBe(2)
    expect(hiddenCount(slots, '3x3')).toBe(0)
    expect(hiddenCount(slots, '1')).toBe(5)
  })

  it('AC5：移除來源後，隱藏的來源不會往前遞補', () => {
    const slots = setSlot(slotsWith({ 0: {}, 1: {}, 4: {} }), 1, null)
    expect(slots[1]).toBeNull()
    expect(slots[4]).not.toBeNull()
    expect(hiddenCount(slots, '2x2')).toBe(1)
  })

  it('setSlot 不修改原本的陣列', () => {
    const before = emptySlots()
    setSlot(before, 0, src())
    expect(before[0]).toBeNull()
  })
})

describe('換位（R6）', () => {
  it('AC1：兩格互換，包含聲音設定', () => {
    const slots = slotsWith({ 0: { muted: false, volume: 30 }, 3: { muted: true, volume: 80 } })
    const [a, b] = [slots[0]!, slots[3]!]
    const next = swapSlots(slots, 3, 0)
    expect(next[0]).toBe(b)
    expect(next[3]).toBe(a)
    expect(next[0]!.volume).toBe(80)
  })

  it('AC2：移到空白格，原本的格子變空白', () => {
    const slots = slotsWith({ 0: {} })
    const next = swapSlots(slots, 0, 2)
    expect(next[0]).toBeNull()
    expect(next[2]).toBe(slots[0])
  })

  it('AC3：放回原本的格子不做任何事', () => {
    const slots = slotsWith({ 0: {} })
    expect(swapSlots(slots, 0, 0)).toBe(slots)
  })
})

describe('聲音（R7）', () => {
  it('AC1：沒有任何顯示中的來源有聲音時，新來源有聲音', () => {
    expect(initialMuted(emptySlots(), '2x2')).toBe(false)
    // 已有來源但全部靜音
    expect(initialMuted(slotsWith({ 0: { muted: true }, 1: { muted: true } }), '2x2')).toBe(false)
  })

  it('AC1：已經有顯示中的來源有聲音時，新來源靜音', () => {
    expect(initialMuted(slotsWith({ 1: { muted: false } }), '2x2')).toBe(true)
  })

  it('AC1：有聲音的來源是隱藏的、或音量為 0 時不算', () => {
    expect(initialMuted(slotsWith({ 5: { muted: false } }), '2x2')).toBe(false)
    expect(initialMuted(slotsWith({ 0: { muted: false, volume: 0 } }), '2x2')).toBe(false)
  })

  it('AC2：點擊影片獨占聲音', () => {
    const slots = slotsWith({ 0: { muted: false }, 1: { muted: false }, 2: { muted: true } })
    expect(audible(focusAudio(slots, 2))).toEqual([3])
  })

  it('AC2：點擊空白格不影響聲音', () => {
    const slots = slotsWith({ 0: { muted: false } })
    expect(focusAudio(slots, 3)).toBe(slots)
  })

  it('AC3：喇叭按鈕只切換這一格', () => {
    const slots = slotsWith({ 0: { muted: false }, 1: { muted: true } })
    expect(audible(toggleMute(slots, 1))).toEqual([1, 2])
    expect(audible(toggleMute(slots, 0))).toEqual([])
  })

  it('AC4：只改變這一格的音量，並限制在 0–100 的整數', () => {
    const slots = slotsWith({ 0: { volume: 100 }, 1: { volume: 100 } })
    const next = setVolume(slots, 1, 42.4)
    expect([next[0]!.volume, next[1]!.volume]).toEqual([100, 42])
    expect(setVolume(slots, 0, 150)[0]!.volume).toBe(100)
    expect(setVolume(slots, 0, -5)[0]!.volume).toBe(0)
  })

  it('AC5：取消靜音且音量大於 0 才算有聲音', () => {
    expect(isAudible(src({ muted: false, volume: 1 }))).toBe(true)
    expect(isAudible(src({ muted: false, volume: 0 }))).toBe(false)
    expect(isAudible(src({ muted: true, volume: 100 }))).toBe(false)
  })
})

describe('全部控制（R8）', () => {
  it('AC3：全部靜音，音量設定不變', () => {
    const slots = slotsWith({ 0: { muted: false, volume: 30 }, 1: { muted: false, volume: 70 } })
    const next = muteAll(slots)
    expect(audible(next)).toEqual([])
    expect([next[0]!.volume, next[1]!.volume]).toEqual([30, 70])
  })

  it('AC3：全部靜音後點擊一格，恢復原本的音量', () => {
    const slots = muteAll(slotsWith({ 0: { muted: false, volume: 30 } }))
    const next = focusAudio(slots, 0)
    expect([next[0]!.muted, next[0]!.volume]).toEqual([false, 30])
  })

  it('AC4：只控制顯示中、而且不是錯誤狀態的來源', () => {
    const slots = slotsWith({ 0: {}, 1: {}, 3: {}, 5: {} })
    const statuses: Record<number, PlayStatus> = { [slots[1]!.id]: 'error' }
    expect(controllableIndices(slots, '2x2', statuses)).toEqual([0, 3])
  })

  it('AC5：沒有來源時沒有可控制的對象', () => {
    expect(controllableIndices(emptySlots(), '2x2', {})).toEqual([])
  })
})

describe('快捷鍵（R9）', () => {
  it('對應表', () => {
    expect(shortcutFor(' ')).toEqual({ type: 'toggleAll' })
    expect(shortcutFor('m')).toEqual({ type: 'muteAll' })
    expect(shortcutFor('M')).toEqual({ type: 'muteAll' })
    expect(shortcutFor('1')).toEqual({ type: 'focusAudio', index: 0 })
    expect(shortcutFor('9')).toEqual({ type: 'focusAudio', index: 8 })
    expect(shortcutFor('F11')).toEqual({ type: 'toggleFullscreen' })
    expect(shortcutFor('Escape')).toEqual({ type: 'exitFullscreen' })
  })

  it('其他按鍵不是快捷鍵', () => {
    for (const k of ['0', 'a', 'Enter', 'F5', 'ArrowLeft', '10']) expect(shortcutFor(k)).toBeNull()
  })

  it('Space：任何一格在播放就全部暫停，否則全部播放', () => {
    const slots = slotsWith({ 0: {}, 1: {} })
    const [a, b] = [slots[0]!.id, slots[1]!.id]
    expect(toggleAllAction(slots, '2x2', { [a]: 'paused', [b]: 'playing' })).toBe('pause')
    expect(toggleAllAction(slots, '2x2', { [a]: 'paused', [b]: 'ended' })).toBe('play')
  })

  it('Space：隱藏的來源在播放不算', () => {
    const slots = slotsWith({ 0: {}, 5: {} })
    expect(toggleAllAction(slots, '2x2', { [slots[0]!.id]: 'paused', [slots[5]!.id]: 'playing' })).toBe(
      'play'
    )
  })
})
