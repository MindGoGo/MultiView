// R19：進度條的判斷、換算與時間格式
import { describe, expect, it } from 'vitest'
import {
  DVR_MIN_SECONDS,
  formatBehind,
  formatTime,
  LIVE_EDGE_SECONDS,
  progressFromMedia,
  progressView,
  seekTarget
} from '../../src/lib/progress'

describe('formatTime（R19 時間格式）', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [599, '9:59'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [36000, '10:00:00']
  ])('%d 秒 → %s', (s, text) => {
    expect(formatTime(s)).toBe(text)
  })

  it('負數、NaN、無限大都當作 0', () => {
    expect(formatTime(-3)).toBe('0:00')
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
  })

  it('距離直播的時間前面加負號', () => {
    expect(formatBehind(83)).toBe('-1:23')
  })
})

describe('progressView（R19）', () => {
  it('一般影片：比例是目前時間除以總長度', () => {
    expect(progressView({ current: 30, start: 0, end: 120, live: false })).toEqual({ kind: 'vod', fraction: 0.25, atLive: false })
  })

  it('一般影片長度為 0 時比例為 0', () => {
    expect(progressView({ current: 0, start: 0, end: 0, live: false }).fraction).toBe(0)
  })

  it('AC6：可回放範圍不到 60 秒的直播 → 只顯示 LIVE', () => {
    expect(progressView({ current: 100, start: 50, end: 50 + DVR_MIN_SECONDS - 1, live: true }).kind).toBe('live')
    expect(progressView({ current: 10, start: 10, end: 10, live: true }).kind).toBe('live')
  })

  it('AC5：可回放的直播 → 比例以可回放範圍計算', () => {
    const v = progressView({ current: 1500, start: 1000, end: 2000, live: true })
    expect(v.kind).toBe('dvr')
    expect(v.fraction).toBe(0.5)
    expect(v.atLive).toBe(false)
  })

  it('AC5：距離直播最新位置 10 秒以內視為正在看直播', () => {
    expect(progressView({ current: 2000 - LIVE_EDGE_SECONDS, start: 1000, end: 2000, live: true }).atLive).toBe(true)
    expect(progressView({ current: 2000 - LIVE_EDGE_SECONDS - 1, start: 1000, end: 2000, live: true }).atLive).toBe(false)
  })

  it('比例限制在 0–1', () => {
    expect(progressView({ current: 200, start: 0, end: 100, live: false }).fraction).toBe(1)
    expect(progressView({ current: -5, start: 0, end: 100, live: false }).fraction).toBe(0)
  })
})

describe('seekTarget（R19 AC2、AC3）', () => {
  it('一般影片：點中間跳到一半', () => {
    expect(seekTarget({ current: 0, start: 0, end: 600, live: false }, 0.5)).toBe(300)
  })

  it('直播：以可回放範圍換算', () => {
    expect(seekTarget({ current: 0, start: 1000, end: 2000, live: true }, 0.3)).toBe(1300)
  })

  it('超出範圍的比例會被限制', () => {
    expect(seekTarget({ current: 0, start: 0, end: 100, live: false }, 1.5)).toBe(100)
    expect(seekTarget({ current: 0, start: 0, end: 100, live: false }, -1)).toBe(0)
  })
})

describe('progressFromMedia（mp4、m3u8、網頁影片）', () => {
  it('有固定長度 → 一般影片', () => {
    expect(progressFromMedia({ duration: 600, currentTime: 12, seekable: [[0, 600]] })).toEqual({
      current: 12,
      start: 0,
      end: 600,
      live: false
    })
  })

  it('還不知道長度 → null', () => {
    expect(progressFromMedia({ duration: NaN, currentTime: 0, seekable: [] })).toBeNull()
  })

  it('長度是無限大 → 直播，可回放範圍是 seekable 的第一段開始到最後一段結束', () => {
    expect(progressFromMedia({ duration: Infinity, currentTime: 950, seekable: [[100, 500], [520, 1000]] })).toEqual({
      current: 950,
      start: 100,
      end: 1000,
      live: true
    })
  })

  it('長度超過 10 天（有些網站的直播）→ 直播', () => {
    expect(progressFromMedia({ duration: 2 ** 30, currentTime: 50, seekable: [[0, 60]] })?.live).toBe(true)
  })

  it('直播沒有可回放範圍 → 範圍長度為 0（只顯示 LIVE）', () => {
    const p = progressFromMedia({ duration: Infinity, currentTime: 42, seekable: [] })!
    expect(progressView(p).kind).toBe('live')
  })

  it('播放清單說是直播時，即使有長度也當作直播（hls.js）', () => {
    expect(progressFromMedia({ duration: 300, currentTime: 290, seekable: [[0, 300]], live: true })?.live).toBe(true)
  })

  it('播放清單說不是直播時，依長度判斷為一般影片', () => {
    expect(progressFromMedia({ duration: 634, currentTime: 1, seekable: [[0, 634]], live: false })?.live).toBe(false)
  })
})
