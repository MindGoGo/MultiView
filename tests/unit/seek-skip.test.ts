// R51：快轉、倒轉 5 秒
import { describe, expect, it } from 'vitest'
import { skipTarget, type Progress } from '../../src/lib/progress'
import { guestKeyAction, isRepeatableKey, shortcutFor, SKIP_SECONDS } from '../../src/lib/shortcuts'

const vod = (current: number, end = 600): Progress => ({ current, start: 0, end, live: false })

describe('skipTarget（R51）', () => {
  it('一般影片前後 5 秒（AC1）', () => {
    expect(skipTarget(vod(60), 5)).toBe(65)
    expect(skipTarget(vod(60), -5)).toBe(55)
  })

  it('不超出開頭和結尾（AC4）', () => {
    expect(skipTarget(vod(3), -5)).toBe(0)
    expect(skipTarget(vod(598), 5)).toBe(600)
  })

  it('可回放的直播：限制在可回放範圍與最新位置之間', () => {
    const dvr: Progress = { current: 1000, start: 900, end: 1200, live: true }
    expect(skipTarget(dvr, -5)).toBe(995)
    expect(skipTarget({ ...dvr, current: 902 }, -5)).toBe(900)
    expect(skipTarget({ ...dvr, current: 1198 }, 5)).toBe(1200)
  })

  it('沒有回放範圍的直播不動作', () => {
    expect(skipTarget({ current: 50, start: 40, end: 50, live: true }, 5)).toBeNull()
  })
})

describe('方向鍵（R51）', () => {
  it('→ 快轉、← 倒轉 5 秒', () => {
    expect(SKIP_SECONDS).toBe(5)
    expect(shortcutFor('ArrowRight')).toEqual({ type: 'skip', seconds: 5 })
    expect(shortcutFor('ArrowLeft')).toEqual({ type: 'skip', seconds: -5 })
  })

  it('只有方向鍵按住時連續作用（AC5）', () => {
    expect(isRepeatableKey('ArrowLeft')).toBe(true)
    expect(isRepeatableKey('ArrowRight')).toBe(true)
    for (const k of [' ', 'm', '1', 'F11', 'Escape', 'ArrowUp']) expect(isRepeatableKey(k)).toBe(false)
  })

  it('網頁來源有焦點時：影片模式轉給程式，整頁模式交給網頁捲動', () => {
    expect(guestKeyAction('ArrowRight', 'video')).toBe('forward')
    expect(guestKeyAction('ArrowRight', 'page')).toBe('page')
  })
})
