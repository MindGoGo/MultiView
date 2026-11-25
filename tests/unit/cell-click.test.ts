// R171：在影片格子上按左鍵、右鍵的效果
import { describe, expect, it } from 'vitest'
import { CELL_CLICK_ACTIONS, DEFAULT_CELL_CLICK, normalizeCellClick } from '../../src/lib/cellClick'
import { defaultSettings, normalizeView, viewSettingsOf } from '../../src/lib/settings'

describe('左右鍵的效果（R171）', () => {
  it('預設：左鍵只聽這一格、右鍵開啟選單', () => {
    expect(DEFAULT_CELL_CLICK).toEqual({ left: 'solo', right: 'menu' })
    expect(defaultSettings().cellClick).toEqual({ left: 'solo', right: 'menu' })
  })
  it('三種效果都可以選', () => {
    expect(CELL_CLICK_ACTIONS.map((a) => a.value)).toEqual(['menu', 'solo', 'play'])
  })
  it('舊的設定檔沒有這個欄位時用預設值', () => {
    expect(normalizeView({ layout: '2x2' }).cellClick).toEqual(DEFAULT_CELL_CLICK)
  })
  it('保留合法的選擇；不認得的值改用預設值', () => {
    expect(normalizeCellClick({ left: 'play', right: 'solo' })).toEqual({ left: 'play', right: 'solo' })
    expect(normalizeCellClick({ left: 'menu', right: 'x' })).toEqual({ left: 'menu', right: 'menu' })
    expect(normalizeCellClick('menu')).toEqual(DEFAULT_CELL_CLICK)
  })
})

describe('交給畫面的設定（R171 修正）', () => {
  it('包含 cellClick、companionOnLaunch 等所有畫面的設定，不含視窗位置', () => {
    const s = defaultSettings()
    s.cellClick = { left: 'play', right: 'solo' }
    s.companionOnLaunch = true
    const view = viewSettingsOf(s)
    expect(view.cellClick).toEqual({ left: 'play', right: 'solo' })
    expect(view.companionOnLaunch).toBe(true)
    expect(Object.keys(view).sort()).toEqual(Object.keys(normalizeView({})).sort())
    expect(view).not.toHaveProperty('window')
    expect(view).not.toHaveProperty('companion')
  })
})
