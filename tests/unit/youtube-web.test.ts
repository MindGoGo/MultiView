// R48：禁止嵌入的 YouTube 影片改用網頁播放；R49：自動改用的設定
import { describe, expect, it } from 'vitest'
import { YOUTUBE_FAILURE_TEXT, youtubeFailure } from '../../src/lib/webErrors'
import { resolveSource } from '../../src/lib/source'
import { defaultSettings, normalizeView } from '../../src/lib/settings'

const ID = 'kJQP7kiw5Fk'
const YT = `https://www.youtube.com/watch?v=${ID}`

describe('youtubeFailure（R48）', () => {
  it('101、150 是禁止嵌入', () => {
    expect(youtubeFailure(101)).toBe('embed')
    expect(youtubeFailure(150)).toBe('embed')
  })

  it('100 是找不到影片，其他錯誤碼是無法播放', () => {
    expect(youtubeFailure(100)).toBe('missing')
    expect(youtubeFailure(2)).toBe('other')
    expect(youtubeFailure(5)).toBe('other')
  })

  it('錯誤訊息', () => {
    expect(YOUTUBE_FAILURE_TEXT.embed).toBe('此影片無法在外部播放')
    expect(YOUTUBE_FAILURE_TEXT.missing).toBe('找不到這部影片，可能已刪除或不公開')
    expect(YOUTUBE_FAILURE_TEXT.other).toBe('這部影片無法播放')
  })
})

describe('resolveSource（R48）', () => {
  it('改用網頁播放時，以網頁來源載入這部影片的 YouTube 網頁', () => {
    expect(resolveSource(YT, true)).toEqual({ kind: 'web', url: YT })
  })

  it('youtu.be、帶參數的網址也整理成 watch?v= 網址', () => {
    expect(resolveSource(`https://youtu.be/${ID}`, true)).toEqual({ kind: 'web', url: YT })
    expect(resolveSource(`${YT}&t=30s`, true)).toEqual({ kind: 'web', url: YT })
  })

  it('沒有改用網頁播放時和 parseSource 相同', () => {
    expect(resolveSource(YT, false)).toEqual({ kind: 'youtube', videoId: ID })
  })

  it('不是 YouTube 影片的網址不受影響', () => {
    expect(resolveSource('https://example.com/a.m3u8', true)).toEqual({ kind: 'hls', url: 'https://example.com/a.m3u8' })
  })
})

describe('設定檔（R48 AC3、R49 AC4）', () => {
  it('來源的網頁播放狀態保存後讀回不變；舊的設定檔視為否', () => {
    const v = normalizeView({ slots: [{ url: YT, youtubeWeb: true }, { url: YT }, { url: YT, youtubeWeb: 'yes' }] })
    expect(v.slots[0]?.youtubeWeb).toBe(true)
    expect(v.slots[1]?.youtubeWeb).toBe(false)
    expect(v.slots[2]?.youtubeWeb).toBe(false)
  })

  it('自動改用網頁播放：預設不勾選，保存後讀回不變，舊的設定檔視為不勾選', () => {
    expect(defaultSettings().autoYoutubeWeb).toBe(false)
    expect(normalizeView({ autoYoutubeWeb: true }).autoYoutubeWeb).toBe(true)
    expect(normalizeView({ layout: '2x2' }).autoYoutubeWeb).toBe(false)
  })
})
