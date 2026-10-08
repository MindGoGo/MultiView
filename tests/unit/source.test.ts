// R2：網址解析
import { describe, expect, it } from 'vitest'
import { parseSource } from '../../src/lib/source'

const ID = 'jfKfPfyJRdk'

describe('parseSource — YouTube（R2）', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`
  ])('接受 %s', (url) => {
    expect(parseSource(url)).toEqual({ kind: 'youtube', videoId: ID })
  })

  it('忽略其他 query 參數，例如時間與播放清單', () => {
    expect(parseSource(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`)).toEqual({
      kind: 'youtube',
      videoId: ID
    })
    expect(parseSource(`https://youtu.be/${ID}?si=abc&t=10`)).toEqual({ kind: 'youtube', videoId: ID })
  })

  it('前後的空白會被去掉', () => {
    expect(parseSource(`  https://youtu.be/${ID}  `)).toEqual({ kind: 'youtube', videoId: ID })
  })

  it.each([
    [`https://www.youtube.com/shorts/${ID}`, 'Shorts 不支援'],
    ['https://www.youtube.com/watch?list=PL123', '只有播放清單、沒有 v='],
    ['https://www.youtube.com/watch?v=short', 'id 長度不對'],
    ['https://www.youtube.com/@somechannel', '頻道頁'],
    [`https://notyoutube.com/watch?v=${ID}`, '不是 YouTube 網域'],
    [`https://youtu.be/${ID}/extra`, 'youtu.be 多餘的路徑']
  ])('拒絕 %s（%s）', (url) => {
    expect(parseSource(url)).toBeNull()
  })
})

describe('parseSource — 直接連結（R2）', () => {
  it('m3u8 → hls', () => {
    expect(parseSource('https://cdn.example.com/live/index.m3u8')).toEqual({
      kind: 'hls',
      url: 'https://cdn.example.com/live/index.m3u8'
    })
  })

  it('mp4 → mp4', () => {
    expect(parseSource('http://example.com/a/b.mp4')).toEqual({
      kind: 'mp4',
      url: 'http://example.com/a/b.mp4'
    })
  })

  it('副檔名不分大小寫，可以帶 query string', () => {
    expect(parseSource('https://x.com/v/STREAM.M3U8?token=abc')?.kind).toBe('hls')
    expect(parseSource('https://x.com/v/Clip.MP4?x=1#t=5')?.kind).toBe('mp4')
  })

  it('副檔名只出現在 query 中不算', () => {
    expect(parseSource('https://x.com/play?file=a.mp4')).toBeNull()
  })
})

describe('parseSource — 不支援的輸入（R2 AC4）', () => {
  it.each([
    'https://example.com',
    'example.com/video.mp4',
    '這不是網址',
    '',
    '   ',
    'ftp://example.com/a.mp4',
    'file:///C:/videos/a.mp4',
    'javascript:alert(1)'
  ])('拒絕 %j', (input) => {
    expect(parseSource(input)).toBeNull()
  })
})
