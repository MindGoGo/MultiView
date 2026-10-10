// R50：YouTube 預覽縮圖資訊的解析與計算
import { describe, expect, it } from 'vitest'
import { extractStoryboardSpec, parseStoryboard, storyboardFrame } from '../../src/lib/storyboard'

// 2026-10-10 從 YouTube 網頁取得的實際格式（簽章已縮短）
const BASE = 'https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L$L/$N.jpg?sqp=abc'
const SPEC = `${BASE}|48#27#100#10#10#0#default#rs$AAA|60#45#122#10#10#10000#M$M#rs$BBB|120#90#122#5#5#10000#M$M#rs$CCC`

describe('extractStoryboardSpec', () => {
  it('從 HTML 取出縮圖資訊並還原 &', () => {
    const html = `...,"playerStoryboardSpecRenderer":{"spec":"https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg?sqp=a\\u0026b=1|48#27#100#10#10#0#default#rs$A"},...`
    expect(extractStoryboardSpec(html)).toBe('https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg?sqp=a&b=1|48#27#100#10#10#0#default#rs$A')
  })

  it('直播（只有 playerLiveStoryboardSpecRenderer）或沒有時回傳 null', () => {
    expect(extractStoryboardSpec('"playerLiveStoryboardSpecRenderer":{"spec":"x"}')).toBeNull()
    expect(extractStoryboardSpec('<html></html>')).toBeNull()
  })
})

describe('parseStoryboard', () => {
  it('選寬度不超過 320 的等級中最大的，略過沒有間隔時間的等級 0', () => {
    const sb = parseStoryboard(SPEC)!
    expect(sb.level).toBe(2)
    expect(sb.info).toMatchObject({ width: 120, height: 90, count: 122, cols: 5, rows: 5, intervalMs: 10000, name: 'M$M', sigh: 'rs$CCC' })
  })

  it('寬度超過 320 的等級不選', () => {
    const sb = parseStoryboard(`${SPEC}|640#360#122#3#3#10000#M$M#rs$DDD`)!
    expect(sb.level).toBe(2)
  })

  it('格式不對時回傳 null', () => {
    expect(parseStoryboard('')).toBeNull()
    expect(parseStoryboard('not a url|1#2')).toBeNull()
    expect(parseStoryboard(`${BASE}|48#27#100#10#10#0#default#rs$AAA`)).toBeNull()
  })
})

describe('storyboardFrame', () => {
  const sb = parseStoryboard(SPEC)!

  it('0 秒是第 0 頁左上角', () => {
    expect(storyboardFrame(sb, 0, 1204)).toEqual({
      url: 'https://i.ytimg.com/sb/iG9CE55wbtY/storyboard3_L2/M0.jpg?sqp=abc&sigh=rs$CCC',
      x: 0,
      y: 0,
      width: 120,
      height: 90,
      sheetWidth: 600,
      sheetHeight: 450
    })
  })

  it('362 秒 → 第 36 張 → 第 1 頁第 11 張（第 2 列第 1 張）', () => {
    const f = storyboardFrame(sb, 362, 1204)
    expect(f.url).toContain('/storyboard3_L2/M1.jpg')
    expect([f.x, f.y]).toEqual([120, 180])
  })

  it('超過長度或張數時用最後一張', () => {
    const f = storyboardFrame(sb, 99999, 1204)
    // 長度 1204 秒 → 第 120 張 → 第 4 頁第 20 張（第 4 列第 0 張）
    expect(f.url).toContain('/M4.jpg')
    expect([f.x, f.y]).toEqual([0, 360])
    expect(storyboardFrame(sb, 5000, 5000).url).toContain('/M4.jpg')
  })

  it('負的秒數當作 0', () => {
    expect(storyboardFrame(sb, -5, 100)).toMatchObject({ x: 0, y: 0 })
  })
})
