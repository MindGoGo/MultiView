// SponsorBlock 的規則（R161）：和手機版 SponsorBlockTest.kt 相同的案例
import { describe, expect, it } from 'vitest'
import {
  checkSkip,
  markHandled,
  normalizeSponsorBlock,
  parseSegments,
  segmentAt,
  segmentMarks,
  selectSegments,
  skippedLabel,
  sponsorActive,
  sponsorRequestUrl,
  SPONSOR_CATEGORIES,
  userSeeked,
  type SkipState,
  type SponsorCategory,
  type SponsorSegment
} from '../../src/lib/sponsorBlock'
import { createSponsorClient, hashPrefix } from '../../electron/sponsorBlock'
import { normalizeSettings, parseSettings } from '../../src/lib/settings'

const seg = (start: number, end: number, id: string, category: SponsorCategory = 'sponsor'): SponsorSegment => ({
  start,
  end,
  category,
  id
})
const empty: SkipState = new Set()
const item = (start: unknown, end: unknown, opts: { category?: string; uuid?: string; action?: string | null } = {}) => {
  const out: Record<string, unknown> = { segment: [start, end], category: opts.category ?? 'sponsor', UUID: opts.uuid ?? 'u', videoDuration: 600 }
  if (opts.action !== null) out.actionType = opts.action ?? 'skip'
  return out
}
const response = (...videos: [string, unknown[]][]) =>
  JSON.stringify(videos.map(([videoID, segments]) => ({ videoID, hash: 'x', segments })))

describe('請求', () => {
  it('雜湊前綴是 SHA-256 的前 4 碼', () => {
    expect(hashPrefix('dQw4w9WgXcQ')).toBe('5f6b')
    expect(hashPrefix('abc')).toBe('ba78')
  })

  it('請求網址', () => {
    expect(sponsorRequestUrl('5f6b', ['sponsor'])).toBe(
      'https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%5D'
    )
    // 順序固定（照類別的定義順序），不管傳進來的順序
    expect(sponsorRequestUrl('5f6b', ['intro', 'sponsor'])).toBe(
      'https://sponsor.ajay.app/api/skipSegments/5f6b?categories=%5B%22sponsor%22%2C%22intro%22%5D'
    )
    const all = sponsorRequestUrl('5f6b')
    for (const c of SPONSOR_CATEGORIES) expect(all).toContain(`%22${c.id}%22`)
  })
})

describe('解析', () => {
  it('只取這部影片、要跳過的片段', () => {
    const text = response(
      ['other', [item(1, 50, { uuid: 'o1' })]],
      [
        'vid',
        [
          item(30.5, 60.25, { uuid: 'a' }),
          item(100, 120, { category: 'intro', uuid: 'b' }),
          item(200, 210, { action: 'mute', uuid: 'c' }),
          item(300, 300, { category: 'poi_highlight', action: 'poi', uuid: 'd' }),
          item(0, 600, { action: 'full', uuid: 'e' }),
          item(400, 420, { category: 'exclusive_access', uuid: 'f' }),
          item(500, 490, { uuid: 'g' }),
          item('x', 10, { uuid: 'h' }),
          item(5, 15, { action: null, uuid: 'i' })
        ]
      ]
    )
    expect(parseSegments(text, 'vid')).toEqual([seg(30.5, 60.25, 'a'), seg(100, 120, 'b', 'intro'), seg(5, 15, 'i')])
    expect(parseSegments(text, 'missing')).toEqual([])
  })

  it('格式不對的回應是空的', () => {
    expect(parseSegments('', 'vid')).toEqual([])
    expect(parseSegments('Not Found', 'vid')).toEqual([])
    expect(parseSegments('{"videoID":"vid"}', 'vid')).toEqual([])
    expect(parseSegments('[{"videoID":"vid","segments":5}]', 'vid')).toEqual([])
  })

  it('沒有 UUID 時用類別@開始秒；開始小於 0 改成 0', () => {
    const text = JSON.stringify([{ videoID: 'v', segments: [{ segment: [-2, 10], category: 'intro' }] }])
    expect(parseSegments(text, 'v')).toEqual([seg(0, 10, 'intro@-2', 'intro')])
  })
})

