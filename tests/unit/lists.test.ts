// R21–R23：最愛與歷史清單
import { describe, expect, it } from 'vitest'
import {
  addFavorite,
  clearHistory,
  defaultName,
  deleteItem,
  editItem,
  emptyLists,
  formatListTime,
  HISTORY_MAX,
  isFavorite,
  LIST_ERROR,
  normalizeLists,
  parseLists,
  recordHistory,
  removeFavorite,
  sameUrl,
  type ListResult,
  type Lists
} from '../../src/lib/lists'

const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const DW = 'https://www.youtube.com/watch?v=LuKwFajn37U'
const MP4 = 'https://cdn.example.com/videos/My%20Clip.mp4'

const ok = (r: ListResult): Lists => {
  if ('error' in r) throw new Error(r.error)
  return r.lists
}

describe('網址比對與影片名稱（共用定義）', () => {
  it('去掉前後空白後比對完整網址；同一部影片的不同寫法視為不同', () => {
    expect(sameUrl(` ${YT} `, YT)).toBe(true)
    expect(sameUrl('https://youtu.be/aqz-KE-bpKQ', YT)).toBe(false)
  })

  it('影片名稱：標題 → mp4 / m3u8 檔名 → 網址', () => {
    expect(defaultName(YT, '  Big Buck Bunny ')).toBe('Big Buck Bunny')
    expect(defaultName(MP4, null)).toBe('My Clip.mp4')
    expect(defaultName('https://cdn.example.com/live/index.m3u8?t=1', '')).toBe('index.m3u8')
    expect(defaultName(YT, null)).toBe(YT)
    expect(defaultName('https://www.twitch.tv/abc', undefined)).toBe('https://www.twitch.tv/abc')
  })
})

describe('最愛（R22）', () => {
  it('AC1：加入後排在最上面', () => {
    let l = ok(addFavorite(emptyLists(), YT, 'Bunny', 1))
    l = ok(addFavorite(l, DW, 'DW', 2))
    expect(l.favorites.map((i) => i.name)).toEqual(['DW', 'Bunny'])
  })

  it('AC2、AC3：isFavorite 依網址判斷，移除後不在最愛中', () => {
    const l = ok(addFavorite(emptyLists(), YT, 'Bunny', 1))
    expect(isFavorite(l, ` ${YT}`)).toBe(true)
    expect(isFavorite(removeFavorite(l, YT), YT)).toBe(false)
  })

  it('AC4：名稱空白時用網址', () => {
    expect(ok(addFavorite(emptyLists(), YT, '   ', 1)).favorites[0].name).toBe(YT)
  })

  it('AC6：重複的網址不新增', () => {
    const l = ok(addFavorite(emptyLists(), YT, 'Bunny', 1))
    expect(addFavorite(l, `${YT} `, 'again', 2)).toEqual({ error: LIST_ERROR.duplicate })
  })

  it('不支援的網址不新增', () => {
    expect(addFavorite(emptyLists(), 'ftp://x', '', 1)).toEqual({ error: LIST_ERROR.unsupported })
  })
})

describe('編輯與刪除（R21）', () => {
  const base = () => ok(addFavorite(ok(addFavorite(emptyLists(), YT, 'Bunny', 1)), DW, 'DW', 2))

  it('改名稱和網址', () => {
    const l = ok(editItem(base(), 'favorites', 0, MP4, '我的影片'))
    expect(l.favorites[0]).toMatchObject({ url: MP4, name: '我的影片' })
  })

  it('AC6：網址不支援時不儲存', () => {
    expect(editItem(base(), 'favorites', 0, 'ftp://x', 'a')).toEqual({ error: LIST_ERROR.unsupported })
  })

  it('AC6：名稱清空時用網址', () => {
    expect(ok(editItem(base(), 'favorites', 0, DW, '')).favorites[0].name).toBe(DW)
  })

  it('AC7：改成清單中另一筆的網址時不儲存；改成自己原本的網址可以', () => {
    expect(editItem(base(), 'favorites', 0, YT, 'x')).toEqual({ error: LIST_ERROR.duplicate })
    expect(ok(editItem(base(), 'favorites', 0, DW, '新名稱')).favorites[0].name).toBe('新名稱')
  })

  it('AC8：刪除一筆', () => {
    expect(deleteItem(base(), 'favorites', 0).favorites.map((i) => i.name)).toEqual(['Bunny'])
  })

  it('編輯或刪除不存在的位置不改變清單', () => {
    const l = base()
    expect(ok(editItem(l, 'favorites', 9, DW, 'x'))).toBe(l)
    expect(deleteItem(l, 'favorites', 9).favorites).toHaveLength(2)
  })
})

