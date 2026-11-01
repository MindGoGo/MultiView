// R78–R82：YouTube 小視窗的網址、留言裡的連結、標題、設定檔
import { describe, expect, it } from 'vitest'
import {
  companionHeader,
  companionLinkAction,
  companionOnTop,
  createMinimizeFollower,
  DEFAULT_COMPANION,
  isCompanionTab,
  liveChatUrl,
  MOBILE_USER_AGENT,
  MOBILE_YOUTUBE_HOME,
  normalizeCompanion,
  parseYouTubeTime,
  stripYouTubeSuffix,
  watchPageUrl
} from '../../src/lib/companion'
import { defaultSettings, parseSettings } from '../../src/lib/settings'
import { resolveBounds } from '../../electron/windowState'

const ID = 'lTRiuFIWV54'
const OTHER = 'BTYAsjAVa3I'

describe('網址（R79、R81、R82）', () => {
  it('影片網頁與彈出式聊天室', () => {
    expect(watchPageUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`)
    expect(liveChatUrl(ID)).toBe(`https://www.youtube.com/live_chat?v=${ID}`)
  })
  it('搜尋分頁是手機版 YouTube，以手機的瀏覽器識別開啟', () => {
    expect(MOBILE_YOUTUBE_HOME).toBe('https://m.youtube.com/')
    expect(MOBILE_USER_AGENT).toMatch(/Android.*Mobile/)
  })
})

describe('parseYouTubeTime（R80）', () => {
  it.each([
    ['195', 195],
    ['195s', 195],
    ['3m15s', 195],
    ['1h2m3s', 3723],
    ['2m', 120],
    ['1h', 3600]
  ])('%s → %d 秒', (raw, seconds) => expect(parseYouTubeTime(raw)).toBe(seconds))
  it.each([null, '', 'abc', 'm', '1x'])('%s 不是時間', (raw) => expect(parseYouTubeTime(raw)).toBeNull())
})

describe('companionLinkAction（R79、R80）', () => {
  it('R80 AC2：同一部影片帶時間的連結 → 跳到那個時間', () => {
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${ID}&t=195s`, ID)).toEqual({ type: 'seek', seconds: 195 })
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${ID}&t=3m15s`, ID)).toEqual({ type: 'seek', seconds: 195 })
  })
  it('同一部影片不帶時間（例如留言的固定連結）→ 不做事', () => {
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${ID}&lc=UgxxbtD13r8EDXCTJDh4AaABAg`, ID)).toBeNull()
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${ID}`, ID)).toBeNull()
  })
  it('R79 AC2、R80：其他影片 → 連結的格子換成那部影片（去掉播放清單等參數）', () => {
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${OTHER}&list=RD${OTHER}&index=2`, ID)).toEqual({
      type: 'play',
      url: `https://www.youtube.com/watch?v=${OTHER}`
    })
  })
  it('其他影片帶時間時仍然是換影片', () => {
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${OTHER}&t=60`, ID)?.type).toBe('play')
  })
  it('格子沒有影片時，任何影片連結都是換影片', () => {
    expect(companionLinkAction(`https://www.youtube.com/watch?v=${ID}&t=10`, null)?.type).toBe('play')
  })
  it('不是 YouTube 影片的連結 → 不做事', () => {
    expect(companionLinkAction('https://www.youtube.com/@LofiGirl', ID)).toBeNull()
    expect(companionLinkAction('https://example.com/watch?v=abc', ID)).toBeNull()
  })
})

describe('companionHeader（R78）', () => {
  it('AC1：第 N 格：影片名稱', () => {
    expect(companionHeader({ cell: 2, video: { id: ID, title: '1 A.M Study Session', live: false } })).toBe(
      '第 2 格：1 A.M Study Session'
    )
  })
  it('還不知道名稱時顯示讀取中', () => {
    expect(companionHeader({ cell: 3, video: { id: ID, title: null, live: false } })).toBe('第 3 格：（讀取中）')
  })
  it('AC4：這一格沒有 YouTube 影片時只顯示格子（內容區顯示說明）', () => {
    expect(companionHeader({ cell: 3, video: null })).toBe('第 3 格')
  })
  it('還沒從格子開啟過時提示從格子選擇', () => {
    expect(companionHeader({ cell: null, video: null })).toContain('YouTube ▾')
  })
  it('網頁標題去掉結尾的「 - YouTube」', () => {
    expect(stripYouTubeSuffix('Lofi - YouTube')).toBe('Lofi')
    expect(stripYouTubeSuffix(null)).toBeNull()
  })
})

