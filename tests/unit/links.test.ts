// R45：YouTube 播放器裡會開新視窗的連結
import { describe, expect, it } from 'vitest'
import { canonicalYouTubeUrl, classifyLink } from '../../src/lib/links'

const CURRENT = 'iG9CE55wbtY'
const OTHER = 'wX78iKhInsc'

describe('classifyLink（R45）', () => {
  it('其他影片的連結 → 在直接操作中的那一格播放，網址去掉參數（AC1、AC2）', () => {
    expect(classifyLink(`https://www.youtube.com/watch?v=${OTHER}&feature=endscreen`, 2, CURRENT)).toEqual({
      kind: 'play',
      index: 2,
      url: `https://www.youtube.com/watch?v=${OTHER}`
    })
  })

  it('youtu.be、live、帶播放清單或開始時間的影片連結也是影片', () => {
    for (const url of [
      `https://youtu.be/${OTHER}`,
      `https://www.youtube.com/live/${OTHER}`,
      `https://www.youtube.com/watch?v=${OTHER}&list=PL123&index=2`,
      `https://www.youtube.com/watch?v=${OTHER}&t=90s`
    ]) {
      expect(classifyLink(url, 0, CURRENT)).toEqual({ kind: 'play', index: 0, url: canonicalYouTubeUrl(OTHER) })
    }
  })

  it('這一格目前的影片（例如點標題）→ 用瀏覽器開啟（AC4）', () => {
    const url = `https://www.youtube.com/watch?v=${CURRENT}`
    expect(classifyLink(url, 0, CURRENT)).toEqual({ kind: 'external', url })
  })

  it('頻道、YouTube 首頁、Shorts 等不是影片的連結 → 用瀏覽器開啟（AC5）', () => {
    for (const url of [
      'https://www.youtube.com/@TED',
      'https://www.youtube.com/',
      `https://www.youtube.com/shorts/${OTHER}`,
      'https://www.ted.com/talks'
    ]) {
      expect(classifyLink(url, 0, CURRENT)).toEqual({ kind: 'external', url: new URL(url).href })
    }
  })

  it('沒有直接操作中的格子 → 影片連結也用瀏覽器開啟', () => {
    const url = `https://www.youtube.com/watch?v=${OTHER}`
    expect(classifyLink(url, null, null)).toEqual({ kind: 'external', url })
  })

  it('不是 http／https 的網址、無法解析的網址 → 不處理', () => {
    expect(classifyLink('javascript:alert(1)', 0, CURRENT)).toEqual({ kind: 'ignore' })
    expect(classifyLink('file:///C:/Windows/notepad.exe', 0, CURRENT)).toEqual({ kind: 'ignore' })
    expect(classifyLink('not a url', 0, CURRENT)).toEqual({ kind: 'ignore' })
  })
})

describe('canonicalYouTubeUrl（R45）', () => {
  it('整理成 watch?v= 網址', () => {
    expect(canonicalYouTubeUrl(OTHER)).toBe(`https://www.youtube.com/watch?v=${OTHER}`)
  })
})