describe('歷史（R23）', () => {
  it('AC1：記錄一筆，名稱是影片名稱、時間是播放時間', () => {
    const l = recordHistory(emptyLists(), YT, 'Bunny', 1000)
    expect(l.history).toEqual([{ url: YT, name: 'Bunny', time: 1000 }])
  })

  it('AC2：同一個網址不新增，更新時間並移到最上面', () => {
    let l = recordHistory(emptyLists(), YT, 'Bunny', 1)
    l = recordHistory(l, DW, 'DW', 2)
    l = recordHistory(l, YT, 'Bunny', 3)
    expect(l.history.map((i) => [i.name, i.time])).toEqual([
      ['Bunny', 3],
      ['DW', 2]
    ])
  })

  it('AC3：使用者改過的名稱不會被蓋掉', () => {
    let l = recordHistory(emptyLists(), YT, 'Bunny', 1)
    l = ok(editItem(l, 'history', 0, YT, '我的兔子'))
    l = recordHistory(l, YT, 'Bunny', 2)
    expect(l.history[0].name).toBe('我的兔子')
  })

  it('AC6：超過 200 筆時刪掉最舊的', () => {
    let l = emptyLists()
    for (let i = 0; i < HISTORY_MAX; i++) l = recordHistory(l, `https://example.com/v/${i}`, null, i)
    expect(l.history).toHaveLength(HISTORY_MAX)
    l = recordHistory(l, YT, 'Bunny', 9999)
    expect(l.history).toHaveLength(HISTORY_MAX)
    expect(l.history[0].url).toBe(YT)
    // 最舊的是第 0 筆
    expect(l.history.some((i) => i.url === 'https://example.com/v/0')).toBe(false)
    expect(l.history.some((i) => i.url === 'https://example.com/v/1')).toBe(true)
  })

  it('AC7：全部清除', () => {
    const l = recordHistory(emptyLists(), YT, 'Bunny', 1)
    expect(clearHistory(l).history).toEqual([])
  })

  it('最後播放時間的格式是 YYYY/MM/DD HH:mm', () => {
    expect(formatListTime(new Date(2026, 9, 8, 9, 5).getTime())).toBe('2026/10/08 09:05')
  })
})

describe('清單檔（R21 AC10、AC11）', () => {
  it('AC10：合法的內容原樣讀回', () => {
    const l = ok(addFavorite(recordHistory(emptyLists(), YT, 'Bunny', 1), DW, 'DW', 2))
    expect(parseLists(JSON.stringify(l))).toEqual({ lists: l, corrupt: false })
  })

  it('AC11：JSON 格式錯誤或整體結構不對視為損毀，清單是空的', () => {
    expect(parseLists('{ broken')).toEqual({ lists: emptyLists(), corrupt: true })
    expect(parseLists('[]').corrupt).toBe(true)
    expect(parseLists('null').corrupt).toBe(true)
  })

  it('不合法、重複的項目被略過；歷史最多 200 筆', () => {
    const history = Array.from({ length: 250 }, (_, i) => ({ url: `https://example.com/v/${i}`, name: '', time: i }))
    const l = normalizeLists({
      favorites: [{ url: 'ftp://x', name: 'a' }, { url: YT, name: 'Bunny', time: 'x' }, { url: ` ${YT}`, name: 'dup' }, 'garbage'],
      history
    })
    expect(l.favorites).toEqual([{ url: YT, name: 'Bunny', time: 0 }])
    expect(l.history).toHaveLength(HISTORY_MAX)
    expect(l.history[0].name).toBe('https://example.com/v/0')
  })
})
