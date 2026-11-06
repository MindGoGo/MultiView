// R102 其他網站的播放方式、R103 其他網站的格式選擇與請求標頭
import { describe, expect, it } from 'vitest'
import { normalizeWebMethod, pickStream } from '../../src/lib/ytdlp'
import { canBoost } from '../../src/lib/volume'
import { parseSource } from '../../src/lib/source'
import { defaultSettings, parseSettings } from '../../src/lib/settings'

const NOW = 1_793_970_000_000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// 2026-11-06 實際解析的結果（只留用得到的欄位）
const ARCHIVE = {
  title: 'Big Buck Bunny',
  formats: [
    { format_id: '0', ext: 'ogv', protocol: 'https', height: 300, url: 'https://archive.org/a.ogv' },
    { format_id: '1', ext: 'mp4', protocol: 'https', height: 360, url: 'https://archive.org/a.mp4', http_headers: { 'User-Agent': UA, Accept: '*/*' } },
    { format_id: '2', ext: 'avi', protocol: 'https', height: 720, url: 'https://archive.org/a.avi' }
  ]
}
const DAILYMOTION = {
  title: 'Midnight Sun | Iceland',
  formats: [
    { format_id: 'hls-380', protocol: 'm3u8_native', height: 240, url: 'https://cdn/x-240.m3u8', manifest_url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/x7tgad0.m3u8?sec=abc', http_headers: { 'User-Agent': UA, Cookie: 'secret' } },
    { format_id: 'hls-1080', protocol: 'm3u8_native', height: 1080, url: 'https://cdn/x-1080.m3u8', manifest_url: 'https://cdndirector.dailymotion.com/cdn/manifest/video/x7tgad0.m3u8?sec=abc' }
  ]
}

describe('其他網站的格式選擇（R103）', () => {
  it('有主清單 → HLS 主清單；請求標頭只留 User-Agent、Referer，不帶 Cookie', () => {
    const s = pickStream(DAILYMOTION, NOW)!
    expect(s.kind).toBe('hls')
    expect(s.url).toContain('/cdn/manifest/')
    expect(s.title).toBe('Midnight Sun | Iceland')
    expect(s.headers).toEqual({ 'User-Agent': UA })
  })
  it('沒有 HLS → 播放器能播的容器中畫質最高的（avi、ogv 不選）', () => {
    const s = pickStream(ARCHIVE, NOW)!
    expect(s).toMatchObject({ kind: 'mp4', url: 'https://archive.org/a.mp4', headers: { 'User-Agent': UA } })
  })
  it('沒有標示編碼的格式也算影音合一；明確標示沒有聲音的不算', () => {
    const info = {
      formats: [
        { protocol: 'https', ext: 'mp4', height: 1080, vcodec: 'avc1', acodec: 'none', url: 'https://x/v1080.mp4' },
        { protocol: 'https', ext: 'mp4', height: 720, url: 'https://x/v720.mp4' }
      ]
    }
    expect(pickStream(info, NOW)!.url).toBe('https://x/v720.mp4')
  })
  it('只有 HLS 變體、沒有主清單 → 用畫質最高的變體', () => {
    const info = { formats: [{ protocol: 'm3u8', url: 'https://x/240.m3u8' }, { protocol: 'm3u8', url: 'https://x/720.m3u8' }] }
    expect(pickStream(info, NOW)).toMatchObject({ kind: 'hls', url: 'https://x/720.m3u8' })
  })
  it('網頁有多部影片（清單）→ 第一部有格式的', () => {
    const info = { _type: 'playlist', entries: [{ title: '沒有格式' }, ARCHIVE, DAILYMOTION] }
    expect(pickStream(info, NOW)).toMatchObject({ kind: 'mp4', title: 'Big Buck Bunny' })
  })
  it('只有影音分開的格式（例如部分 Bilibili）→ null（退回網頁）', () => {
    const info = {
      formats: [
        { protocol: 'https', ext: 'mp4', vcodec: 'avc1', acodec: 'none', url: 'https://x/v.m4s' },
        { protocol: 'https', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', url: 'https://x/a.m4s' }
      ]
    }
    expect(pickStream(info, NOW)).toBeNull()
  })
})

describe('其他網站的播放方式（R102）', () => {
  it('預設網頁；不合法的值視為網頁', () => {
    expect(defaultSettings().webMethod).toBe('web')
    expect(normalizeWebMethod('ytdlp')).toBe('ytdlp')
    expect(normalizeWebMethod('x')).toBe('web')
  })
  it('AC3：保存後讀取不變；0.7.1 的設定檔是網頁', () => {
    expect(parseSettings(JSON.stringify({ ...defaultSettings(), webMethod: 'ytdlp' })).settings.webMethod).toBe('ytdlp')
    const old = { ...defaultSettings() } as Record<string, unknown>
    delete old.webMethod
    expect(parseSettings(JSON.stringify(old)).settings.webMethod).toBe('web')
  })
  it('其他網站用 yt-dlp 播放時音量可以到 200%（R98）；網頁播放不行', () => {
    const web = { parsed: parseSource('https://www.ted.com/talks/x')! }
    expect(web.parsed.kind).toBe('web')
    expect(canBoost(web, 'ytdlp-hls')).toBe(true)
    expect(canBoost(web, 'embed')).toBe(false)
    expect(canBoost(web, undefined)).toBe(false)
  })
})
