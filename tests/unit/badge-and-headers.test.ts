// R109 播放方式的小標示、R110 串流請求的標頭、R111 不支援的網址不算 yt-dlp 太舊
import { describe, expect, it } from 'vitest'
import { playbackBadge } from '../../src/lib/playbackBadge'
import { isOutdatedError, streamRequestHeaders, streamSite, webStreamHeaders } from '../../src/lib/ytdlp'
import { parseSource } from '../../src/lib/source'

const yt = { parsed: parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')! }
const web = { parsed: parseSource('https://www.twitch.tv/kaicenat')! }
const mp4 = { parsed: parseSource('https://example.com/a.mp4')! }
const hls = { parsed: parseSource('https://example.com/live.m3u8')! }

describe('播放方式的小標示（R109）', () => {
  it('AC1：yt-dlp 播放 → 綠色「yt-dlp」', () => {
    expect(playbackBadge(yt, 'ytdlp-hls')).toMatchObject({ text: 'yt-dlp', tone: 'ytdlp' })
    expect(playbackBadge(web, 'ytdlp-mp4')).toMatchObject({ text: 'yt-dlp', tone: 'ytdlp' })
  })
  it('AC2：YouTube 內嵌播放器；退回時加註', () => {
    expect(playbackBadge(yt, 'embed')).toMatchObject({ text: '內嵌播放器', short: '內嵌', tone: 'plain' })
    expect(playbackBadge(yt, 'fallback')?.text).toBe('內嵌播放器（yt-dlp 無法播放）')
  })
  it('AC3：其他網站網頁播放；退回時加註；YouTube 網頁播放（沒有播放方式回報）也是網頁', () => {
    expect(playbackBadge(web, 'embed')).toMatchObject({ text: '網頁', short: '網頁' })
    expect(playbackBadge(web, 'fallback')?.text).toBe('網頁（yt-dlp 無法播放）')
    expect(playbackBadge(web, undefined)?.text).toBe('網頁')
  })
  it('AC4：mp4、m3u8 網址不顯示；解析中不顯示', () => {
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
