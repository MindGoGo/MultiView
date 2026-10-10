// R55：記住觀看進度
import { describe, expect, it } from 'vitest'
import { RESUME_MARGIN_SECONDS, resumePosition, type Progress } from '../../src/lib/progress'
import { normalizeView } from '../../src/lib/settings'

const vod = (current: number, end = 1200): Progress => ({ current, start: 0, end, live: false })
const YT = 'https://www.youtube.com/watch?v=iG9CE55wbtY'

describe('resumePosition（R55）', () => {
  it('點播影片保存目前的位置（四捨五入到 0.1 秒）', () => {
    expect(resumePosition(vod(180))).toBe(180)
    expect(resumePosition(vod(183.24))).toBe(183.2)
  })

  it('還不到 5 秒、距離結尾不到 5 秒、播完時不保存（AC5、AC10）', () => {
    expect(RESUME_MARGIN_SECONDS).toBe(5)
    expect(resumePosition(vod(4.9))).toBeNull()
    expect(resumePosition(vod(5))).toBe(5)
    expect(resumePosition(vod(1196))).toBeNull()
    expect(resumePosition(vod(600), true)).toBeNull()
  })

  it('直播不保存（AC4）', () => {
    expect(resumePosition({ current: 1000, start: 900, end: 1200, live: true })).toBeNull()
    expect(resumePosition({ current: 50, start: 50, end: 50, live: true })).toBeNull()
  })

  it('還不知道進度時不保存', () => {
    expect(resumePosition(null)).toBeNull()
  })
})

describe('設定檔中的觀看進度（R55 AC8）', () => {
  it('保存的位置讀回不變', () => {
    expect(normalizeView({ slots: [{ url: YT, position: 183.2 }] }).slots[0]?.position).toBe(183.2)
  })

  it('舊的設定檔或不合法的值 → 從頭開始', () => {
    const v = normalizeView({ slots: [{ url: YT }, { url: YT, position: -3 }, { url: YT, position: '60' }, { url: YT, position: 0 }] })
    expect(v.slots.slice(0, 4).map((s) => s?.position)).toEqual([null, null, null, null])
  })
})
