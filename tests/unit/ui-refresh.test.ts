// R96 設定視窗的 yt-dlp 列、R98 音量、R99 讀取動畫的顯示時機
import { describe, expect, it } from 'vitest'
import { canBoost, effectiveVolume, normalizeVolume, volumeMax, volumeParts } from '../../src/lib/volume'
import { loadingKind, LOADING_DELAY_MS, LOADING_TEXT } from '../../src/lib/loading'
import { ytdlpRow } from '../../src/lib/ytdlp'
import { parseSource } from '../../src/lib/source'
import { defaultSettings, parseSettings } from '../../src/lib/settings'

const yt = { parsed: parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')! }
const hls = { parsed: parseSource('https://example.com/live/index.m3u8')! }
const mp4 = { parsed: parseSource('https://example.com/video.mp4')! }

describe('音量（R98）', () => {
  it('可放大的來源：yt-dlp 播放（HLS、mp4）、m3u8；其他不行', () => {
    expect(canBoost(yt, 'ytdlp-hls')).toBe(true)
    expect(canBoost(yt, 'ytdlp-mp4')).toBe(true)
    expect(canBoost(hls, undefined)).toBe(true)
    expect(canBoost(yt, 'embed')).toBe(false)
    expect(canBoost(yt, 'resolving')).toBe(false)
    expect(canBoost(mp4, undefined)).toBe(false)
  })
  it('AC3、AC4：不能放大時實際用 100、滑桿最大 100；保存的值不變', () => {
    expect(effectiveVolume(150, false)).toBe(100)
    expect(effectiveVolume(150, true)).toBe(150)
    expect(effectiveVolume(60, false)).toBe(60)
    expect(volumeMax(true)).toBe(200)
    expect(volumeMax(false)).toBe(100)
  })
  it('100% 以下只用播放器的音量；超過時放大', () => {
    expect(volumeParts(50)).toEqual({ element: 0.5, gain: 1 })
    expect(volumeParts(100)).toEqual({ element: 1, gain: 1 })
    expect(volumeParts(200)).toEqual({ element: 1, gain: 2 })
  })
  it('保存的範圍 0–200 的整數', () => {
    expect(normalizeVolume(150.4)).toBe(150)
    expect(normalizeVolume(250)).toBe(200)
    expect(normalizeVolume(-1)).toBe(0)
    expect(normalizeVolume('x')).toBe(100)
  })
  it('AC5、AC7：音量 150 保存後再讀取不變；0.7.0 的值照舊', () => {
    const s = { ...defaultSettings(), slots: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', muted: false, volume: 150 }, { url: 'https://example.com/a.mp4', muted: false, volume: 70 }] }
    const read = parseSettings(JSON.stringify(s)).settings.slots
    expect(read[0]?.volume).toBe(150)
    expect(read[1]?.volume).toBe(70)
  })
})

describe('讀取動畫（R99）', () => {
  const base = { status: undefined, ytMode: undefined, isWeb: false, showInput: false } as const
  it('解析中、載入中顯示，文字不同', () => {
    expect(loadingKind({ ...base, ytMode: 'resolving', status: 'loading' })).toBe('resolving')
    expect(loadingKind({ ...base, status: 'loading' })).toBe('loading')
    expect(LOADING_TEXT.resolving).toBe('解析中…')
    expect(LOADING_TEXT.loading).toBe('載入中…')
  })
  it('播放中、暫停、錯誤、輸入網址、網頁來源不顯示', () => {
    expect(loadingKind({ ...base, status: 'playing' })).toBeNull()
    expect(loadingKind({ ...base, status: 'paused' })).toBeNull()
    expect(loadingKind({ ...base, status: 'error' })).toBeNull()
    expect(loadingKind({ ...base, status: 'loading', showInput: true })).toBeNull()
    expect(loadingKind({ ...base, status: 'loading', isWeb: true })).toBeNull()
  })
  it('載入、緩衝不到 0.5 秒不顯示', () => {
    expect(LOADING_DELAY_MS).toBe(500)
  })
})

describe('設定視窗的 yt-dlp 版本列（R96、R93）', () => {
  const s = { version: '2026.10.21', latest: '2026.10.26' }
  it('有新版：可以按「更新到 <版本>」', () => {
    expect(ytdlpRow({ ...s, state: 'available' })).toEqual({
      version: '2026.10.21',
      chip: { text: '有新版 2026.10.26', tone: 'warn' },
      button: { label: '更新到 2026.10.26', enabled: true }
    })
  })
  it('已是最新版、正在檢查、正在更新、找不到：按鈕停用；無法檢查：可以按', () => {
    expect(ytdlpRow({ ...s, state: 'latest' }).button.enabled).toBe(false)
    expect(ytdlpRow({ ...s, state: 'checking' }).button).toEqual({ label: '正在檢查…', enabled: false })
    expect(ytdlpRow({ ...s, state: 'updating' }).button).toEqual({ label: '正在更新…', enabled: false })
    expect(ytdlpRow({ ...s, state: 'missing', version: null })).toMatchObject({ version: '—', button: { enabled: false } })
    expect(ytdlpRow({ ...s, state: 'unknown' }).button).toEqual({ label: '檢查更新', enabled: true })
  })
})
