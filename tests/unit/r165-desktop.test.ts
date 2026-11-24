// R165（桌面版）：開啟程式時打開小視窗的條件與設定檔欄位
import { describe, expect, it } from 'vitest'
import { companionOnLaunchCell } from '../../src/lib/companion'
import { cellCount } from '../../src/lib/layout'
import { defaultSettings, normalizeView, parseSettings } from '../../src/lib/settings'

describe('開啟程式時打開小視窗（R165）', () => {
  it('AC1：設定打開、只有一格（版型 1 或只有一格的自訂版型）→ 打開並連結第 1 格', () => {
    expect(companionOnLaunchCell(true, cellCount('1'), null)).toBe(0)
  })
  it('多格時不打開', () => {
    for (const layout of ['2', '2x2', '3x3'] as const) expect(companionOnLaunchCell(true, cellCount(layout), null)).toBeNull()
  })
  it('單格全螢幕算畫面上只有一格，連結那一格', () => {
    expect(companionOnLaunchCell(true, 4, 2)).toBe(2)
  })
  it('設定關閉時不打開', () => {
    expect(companionOnLaunchCell(false, 1, null)).toBeNull()
    expect(companionOnLaunchCell(false, 4, 1)).toBeNull()
  })
})

describe('設定檔的 companionOnLaunch（R165）', () => {
  it('預設關閉；舊的設定檔沒有這個欄位時視為關閉', () => {
    expect(defaultSettings().companionOnLaunch).toBe(false)
    expect(normalizeView({ layout: '1' }).companionOnLaunch).toBe(false)
    expect(parseSettings(JSON.stringify({ version: 1 })).settings.companionOnLaunch).toBe(false)
  })
  it('只接受 true', () => {
    expect(normalizeView({ companionOnLaunch: true }).companionOnLaunch).toBe(true)
    expect(normalizeView({ companionOnLaunch: 'yes' }).companionOnLaunch).toBe(false)
  })
})
