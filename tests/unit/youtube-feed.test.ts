// R59：訂閱頻道與最新影片；R60：直播狀態；R61：Google Takeout 匯入
import { describe, expect, it } from 'vitest'
import {
  channelLookupUrl,
  countNew,
  decodeEntities,
  extractChannelInfo,
  formatAgo,
  isChannelId,
  parseFeed,
  parseLiveStatus,
  parseTakeoutCsv
} from '../../src/lib/youtubeFeed'
import { addChannel, addChannels, CHANNEL_ERROR, emptyLists, normalizeLists, removeChannel } from '../../src/lib/lists'

const ID = 'UCAuUUnT6oDeKwE6v1NGQxug'
const ID2 = 'UCSJ4gkVC6NrvII8umztf0Ow'

describe('channelLookupUrl（R59）', () => {
  it('頻道網址的各種寫法', () => {
    expect(channelLookupUrl('https://www.youtube.com/@TED')).toEqual({ page: 'https://www.youtube.com/@TED', kind: 'channel' })
    expect(channelLookupUrl('https://www.youtube.com/@TED/videos')).toEqual({ page: 'https://www.youtube.com/@TED', kind: 'channel' })
    expect(channelLookupUrl(`https://www.youtube.com/channel/${ID}`)).toEqual({
      page: `https://www.youtube.com/channel/${ID}`,
      kind: 'channel'
    })
    expect(channelLookupUrl('https://www.youtube.com/c/TEDtalksDirector')?.kind).toBe('channel')
    expect(channelLookupUrl('https://www.youtube.com/user/TEDtalksDirector')?.kind).toBe('channel')
  })

  it('影片網址 → 讀取影片頁取得頻道（AC2）', () => {
    expect(channelLookupUrl('https://youtu.be/jfKfPfyJRdk')).toEqual({
      page: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      kind: 'video'
    })
  })

  it('不是頻道或影片 → null（AC3）', () => {
    expect(channelLookupUrl('https://example.com')).toBeNull()
    expect(channelLookupUrl('https://www.youtube.com/')).toBeNull()
    expect(channelLookupUrl('https://www.youtube.com/results?search_query=x')).toBeNull()
    expect(channelLookupUrl('https://www.youtube.com/channel/abc')).toBeNull()
    expect(channelLookupUrl('不是網址')).toBeNull()
  })
})

describe('extractChannelInfo（R59）', () => {
  it('頻道頁：externalId 與 og:title', () => {
    const html = `<meta property="og:title" content="TED &amp; Friends">..."externalId":"${ID}"...`
    expect(extractChannelInfo(html, 'channel')).toEqual({ id: ID, name: 'TED & Friends' })
  })

  it('頻道頁沒有 externalId 時用 canonical 網址', () => {
    const html = `<link rel="canonical" href="https://www.youtube.com/channel/${ID}"><meta property="og:title" content="TED">`
    expect(extractChannelInfo(html, 'channel')).toEqual({ id: ID, name: 'TED' })
  })

  it('影片頁：channelId 與 ownerChannelName（JSON 跳脫）', () => {
    const html = `"channelId":"${ID2}","ownerChannelName":"Lofi Girl \\u0026 Co"`
    expect(extractChannelInfo(html, 'video')).toEqual({ id: ID2, name: 'Lofi Girl & Co' })
  })

  it('取不到時回傳 null', () => {
    expect(extractChannelInfo('<html></html>', 'channel')).toBeNull()
    expect(extractChannelInfo('<html></html>', 'video')).toBeNull()
  })
})

describe('parseFeed（R59）', () => {
  const entry = (id: string, title: string, published: string) =>
    `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${published}</published></entry>`

  it('取出影片代碼、標題、發布時間，新的在上面', () => {
    const xml = `<feed>${entry('aaaaaaaaaaa', 'Old &amp; Gold', '2026-10-01T00:00:00+00:00')}${entry('bbbbbbbbbbb', 'New', '2026-10-10T12:00:18+00:00')}</feed>`
    expect(parseFeed(xml)).toEqual([
      { videoId: 'bbbbbbbbbbb', title: 'New', published: Date.parse('2026-10-10T12:00:18+00:00') },
      { videoId: 'aaaaaaaaaaa', title: 'Old & Gold', published: Date.parse('2026-10-01T00:00:00+00:00') }
    ])
  })

  it('沒有影片的頻道是空陣列；不是摘要時是 null（AC6 的錯誤顯示）', () => {
    expect(parseFeed('<feed></feed>')).toEqual([])
    expect(parseFeed('<html>error</html>')).toBeNull()
  })
})

