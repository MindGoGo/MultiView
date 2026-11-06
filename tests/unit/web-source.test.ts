// R12：辨識一般網頁網址、保存網頁來源；R17：廣告阻擋開關的保存
import { describe, expect, it } from 'vitest'
import { parseSource } from '../../src/lib/source'
import { defaultSettings, normalizeView, parseSettings } from '../../src/lib/settings'

const ID = 'jfKfPfyJRdk'

describe('parseSource — 網頁來源（R12）', () => {
  it('AC1：Twitch 頻道網址是網頁來源', () => {
    expect(parseSource('https://www.twitch.tv/somechannel')).toEqual({
      kind: 'web',
      url: 'https://www.twitch.tv/somechannel'
    })
  })

  it('AC2：https://example.com 被接受為網頁來源', () => {
    expect(parseSource('https://example.com')).toEqual({ kind: 'web', url: 'https://example.com/' })
  })

  it('http 也可以，前後空白會被去掉', () => {
    expect(parseSource('  http://news.example.org/live?ch=1  ')).toEqual({
      kind: 'web',
      url: 'http://news.example.org/live?ch=1'
    })
  })

  it.each([
    // YouTube 頻道頁、播放清單頁、Shorts 從 R57 起是 YouTube 網站頁面，見 youtube-browse.test.ts
    ['https://youtu.be/', 'youtu.be 沒有影片 id'],
    ['ftp://example.com/live', 'ftp'],
    ['twitch.tv/abc', '沒有 http(s)://'],
    ['www.twitch.tv/abc', '沒有 http(s)://'],
    ['這不是網址', '非網址的文字']
  ])('AC3：拒絕 %s（%s）', (url) => {
    expect(parseSource(url)).toBeNull()
  })

  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, 'youtube'],
    [`https://youtu.be/${ID}`, 'youtube'],
    ['https://cdn.example.com/live/index.m3u8', 'hls'],
    ['http://example.com/a/b.mp4', 'mp4']
  ])('AC4：第一版支援的 %s 判斷結果不變（%s）', (url, kind) => {
    expect(parseSource(url)?.kind).toBe(kind)
  })

  it('不是 YouTube 的網域即使名稱相近也是網頁來源', () => {
    expect(parseSource(`https://notyoutube.com/watch?v=${ID}`)?.kind).toBe('web')
    expect(parseSource('https://youtube.com.evil.example/watch')?.kind).toBe('web')
  })
})

describe('設定檔中的網頁來源（R12 AC6、AC7，R17 AC3）', () => {
  const WEB = 'https://www.twitch.tv/somechannel'

  it('AC6：網頁來源的網址、靜音、音量、廣告阻擋原樣讀回', () => {
    const s = {
      ...defaultSettings(),
      slots: [
        { url: WEB, muted: false, volume: 30, adblock: false, quality: 'auto', captions: null, audioLang: null, brightness: 100, youtubeWeb: false, position: null, backUrl: null, pageAdblock: true },
        { url: WEB, muted: true, volume: 100, adblock: true, quality: 'auto', captions: null, audioLang: null, brightness: 100, youtubeWeb: false, position: null, backUrl: null, pageAdblock: true },
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    }
    const { settings, corrupt } = parseSettings(JSON.stringify(s))
    expect(corrupt).toBe(false)
    expect(settings.slots[0]).toEqual({ url: WEB, muted: false, volume: 30, adblock: false, quality: 'auto', captions: null, audioLang: null, brightness: 100, youtubeWeb: false, position: null, backUrl: null, pageAdblock: true })
    expect(settings.slots[1]).toEqual({ url: WEB, muted: true, volume: 100, adblock: true, quality: 'auto', captions: null, audioLang: null, brightness: 100, youtubeWeb: false, position: null, backUrl: null, pageAdblock: true })
  })

  it('AC7：第一版的設定檔（沒有 adblock 欄位）照樣讀取，廣告阻擋視為開啟', () => {
    const v1 = {
      version: 1,
      window: { width: 1280, height: 720, alwaysOnTop: false },
      layout: '2x2',
      ratios: {},
      slots: [{ url: `https://www.youtube.com/watch?v=${ID}`, muted: false, volume: 40 }, null, null, null, null, null, null, null, null]
    }
    const { settings, corrupt } = parseSettings(JSON.stringify(v1))
    expect(corrupt).toBe(false)
    expect(settings.layout).toBe('2x2')
    expect(settings.slots[0]).toEqual({
      url: `https://www.youtube.com/watch?v=${ID}`,
      muted: false,
      volume: 40,
      adblock: true,
      quality: 'auto',
      captions: null,
      audioLang: null,
      brightness: 100,
      youtubeWeb: false,
      position: null,
      backUrl: null,
      pageAdblock: true
    })
  })

  it('同一個網頁網址可以放在多格（R12 AC5）', () => {
    const view = normalizeView({ slots: [{ url: WEB }, { url: WEB }, { url: WEB }] })
    expect(view.slots.slice(0, 3).map((s) => s?.url)).toEqual([WEB, WEB, WEB])
  })

  it('adblock 只有明確為 false 才算關閉', () => {
    const view = normalizeView({ slots: [{ url: WEB, adblock: 'no' }, { url: WEB, adblock: 0 }, { url: WEB, adblock: false }] })
    expect(view.slots.slice(0, 3).map((s) => s?.adblock)).toEqual([true, true, false])
  })
})
