// R13：找不到影片時自動切換整頁模式；R14：焦點在網頁裡時的按鍵；R15：播放意圖
import { describe, expect, it } from 'vitest'
import { intentFromReport, shouldWaitForVideo } from '../../src/lib/webPlayback'
import { guestKeyAction } from '../../src/lib/shortcuts'
import type { WebState } from '../../src/players/webTypes'

const state = (over: Partial<WebState> = {}): WebState => ({
  v: 5,
  mode: 'page',
  intent: 'pause',
  volume: 100,
  muted: true,
  ...over
})

describe('intentFromReport（R15 播放意圖）', () => {
  it('AC7：整頁模式中網站開始播放 → 播放意圖改成播放', () => {
    expect(intentFromReport(state({ intent: 'pause' }), { status: 'playing', v: 5 })).toBe('play')
  })

  it('AC7：整頁模式中按了網站的暫停 → 播放意圖改成暫停', () => {
    expect(intentFromReport(state({ intent: 'play' }), { status: 'paused', v: 5 })).toBe('pause')
  })

  it('AC5：影片模式中網站自己開始播放，不改變播放意圖（由網頁端暫停）', () => {
    expect(intentFromReport(state({ mode: 'video', intent: 'pause' }), { status: 'playing', v: 5 })).toBeNull()
  })

  it('比剛送出的操作還舊的回報不採用（例如剛按了全部播放，回報還是暫停）', () => {
    expect(intentFromReport(state({ intent: 'play', v: 6 }), { status: 'paused', v: 5 })).toBeNull()
  })

  it('載入中、播完或沒有主要影片時不改變', () => {
    expect(intentFromReport(state({ intent: 'play' }), { status: 'loading', v: 5 })).toBeNull()
    expect(intentFromReport(state({ intent: 'play' }), { status: 'ended', v: 5 })).toBeNull()
    expect(intentFromReport(state({ intent: 'play' }), { status: null, v: 5 })).toBeNull()
  })

  it('已經一致時不改變', () => {
    expect(intentFromReport(state({ intent: 'play' }), { status: 'playing', v: 5 })).toBeNull()
    expect(intentFromReport(state({ intent: 'pause' }), { status: 'paused', v: 5 })).toBeNull()
  })
})

describe('shouldWaitForVideo（R13 AC4、AC3-3）', () => {
  const base = { mode: 'video' as const, loaded: true, found: false, failed: false }

  it('影片模式、網頁已載入、沒有主要影片時開始計時', () => {
    expect(shouldWaitForVideo(base)).toBe(true)
  })

  const cases: [Parameters<typeof shouldWaitForVideo>[0], string][] = [
    [{ ...base, mode: 'page' }, '整頁模式'],
    [{ ...base, loaded: false }, '網頁還沒載入完成'],
    [{ ...base, found: true }, '已經找到主要影片'],
    [{ ...base, failed: true }, '錯誤狀態']
  ]
  it.each(cases)('%o 時不計時（%s）', (p) => {
    expect(shouldWaitForVideo(p)).toBe(false)
  })
})

describe('guestKeyAction：焦點在網頁裡時的按鍵（R14、R9 AC3）', () => {
  it('AC6：F11 不論模式都切換全螢幕', () => {
    expect(guestKeyAction('F11', 'page')).toBe('fullscreen')
    expect(guestKeyAction('F11', 'video')).toBe('fullscreen')
  })

  it.each([' ', 'm', 'M', '1', '9', 'Escape', 'a'])('AC4、AC6：整頁模式下 %j 交給網頁', (key) => {
    expect(guestKeyAction(key, 'page')).toBe('page')
  })

  it.each([' ', 'm', '2', 'Escape'])('影片模式（直接操作）下快捷鍵 %j 轉給程式', (key) => {
    expect(guestKeyAction(key, 'video')).toBe('forward')
  })

  it('影片模式下不是快捷鍵的按鍵交給網頁', () => {
    expect(guestKeyAction('a', 'video')).toBeNull()
    expect(guestKeyAction('0', 'video')).toBeNull()
  })

  it('還不知道模式時（剛載入）視同影片模式', () => {
    expect(guestKeyAction(' ', undefined)).toBe('forward')
  })
})
