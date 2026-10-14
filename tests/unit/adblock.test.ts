// R17：廣告阻擋的判斷規則，以及打包的 EasyList 實際比對結果
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { isEmbeddedYouTube, isYouTubeFrame, shouldCheck, toFilterType } from '../../src/lib/adblockRules'

describe('isYouTubeFrame（R17：內嵌的 YouTube 播放器不阻擋）', () => {
  it.each([
    'https://www.youtube.com/embed/jfKfPfyJRdk',
    'https://youtube.com/embed/x',
    'https://m.youtube.com/watch?v=x',
    'https://www.youtube-nocookie.com/embed/x'
  ])('%s 是 YouTube 框架', (url) => {
    expect(isYouTubeFrame(url)).toBe(true)
  })

  it.each([
    'https://notyoutube.com/embed/x',
    'https://youtube.com.evil.example/embed/x',
    'https://www.twitch.tv/',
    '',
    null,
    undefined,
    '不是網址'
  ])('%j 不是', (url) => {
    expect(isYouTubeFrame(url)).toBe(false)
  })
})

describe('toFilterType', () => {
  it.each([
    ['mainFrame', 'main_frame'],
    ['subFrame', 'sub_frame'],
    ['script', 'script'],
    ['xhr', 'xhr'],
    ['webSocket', 'websocket'],
    ['cspReport', 'csp_report'],
    ['somethingNew', 'other']
  ])('%s → %s', (from, to) => {
    expect(toFilterType(from)).toBe(to)
  })
})

describe('shouldCheck（R17 AC2、AC4）', () => {
  const disabled = new Set([7])
  const req = { webContentsId: 3, resourceType: 'script', frameUrl: 'https://news.example.com/live' }

  it('一般網頁的子項目要比對', () => {
    expect(shouldCheck(req, disabled)).toBe(true)
  })

  it('AC2：關閉廣告阻擋的格子不比對，其他格照樣比對', () => {
    expect(shouldCheck({ ...req, webContentsId: 7 }, disabled)).toBe(false)
    expect(shouldCheck({ ...req, webContentsId: 8 }, disabled)).toBe(true)
  })

  it('AC4：YouTube 播放器框架發出的請求不比對', () => {
    expect(shouldCheck({ ...req, frameUrl: 'https://www.youtube.com/embed/x' }, disabled)).toBe(false)
  })

  it('使用者輸入的網址（網頁本身）不比對', () => {
    expect(shouldCheck({ ...req, resourceType: 'mainFrame' }, disabled)).toBe(false)
  })

  it('不是網頁發出的請求不比對', () => {
    expect(shouldCheck({ ...req, webContentsId: undefined }, disabled)).toBe(false)
  })
})

describe('打包的 EasyList（R17 AC1、AC5）', () => {
  let engine: FiltersEngine
  beforeAll(() => {
    // AC5：從專案內的檔案讀取，不需要網路
    const text = fs.readFileSync(path.join(__dirname, '../../resources/easylist.txt'), 'utf8')
    engine = FiltersEngine.parse(text, { loadCosmeticFilters: true, loadNetworkFilters: true })
  })

  const match = (url: string, sourceUrl: string, type: string) =>
    engine.match(Request.fromRawDetails({ url, sourceUrl, type: type as Parameters<typeof Request.fromRawDetails>[0]['type'] })).match

  it('清單是 EasyList 主清單', () => {
    const text = fs.readFileSync(path.join(__dirname, '../../resources/easylist.txt'), 'utf8')
    expect(text.startsWith('[Adblock Plus')).toBe(true)
    expect(text).toMatch(/^! Title: EasyList$/m)
  })

  it('AC1：EasyList 中的廣告網址被擋下', () => {
    expect(match('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://news.example.com/live', 'script')).toBe(true)
  })

  it('AC1：一般網址不擋', () => {
    expect(match('https://news.example.com/static/player.js', 'https://news.example.com/live', 'script')).toBe(false)
    expect(match('https://cdn.example.net/live/index.m3u8', 'https://news.example.com/live', 'xhr')).toBe(false)
  })

  it('AC1：清單中的廣告元素會被隱藏', () => {
    const { styles } = engine.getCosmeticsFilters({
      url: 'https://news.example.com/live',
      hostname: 'news.example.com',
      domain: 'example.com',
      classes: ['ADBox'],
      ids: [],
      hrefs: [],
      getBaseRules: false,
      getInjectionRules: false,
      getExtendedRules: false
    })
    expect(styles).toContain('.ADBox')
    expect(styles).toContain('display: none')
  })
})

describe('YouTube 網頁類格子的廣告阻擋（R73）', () => {
  const yt = 'https://www.youtube.com/watch?v=iG9CE55wbtY'
  const news = 'https://news.example.com/live'
  it('其他網站裡內嵌的 YouTube 播放器不阻擋（第二版 R17 AC4）', () => {
    expect(isEmbeddedYouTube('https://www.youtube.com/embed/iG9CE55wbtY', news)).toBe(true)
    expect(shouldCheck({ webContentsId: 1, resourceType: 'xhr', frameUrl: 'https://www.youtube.com/embed/x', topUrl: news }, new Set())).toBe(false)
  })

  it('整個格子就是 YouTube 網頁時照常阻擋（AC1）', () => {
    expect(isEmbeddedYouTube(yt, yt)).toBe(false)
    expect(shouldCheck({ webContentsId: 1, resourceType: 'xhr', frameUrl: yt, topUrl: yt }, new Set())).toBe(true)
  })

  it('廣告阻擋關閉時不阻擋（AC2）', () => {
    expect(shouldCheck({ webContentsId: 1, resourceType: 'xhr', frameUrl: yt, topUrl: yt }, new Set([1]))).toBe(false)
  })

  it('不知道最上層網頁時視為內嵌，不阻擋（維持原本的合規行為）', () => {
    expect(shouldCheck({ webContentsId: 1, resourceType: 'xhr', frameUrl: yt }, new Set())).toBe(false)
  })
})