describe('新影片數量與發布時間（R59）', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  it('24 小時內發布的才算新影片', () => {
    const v = (h: number) => ({ videoId: 'x', title: '', published: now - h * 3600000 })
    expect(countNew([v(1), v(23.9), v(24), v(48)], now)).toBe(2)
  })

  it('發布時間的說明', () => {
    expect(formatAgo(now - 30 * 1000, now)).toBe('1 分鐘前')
    expect(formatAgo(now - 45 * 60000, now)).toBe('45 分鐘前')
    expect(formatAgo(now - 3 * 3600000, now)).toBe('3 小時前')
    expect(formatAgo(now - 8 * 86400000, now)).toBe('8 天前')
    expect(formatAgo(now - 65 * 86400000, now)).toBe('2 個月前')
    expect(formatAgo(now - 800 * 86400000, now)).toBe('2 年前')
  })
})

describe('parseLiveStatus（R60）', () => {
  const canonical = (href: string) => `<link rel="canonical" href="${href}">`
  it('直播頁指向影片並標示直播中 → 影片代碼', () => {
    expect(parseLiveStatus(`${canonical('https://www.youtube.com/watch?v=1-LpQekNa9g')}..."isLive":true...`)).toBe('1-LpQekNa9g')
  })

  it('沒有直播（指向頻道頁）→ null（AC2）', () => {
    expect(parseLiveStatus(`${canonical(`https://www.youtube.com/channel/${ID}`)}`)).toBeNull()
  })

  it('已排程、還沒開始的直播不算', () => {
    expect(parseLiveStatus(`${canonical('https://www.youtube.com/watch?v=1-LpQekNa9g')}"isLive":true,"isUpcoming":true`)).toBeNull()
  })

  it('指向影片但沒有直播標示（一般影片）→ null', () => {
    expect(parseLiveStatus(canonical('https://www.youtube.com/watch?v=1-LpQekNa9g'))).toBeNull()
  })
})

describe('parseTakeoutCsv（R61）', () => {
  it('英文介面匯出的檔案（AC2）', () => {
    const csv = `Channel Id,Channel Url,Channel Title\n${ID},http://www.youtube.com/channel/${ID},TED\n${ID2},http://www.youtube.com/channel/${ID2},Lofi Girl\n`
    expect(parseTakeoutCsv(csv)).toEqual([
      { id: ID, name: 'TED', url: `https://www.youtube.com/channel/${ID}` },
      { id: ID2, name: 'Lofi Girl', url: `https://www.youtube.com/channel/${ID2}` }
    ])
  })

  it('中文介面匯出的檔案、BOM、Windows 換行、名稱有逗號與引號（AC2）', () => {
    const csv = `﻿頻道 ID,頻道網址,頻道名稱\r\n${ID},http://www.youtube.com/channel/${ID},"TED, 演講 ""精選"""\r\n`
    expect(parseTakeoutCsv(csv)).toEqual([{ id: ID, name: 'TED, 演講 "精選"', url: `https://www.youtube.com/channel/${ID}` }])
  })

  it('重複的頻道只取一次；不是訂閱檔 → null（AC3）', () => {
    expect(parseTakeoutCsv(`${ID},x,A\n${ID},x,A`)).toHaveLength(1)
    expect(parseTakeoutCsv('name,score\nAlice,90\n')).toBeNull()
    expect(parseTakeoutCsv('')).toBeNull()
  })
})

describe('清單檔中的訂閱（R59、R61）', () => {
  it('加入、重複、移除（AC1、AC3、AC5）', () => {
    const r = addChannel(emptyLists(), { id: ID, name: 'TED', url: 'u' }, 1)
    if ('error' in r) throw new Error(r.error)
    expect(r.lists.channels).toEqual([{ id: ID, name: 'TED', url: 'u', time: 1 }])
    expect(addChannel(r.lists, { id: ID, name: 'TED', url: 'u' }, 2)).toEqual({ error: CHANNEL_ERROR.duplicate })
    expect(removeChannel(r.lists, ID).channels).toEqual([])
  })

  it('一次匯入多個，已經訂閱的略過（R61 AC1）', () => {
    const r = addChannel(emptyLists(), { id: ID, name: 'TED', url: 'u' }, 1)
    if ('error' in r) throw new Error(r.error)
    const out = addChannels(r.lists, [{ id: ID, name: 'TED', url: 'u' }, { id: ID2, name: 'Lofi', url: 'v' }], 2)
    expect([out.added, out.skipped]).toEqual([1, 1])
    expect(out.lists.channels.map((c) => c.id)).toEqual([ID, ID2])
  })

  it('舊的清單檔沒有訂閱；不合法、重複的頻道被略過', () => {
    expect(normalizeLists({ favorites: [], history: [] }).channels).toEqual([])
    const l = normalizeLists({ channels: [{ id: ID, name: 'TED', url: 'u', time: 1 }, { id: ID, name: 'dup' }, { id: 'bad' }, 'x'] })
    expect(l.channels).toEqual([{ id: ID, name: 'TED', url: 'u', time: 1 }])
  })

  it('頻道代碼的格式', () => {
    expect(isChannelId(ID)).toBe(true)
    expect(isChannelId('UC123')).toBe(false)
    expect(decodeEntities('&lt;a&gt; &#39;b&#x27; &quot;c&quot; &amp;')).toBe(`<a> 'b' "c" &`)
  })
})