describe('小視窗的設定（R78 AC5）', () => {
  it('第一次開啟是「搜尋」分頁，沒有記錄位置', () => {
    expect(defaultSettings().companion).toEqual({ width: 480, height: 760, tab: 'search', pinned: false })
    expect(DEFAULT_COMPANION.x).toBeUndefined()
  })
  it('位置、大小與上次的分頁原樣讀回', () => {
    const s = { ...defaultSettings(), companion: { x: 1200, y: 150, width: 420, height: 700, tab: 'comments', pinned: true } }
    expect(parseSettings(JSON.stringify(s)).settings.companion).toEqual(s.companion)
  })
  it('舊的設定檔沒有小視窗的設定時用預設值', () => {
    const { companion, ...old } = defaultSettings()
    expect(companion).toBeDefined()
    expect(parseSettings(JSON.stringify(old)).settings.companion).toEqual(DEFAULT_COMPANION)
  })
  it('不合法的欄位換成預設值', () => {
    expect(normalizeCompanion({ x: 'a', y: 1, width: -5, height: 600, tab: 'video' })).toEqual({
      width: 480,
      height: 600,
      tab: 'search',
      pinned: false
    })
    expect(normalizeCompanion(null)).toEqual(DEFAULT_COMPANION)
  })
  it('分頁名稱的判斷', () => {
    expect(['related', 'comments', 'chat', 'search'].every(isCompanionTab)).toBe(true)
    expect(isCompanionTab('page')).toBe(false)
  })
  it('還原位置時使用小視窗自己的最小大小（比主視窗小）', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 }
    const saved = { x: 1200, y: 150, width: 400, height: 500 }
    expect(resolveBounds(saved, [primary], primary, { width: 360, height: 400 })).toEqual(saved)
    // 主視窗的最小大小不變
    expect(resolveBounds(saved, [primary], primary).width).toBe(480)
  })
})

describe('置頂（R84）', () => {
  it('0.6.0 的設定檔沒有置頂時視為關閉', () => {
    expect(normalizeCompanion({ width: 420, height: 700, tab: 'related' }).pinned).toBe(false)
    expect(normalizeCompanion({ width: 420, height: 700, tab: 'related', pinned: 'yes' }).pinned).toBe(false)
  })
  it('小視窗自己置頂，或主視窗置頂時，小視窗放在其他程式上面', () => {
    expect(companionOnTop(false, false)).toBe(false)
    expect(companionOnTop(true, false)).toBe(true)
    expect(companionOnTop(false, true)).toBe(true)
    expect(companionOnTop(true, true)).toBe(true)
  })
})

describe('和主視窗一起縮小、一起還原（R85）', () => {
  it('AC1：主視窗縮小時一起縮小，還原時一起還原', () => {
    const f = createMinimizeFollower()
    expect(f.mainMinimized(false)).toBe(true)
    expect(f.mainRestored()).toBe(true)
  })
  it('AC2：小視窗原本就縮小時，主視窗還原不還原小視窗', () => {
    const f = createMinimizeFollower()
    expect(f.mainMinimized(true)).toBe(false)
    expect(f.mainRestored()).toBe(false)
  })
  it('主視窗縮小期間使用者自己還原了小視窗，之後主視窗還原時不再處理', () => {
    const f = createMinimizeFollower()
    f.mainMinimized(false)
    f.companionRestored()
    expect(f.mainRestored()).toBe(false)
  })
  it('還原後再縮小一次也正確', () => {
    const f = createMinimizeFollower()
    f.mainMinimized(false)
    f.mainRestored()
    expect(f.mainRestored()).toBe(false)
    expect(f.mainMinimized(false)).toBe(true)
    expect(f.mainRestored()).toBe(true)
  })
})
