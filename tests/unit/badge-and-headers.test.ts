// R109 播放方式的小標示、R110 串流請求的標頭、R111 不支援的網址不算 yt-dlp 太舊
import { describe, expect, it } from 'vitest'
import { playbackBadge } from '../../src/lib/playbackBadge'
import { isOutdatedError, streamRequestHeaders, streamSite, webStreamHeaders } from '../../src/lib/ytdlp'
import { parseSource } from '../../src/lib/source'

const yt = { parsed: parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')! }
const web = { parsed: parseSource('https://www.twitch.tv/kaicenat')! }
const mp4 = { parsed: parseSource('https://example.com/a.mp4')! }
const hls = { parsed: parseSource('https://example.com/live.m3u8')! }

describe('播放方式的小標示（R109、R165）', () => {
  it('R165 AC2：yt-dlp 播放 → 只有綠色小圓點', () => {
    expect(playbackBadge(yt, 'ytdlp-hls')).toMatchObject({ dot: true })
    expect(playbackBadge(web, 'ytdlp-mp4')).toMatchObject({ dot: true })
  })
  it('R165：內嵌播放器、網頁、yt-dlp 播不了時改用的方式都不顯示標示', () => {
    for (const m of ['embed', 'fallback', undefined] as const) {
      expect(playbackBadge(yt, m)?.dot).toBe(false)
      expect(playbackBadge(web, m)?.dot).toBe(false)
    }
  })
  it('說明仍分得出播放方式；改用原本的方式時加註', () => {
    expect(playbackBadge(yt, 'embed')?.tip).toContain('內嵌播放器')
    expect(playbackBadge(yt, 'fallback')?.tip).toContain('yt-dlp 無法播放')
    expect(playbackBadge(web, 'embed')?.tip).toContain('網頁')
    expect(playbackBadge(web, 'fallback')?.tip).toContain('yt-dlp 不支援')
    expect(playbackBadge(web, 'ytdlp-hls')?.tip).toContain('yt-dlp')
  })
  it('AC4：mp4、m3u8 網址沒有；解析中沒有', () => {
    expect(playbackBadge(mp4, undefined)).toBeNull()
    expect(playbackBadge(hls, undefined)).toBeNull()
    expect(playbackBadge(yt, 'resolving')).toBeNull()
  })
  it('每一種都有滑鼠停留時的說明', () => {
    for (const m of ['embed', 'fallback', 'ytdlp-hls'] as const) {
      expect(playbackBadge(yt, m)?.tip).toBeTruthy()
      expect(playbackBadge(web, m)?.tip).toBeTruthy()
    }
  })
})

describe('串流請求的標頭（R110）', () => {
  it('同一個網域的不同主機共用標頭', () => {
    expect(streamSite('usher.ttvnw.net')).toBe('ttvnw.net')
    expect(streamSite('aps12.playlist.ttvnw.net')).toBe('ttvnw.net')
    expect(streamSite('cdn-1.video.example.com')).toBe('example.com')
    expect(streamSite('rr2---sn-3cgv-un5ek.googlevideo.com')).toBe('googlevideo.com')
    expect(streamSite('localhost')).toBe('localhost')
  })
  it('其他網站：Referer 是網頁網址；yt-dlp 有提供時用 yt-dlp 的', () => {
    const page = 'https://www.example.com/video-x/'
    expect(webStreamHeaders(page, { 'User-Agent': 'UA' })).toEqual({ Referer: page, 'User-Agent': 'UA' })
    expect(webStreamHeaders(page, undefined)).toEqual({ Referer: page })
    expect(webStreamHeaders(page, { referer: 'https://player.site/' })).toEqual({ referer: 'https://player.site/' })
  })
  it('送出前拿掉程式畫面的 Origin、Referer 與 Sec-Fetch-*，再補上網站要求的標頭', () => {
    const sent = {
      Origin: 'http://127.0.0.1:5000',
      Referer: 'http://127.0.0.1:5000/',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'User-Agent': 'Electron UA',
      Range: 'bytes=0-'
    }
    expect(streamRequestHeaders(sent, { Referer: 'https://www.example.com/video-x/', 'User-Agent': 'UA' })).toEqual({
      Range: 'bytes=0-',
      Referer: 'https://www.example.com/video-x/',
      'User-Agent': 'UA'
    })
    // YouTube（沒有補 Referer）：不帶任何 Referer
    expect(streamRequestHeaders(sent, undefined)).toEqual({ 'User-Agent': 'Electron UA', Range: 'bytes=0-' })
  })
})

describe('不支援的網址（R111）', () => {
  it('「Unsupported URL」不算 yt-dlp 太舊，不觸發自動更新', () => {
    // 2026-11-07 實際的錯誤訊息
    expect(isOutdatedError('ERROR: Unsupported URL: https://www.example.net/video/1/x/')).toBe(false)
  })
  it('真的解析不了 YouTube 頁面仍然算太舊', () => {
    expect(isOutdatedError('ERROR: [youtube] abc: Unable to extract yt initial data; please report this issue')).toBe(true)
  })
})
