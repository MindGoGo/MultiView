// R20：單格全螢幕時「顯示中的來源」只有放大的那一格
import { describe, expect, it } from 'vitest'
import { emptySlots, isVisible, setSlot, type Slots, type Source } from '../../src/lib/slots'
import { controllableIndices, toggleAllAction } from '../../src/lib/playback'
import { initialMuted } from '../../src/lib/audio'
import type { PlayStatus } from '../../src/players/types'

let nextId = 5000
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
    captions: null,
    brightness: 100,
    youtubeWeb: false,
    resume: null,
    ...over
  }
}

function four(): Slots {
  let s = emptySlots()
  for (let i = 0; i < 4; i++) s = setSlot(s, i, src())
  // 第 5 格是版型外的隱藏來源
  return setSlot(s, 4, src())
}

describe('isVisible 與單格全螢幕（R20 共用定義）', () => {
  it('沒有單格全螢幕時依版型判斷', () => {
    expect(isVisible(3, '2x2')).toBe(true)
    expect(isVisible(4, '2x2')).toBe(false)
    expect(isVisible(3, '2x2', null)).toBe(true)
  })

  it('單格全螢幕時只有放大的那一格顯示中', () => {
    expect(isVisible(1, '2x2', 1)).toBe(true)
    expect(isVisible(0, '2x2', 1)).toBe(false)
    expect(isVisible(4, '2x2', 1)).toBe(false)
  })
})

describe('單格全螢幕時的全部控制（R20 AC5）', () => {
  it('全部播放／暫停只作用在放大的那一格', () => {
    const slots = four()
    expect(controllableIndices(slots, '2x2', {}, 2)).toEqual([2])
    expect(controllableIndices(slots, '2x2', {})).toEqual([0, 1, 2, 3])
  })

  it('Space：只看放大的那一格有沒有在播放', () => {
    const slots = four()
    const statuses: Record<number, PlayStatus> = { [slots[0]!.id]: 'playing', [slots[2]!.id]: 'paused' }
    // 第 1 格在播放，但放大的是第 3 格（暫停）→ 全部播放
    expect(toggleAllAction(slots, '2x2', statuses, 2)).toBe('play')
    expect(toggleAllAction(slots, '2x2', statuses)).toBe('pause')
  })

  it('新來源的聲音規則只看放大的那一格', () => {
    const slots = setSlot(four(), 0, src({ muted: false }))
    // 第 1 格有聲音，但放大的是第 2 格（靜音）→ 新來源有聲音
    expect(initialMuted(slots, '2x2', 1)).toBe(false)
    expect(initialMuted(slots, '2x2')).toBe(true)
  })
})