describe('過濾與合併', () => {
  const raw = [
    seg(100, 130, 'late'),
    seg(10, 40, 'first'),
    seg(35, 50, 'overlap'),
    seg(50, 55, 'touching'),
    seg(70, 70.5, 'short'),
    seg(80, 90, 'intro', 'intro'),
    seg(12, 20, 'inside')
  ]

  it('預設只跳過業配；太短的不要；重疊、相接的合併', () => {
    expect(selectSegments(raw, { enabled: true, categories: ['sponsor'] })).toEqual([seg(10, 55, 'first'), seg(100, 130, 'late')])
    expect(selectSegments(raw, { enabled: true, categories: ['sponsor', 'intro'] })).toEqual([
      seg(10, 55, 'first'),
      seg(80, 90, 'intro', 'intro'),
      seg(100, 130, 'late')
    ])
  })

  it('不同類別重疊也合併成一段（類別用最早開始的）', () => {
    expect(
      selectSegments([seg(20, 30, 'b', 'outro'), seg(10, 25, 'a')], { enabled: true, categories: ['sponsor', 'outro'] })
    ).toEqual([seg(10, 30, 'a')])
  })

  it('關閉或沒有勾選類別時是空的；剛好 1 秒的保留', () => {
    expect(selectSegments(raw, { enabled: false, categories: ['sponsor'] })).toEqual([])
    expect(selectSegments(raw, { enabled: true, categories: [] })).toEqual([])
    expect(selectSegments([seg(5, 6, 'x')], { enabled: true, categories: ['sponsor'] })).toHaveLength(1)
  })

  it('不改到傳進來的片段', () => {
    const input = [seg(10, 40, 'a'), seg(30, 50, 'b')]
    selectSegments(input, { enabled: true, categories: ['sponsor'] })
    expect(input[0]).toEqual(seg(10, 40, 'a'))
  })
})

describe('自動跳過', () => {
  const segments = [seg(10, 40, 'a'), seg(100, 130, 'b')]

  it('跳到片段結尾', () => {
    expect(checkSkip(segments, empty, 9.9, 600)).toBeNull()
    expect(checkSkip(segments, empty, 10, 600)).toEqual({ segment: segments[0], target: 40 })
    expect(checkSkip(segments, empty, 25, 600)).toEqual({ segment: segments[0], target: 40 })
    // 已經在結尾：不跳
    expect(checkSkip(segments, empty, 39.8, 600)).toBeNull()
    expect(checkSkip(segments, empty, 40, 600)).toBeNull()
    expect(checkSkip(segments, empty, 101, 600)).toEqual({ segment: segments[1], target: 130 })
    // 不知道影片長度：照樣跳到片段結尾
    expect(checkSkip(segments, empty, 11, NaN)).toEqual({ segment: segments[0], target: 40 })
    expect(checkSkip(segments, empty, NaN, 600)).toBeNull()
    expect(checkSkip([], empty, 11, 600)).toBeNull()
  })

  it('片段結尾在影片最後 1 秒內時視為播完', () => {
    const outro = seg(570, 599.2, 'end')
    expect(checkSkip([outro], empty, 580, 600)).toEqual({ segment: outro, target: 600 })
    const over = seg(570, 605, 'over')
    expect(checkSkip([over], empty, 580, 600)).toEqual({ segment: over, target: 600 })
    const before = seg(570, 598.5, 'before')
    expect(checkSkip([before], empty, 580, 600)).toEqual({ segment: before, target: 598.5 })
  })

  it('跳過的片段倒回去看不再跳', () => {
    const one = [seg(10, 40, 'a')]
    const action = checkSkip(one, empty, 10.2, 600)!
    const state = markHandled(empty, action.segment)
    expect(checkSkip(one, state, 12, 600)).toBeNull()
    // 取消（跳回片段開頭）也一樣
    expect(checkSkip(one, state, 10, 600)).toBeNull()
  })

  it('使用者自己跳進片段裡不跳', () => {
    const state = userSeeked(empty, segments, 20)
    expect([...state]).toEqual(['a'])
    expect(checkSkip(segments, state, 20.25, 600)).toBeNull()
    expect(checkSkip(segments, state, 100.1, 600)?.segment.id).toBe('b')
    // 跳到片段外面：不影響
    expect(userSeeked(empty, segments, 50)).toBe(empty)
    // 跳到片段前面，播放進入片段：照樣跳
    const before = userSeeked(empty, segments, 5)
    expect(checkSkip(segments, before, 10.1, 600)).toEqual({ segment: segments[0], target: 40 })
  })

  it('每一格的狀態各自獨立', () => {
    const one = [seg(10, 40, 'a')]
    const cell1 = markHandled(empty, one[0])
    expect(checkSkip(one, cell1, 12, 600)).toBeNull()
    expect(checkSkip(one, empty, 12, 600)?.target).toBe(40)
    // 標記不改到原本的狀態
    expect(empty.size).toBe(0)
  })
})

