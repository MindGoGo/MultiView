// R31：YouTube 字幕的整理與套用規則；R32：畫質選單
import { describe, expect, it } from 'vitest'
import { findCaptionTrack, toCaptionTracks } from '../../src/lib/captions'
import {
  hlsHeights,
  normalizeQuality,
  pickHlsLevel,
  qualityLabel,
  qualityScale,
  qualitySize,
  youtubeHeights
} from '../../src/lib/quality'
import { normalizeView } from '../../src/lib/settings'

const RAW = [
  { languageCode: 'zh-TW', languageName: '中文（台灣）', kind: '' },
  { languageCode: 'en', languageName: '英文', kind: '' },
  { languageCode: 'en', languageName: '英文', kind: 'asr' },
  { languageCode: 'ja', languageName: '日文', kind: 'asr' },
  { languageCode: 'zh-TW', languageName: '中文（台灣）', kind: '' },
  { languageName: '沒有代碼' }
]

describe('toCaptionTracks（R31）', () => {
  it('AC1：整理成選單項目，自動產生的加「（自動產生）」，重複的只留一個', () => {
    expect(toCaptionTracks(RAW).map((t) => [t.key, t.label])).toEqual([
      ['zh-TW', '中文（台灣）'],
      ['en', '英文'],
      ['asr:en', '英文（自動產生）'],
      ['asr:ja', '日文（自動產生）']
    ])
  })

  it('AC5：沒有字幕或格式不對時是空的', () => {
    expect(toCaptionTracks([])).toEqual([])
    expect(toCaptionTracks(null)).toEqual([])
    expect(toCaptionTracks(undefined)).toEqual([])
  })
})

describe('findCaptionTrack（R31）', () => {
  const tracks = toCaptionTracks(RAW)

  it('AC3：沒有選擇時關閉', () => {
    expect(findCaptionTrack(tracks, null)).toBeNull()
  })

  it('AC2：完全相同的優先', () => {
    expect(findCaptionTrack(tracks, 'asr:en')?.key).toBe('asr:en')
    expect(findCaptionTrack(tracks, 'en')?.key).toBe('en')
  })

  it('AC4：換成另一部影片時找同一種語言，優先人工字幕', () => {
    // 原本選了自動產生的中文；這部影片有人工中文字幕
    expect(findCaptionTrack(tracks, 'asr:zh-TW')?.key).toBe('zh-TW')
    // 原本選人工日文；新影片只有自動產生的日文
    expect(findCaptionTrack(tracks, 'ja')?.key).toBe('asr:ja')
  })

  it('AC4：新影片沒有那種語言時關閉', () => {
    expect(findCaptionTrack(tracks, 'ko')).toBeNull()
  })
})

describe('畫質名稱與可用畫質（R32）', () => {
  it('名稱', () => {
    expect(qualityLabel('auto')).toBe('自動')
    expect(qualityLabel(720)).toBe('720p')
  })

  it('YouTube 的畫質代碼 → 高度，由高到低，不含 auto 和低於 480p 的', () => {
    expect(youtubeHeights(['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'])).toEqual([1080, 720, 480])
    expect(youtubeHeights(['highres', 'hd2160', 'hd1440'])).toEqual([4320, 2160, 1440])
    expect(youtubeHeights(null)).toEqual([])
  })

  it('AC1：m3u8 的畫質等級 → 高度，由高到低，同一高度只列一次', () => {
    expect(hlsHeights([{ height: 184 }, { height: 288 }, { height: 480 }, { height: 720 }, { height: 720 }, { height: 1080 }])).toEqual([
      1080, 720, 480, 288, 184
    ])
  })
})

describe('pickHlsLevel（R32 m3u8 選擇特定畫質）', () => {
  const levels = [{ height: 184 }, { height: 288 }, { height: 480 }, { height: 720 }, { height: 720 }, { height: 1080 }]

  it('AC1：選 720p → 720p 中位元率最高的（最後一個）', () => {
    expect(pickHlsLevel(levels, 720)).toBe(4)
  })

  it('保存的畫質沒有時，用低於它的最高畫質', () => {
    expect(pickHlsLevel(levels, 600)).toBe(2)
    expect(pickHlsLevel(levels, 2160)).toBe(5)
  })

  it('都比它高時用最低的', () => {
    expect(pickHlsLevel(levels, 144)).toBe(0)
  })

  it('沒有等級時回傳 -1', () => {
    expect(pickHlsLevel([], 720)).toBe(-1)
  })
})

describe('YouTube 選擇特定畫質時的排版（R32）', () => {
  it('畫質大小是 16:9', () => {
    expect(qualitySize(720)).toEqual({ w: 1280, h: 720 })
    expect(qualitySize(1080)).toEqual({ w: 1920, h: 1080 })
  })

  it('自動時不縮放', () => {
    expect(qualityScale('auto', 426, 239)).toBe(1)
  })

  it('AC2：3×3 的格子選 720p → 播放器以至少 1280×720 排版再縮小', () => {
    const f = qualityScale(720, 426, 239)
    expect(f).toBeLessThan(1)
    expect(426 / f).toBeGreaterThanOrEqual(1280 - 1e-9)
    expect(239 / f).toBeGreaterThanOrEqual(720 - 1e-9)
  })

  it('大格子選比較低的畫質 → 放大顯示（比例大於 1）', () => {
    expect(qualityScale(480, 1280, 720)).toBe(1.5)
  })
})

describe('設定檔相容（R31 AC4、R32 AC4、AC5）', () => {
  const YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

  it('R32 AC5：舊版的「高」是 1080p，合理範圍內的整數是畫面高度，其他是自動', () => {
    expect(normalizeQuality('high')).toBe(1080)
    expect(normalizeQuality(720)).toBe(720)
    expect(normalizeQuality(undefined)).toBe('auto')
    expect(normalizeQuality(1)).toBe('auto')
    expect(normalizeQuality(720.5)).toBe('auto')
    expect(normalizeQuality('720')).toBe('auto')
  })

  it('R32 AC4、R31 AC4：畫質與字幕原樣讀回；舊檔沒有字幕欄位時是關閉', () => {
    const view = normalizeView({ slots: [{ url: YT, quality: 480, captions: 'asr:en' }, { url: YT }] })
    expect(view.slots[0]).toMatchObject({ quality: 480, captions: 'asr:en' })
    expect(view.slots[1]).toMatchObject({ quality: 'auto', captions: null })
  })
})
