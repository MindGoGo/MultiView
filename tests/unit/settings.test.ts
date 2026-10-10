// R10：設定檔驗證、讀寫、損毀處理；R1 AC4：視窗位置還原
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, normalizeView, parseSettings } from '../../src/lib/settings'
import { createSaver, loadSettings, writeSettings } from '../../electron/store'
import { isOnSomeDisplay, MIN_HEIGHT, MIN_WIDTH, resolveBounds } from '../../electron/windowState'

const YT = 'https://www.youtube.com/watch?v=jfKfPfyJRdk'

describe('parseSettings（R10）', () => {
  it('合法的設定原樣讀回', () => {
    const s = {
      ...defaultSettings(),
      layout: '3x3',
      ratios: { '2': { cols: [0.7, 0.3], rows: [1] } },
      slots: [{ url: YT, muted: false, volume: 40, adblock: true, quality: 'auto', captions: null, brightness: 100, youtubeWeb: false }, null, null, null, null, null, null, null, null]
    }
    const { settings, corrupt } = parseSettings(JSON.stringify(s))
    expect(corrupt).toBe(false)
    expect(settings).toEqual(s)
  })

  it('AC2：JSON 格式錯誤視為損毀，使用預設值', () => {
    const { settings, corrupt } = parseSettings('{ not json')
    expect(corrupt).toBe(true)
    expect(settings).toEqual(defaultSettings())
    expect(settings.layout).toBe('2x2')
  })

  it('AC2：整體結構不對（不是物件、版本不符）視為損毀', () => {
    expect(parseSettings('[]').corrupt).toBe(true)
    expect(parseSettings('null').corrupt).toBe(true)
    expect(parseSettings('{"version":2}').corrupt).toBe(true)
  })

  it('個別欄位不合法時只替換該欄位', () => {
    const { settings, corrupt } = parseSettings(
      JSON.stringify({
        version: 1,
        window: { width: 'big', height: 500, x: 10 },
        layout: '4x4',
        ratios: { '2': { cols: [0.9, 0.9], rows: [1] }, '2x2': { cols: [0.6, 0.4], rows: [0.5, 0.5] } },
        slots: [
          { url: 'ftp://example.com/a.mp4', muted: false },
          { url: YT, volume: 250 },
          'garbage'
        ]
      })
    )
    expect(corrupt).toBe(false)
    expect(settings.window).toEqual({ width: 1280, height: 500, alwaysOnTop: false })
    expect(settings.layout).toBe('2x2')
    expect(settings.ratios).toEqual({ '2x2': { cols: [0.6, 0.4], rows: [0.5, 0.5] } })
    expect(settings.slots[0]).toBeNull() // 不支援的網址
    expect(settings.slots[1]).toEqual({ url: YT, muted: false, volume: 100, adblock: true, quality: 'auto', captions: null, brightness: 100, youtubeWeb: false })
    expect(settings.slots[2]).toBeNull()
    expect(settings.slots).toHaveLength(9)
  })

  it('normalizeView 會補齊或截斷成 9 個格位', () => {
    expect(normalizeView({ slots: [] }).slots).toHaveLength(9)
    expect(normalizeView({ slots: Array(20).fill({ url: YT }) }).slots).toHaveLength(9)
    expect(normalizeView(undefined).layout).toBe('2x2')
  })
})

describe('設定檔讀寫（R10）', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiview-test-'))
    file = path.join(dir, 'settings.json')
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('沒有設定檔時使用預設值', () => {
    expect(loadSettings(file)).toEqual(defaultSettings())
  })

  it('AC1：寫入後可以讀回', () => {
    const s = { ...defaultSettings(), layout: '1+3' as const }
    writeSettings(file, s)
    expect(loadSettings(file)).toEqual(s)
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('AC2：損毀的設定檔改名成 settings.json.bak 保留，並使用預設值', () => {
    fs.writeFileSync(file, '{ broken')
    expect(loadSettings(file)).toEqual(defaultSettings())
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe('{ broken')
  })

  it('AC3：變更後 1 秒內寫入，多次變更合併成一次', () => {
    vi.useFakeTimers()
    const saver = createSaver(file)
    saver.schedule({ ...defaultSettings(), layout: '1' })
    saver.schedule({ ...defaultSettings(), layout: '3x3' })
    expect(fs.existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(loadSettings(file).layout).toBe('3x3')
  })

  it('flush 立即寫入（關閉程式時）', () => {
    const saver = createSaver(file)
    saver.schedule({ ...defaultSettings(), layout: '2' })
    saver.flush()
    expect(loadSettings(file).layout).toBe('2')
  })
})

describe('視窗位置還原（R1 AC4）', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const second = { x: 1920, y: 0, width: 2560, height: 1400 }

  it('位置還在螢幕內時照原樣還原', () => {
    const saved = { x: 2000, y: 100, width: 1600, height: 900 }
    expect(resolveBounds(saved, [primary, second], primary)).toEqual(saved)
  })

  it('位置不在任何螢幕內時，在主螢幕置中', () => {
    const b = resolveBounds({ x: 5000, y: 100, width: 1280, height: 720 }, [primary], primary)
    expect(b).toEqual({ x: 320, y: 160, width: 1280, height: 720 })
  })

  it('置中時大小不超過主螢幕', () => {
    const b = resolveBounds({ x: 5000, y: 0, width: 2500, height: 1400 }, [primary], primary)
    expect([b.width, b.height]).toEqual([1920, 1040])
  })

  it('沒有記錄位置時置中', () => {
    const b = resolveBounds({ width: 1280, height: 720 }, [primary], primary)
    expect([b.x, b.y]).toEqual([320, 160])
  })

  it('AC5：大小不小於 480×270', () => {
    const b = resolveBounds({ x: 10, y: 10, width: 100, height: 50 }, [primary], primary)
    expect([b.width, b.height]).toEqual([MIN_WIDTH, MIN_HEIGHT])
  })

  it('只露出一小角（不到 100px）不算在螢幕內', () => {
    expect(isOnSomeDisplay({ x: 1880, y: 0, width: 800, height: 600 }, [primary])).toBe(false)
    expect(isOnSomeDisplay({ x: 1800, y: 0, width: 800, height: 600 }, [primary])).toBe(true)
  })
})