describe('提示與進度條', () => {
  it('提示文字與所在片段', () => {
    expect(skippedLabel('sponsor')).toBe('已跳過業配')
    expect(skippedLabel('intro')).toBe('已跳過開場')
    const segments = [seg(10, 40, 'a'), seg(100, 130, 'b')]
    expect(segmentAt(segments, 100)?.id).toBe('b')
    expect(segmentAt(segments, 40)).toBeNull()
    expect(segmentAt(segments, 5)).toBeNull()
  })

  it('色塊比例', () => {
    const segments = [seg(0, 60, 'a'), seg(150, 300, 'b', 'outro'), seg(310, 400, 'c')]
    expect(segmentMarks(segments, 300)).toEqual([
      { start: 0, end: 0.2, category: 'sponsor' },
      { start: 0.5, end: 1, category: 'outro' }
    ])
    expect(segmentMarks(segments, NaN)).toEqual([])
    expect(segmentMarks(segments, 0)).toEqual([])
  })
})

describe('設定', () => {
  it('預設值與正規化', () => {
    expect(normalizeSponsorBlock(undefined)).toEqual({ enabled: true, categories: ['sponsor'] })
    expect(normalizeSponsorBlock('x')).toEqual({ enabled: true, categories: ['sponsor'] })
    expect(normalizeSponsorBlock({ enabled: false, categories: ['filler', 'intro', 'bogus', 3] })).toEqual({
      enabled: false,
      categories: ['intro', 'filler']
    })
    // 欄位不合法時各自用預設值；空的類別清單保留
    expect(normalizeSponsorBlock({ enabled: 'no', categories: [] })).toEqual({ enabled: true, categories: [] })
    expect(sponsorActive({ enabled: true, categories: ['sponsor'] })).toBe(true)
    expect(sponsorActive({ enabled: true, categories: [] })).toBe(false)
  })

  it('設定檔的 sponsorBlock 欄位', () => {
    const s = normalizeSettings({ version: 1, sponsorBlock: { enabled: false, categories: ['outro', 'sponsor'] } })!
    expect(s.sponsorBlock).toEqual({ enabled: false, categories: ['sponsor', 'outro'] })
    const round = parseSettings(JSON.stringify(s)).settings
    expect(round.sponsorBlock).toEqual(s.sponsorBlock)
    // 舊的設定檔沒有這個欄位：預設開啟、只跳過業配
    expect(parseSettings('{"version":1}').settings.sponsorBlock).toEqual({ enabled: true, categories: ['sponsor'] })
  })

  it('類別代碼和 API 相同', () => {
    expect(SPONSOR_CATEGORIES.map((c) => c.id)).toEqual([
      'sponsor',
      'selfpromo',
      'interaction',
      'intro',
      'outro',
      'preview',
      'filler',
      'music_offtopic'
    ])
  })
})

describe('請求與快取', () => {
  const ok = (text: string) => ({ status: 200, text: async () => text })

  it('同一部影片只抓一次；404 是沒有片段', async () => {
    const urls: string[] = []
    const client = createSponsorClient(async (url) => {
      urls.push(url)
      return url.includes(hashPrefix('vid')) ? ok(response(['vid', [item(10, 40, { uuid: 'a' })]])) : { status: 404, text: async () => '' }
    })
    const [a, b] = await Promise.all([client.segments('vid'), client.segments('vid')])
    expect(a).toEqual([seg(10, 40, 'a')])
    expect(b).toEqual(a)
    expect(await client.segments('nothing')).toEqual([])
    await client.segments('nothing')
    expect(urls).toHaveLength(2)
  })

  it('送出 User-Agent；失敗不留在快取，下次再試', async () => {
    let calls = 0
    const client = createSponsorClient(async (_url, init) => {
      calls++
      expect(init.headers['User-Agent']).toBe('MultiView')
      if (calls === 1) throw new Error('offline')
      if (calls === 2) return { status: 500, text: async () => '' }
      return ok(response(['vid', [item(1, 5, { uuid: 'a' })]]))
    })
    expect(await client.segments('vid')).toEqual([])
    expect(await client.segments('vid')).toEqual([])
    expect(await client.segments('vid')).toEqual([seg(1, 5, 'a')])
    expect(calls).toBe(3)
  })

  it('逾時當作沒有片段', async () => {
    const client = createSponsorClient(
      (_url, init) =>
        new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))),
      20
    )
    expect(await client.segments('vid')).toEqual([])
  })
})
