// R171：在影片格子上按左鍵、右鍵的效果
import { describe, expect, it } from 'vitest'
import { CELL_CLICK_ACTIONS, clickWaitsForDouble, DEFAULT_CELL_CLICK, DOUBLE_CLICK_ACTIONS, normalizeCellClick } from '../../src/lib/cellClick'
import { defaultSettings, normalizeView, viewSettingsOf } from '../../src/lib/settings'

describe('左右鍵的效果（R171）', () => {
  it('預設：左鍵只聽這一格、右鍵開啟選單', () => {
    expect(DEFAULT_CELL_CLICK).toEqual({ left: 'solo', right: 'menu', double: 'fullscreen' })
    expect(defaultSettings().cellClick).toEqual(DEFAULT_CELL_CLICK)
  })
  it('三種效果都可以選', () => {
    expect(CELL_CLICK_ACTIONS.map((a) => a.value)).toEqual(['menu', 'solo', 'play'])
  })
  it('舊的設定檔沒有這個欄位時用預設值', () => {
    expect(normalizeView({ layout: '2x2' }).cellClick).toEqual(DEFAULT_CELL_CLICK)
  })
  it('保留合法的選擇；不認得的值改用預設值', () => {
    expect(normalizeCellClick({ left: 'play', right: 'solo' })).toEqual({ left: 'play', right: 'solo', double: 'fullscreen' })
    expect(normalizeCellClick({ left: 'menu', right: 'x', double: 'none' })).toEqual({ left: 'menu', right: 'menu', double: 'none' })
    expect(normalizeCellClick({ double: 'zoom' }).double).toBe('fullscreen')
    expect(normalizeCellClick('menu')).toEqual(DEFAULT_CELL_CLICK)
  })
})

describe('交給畫面的設定（R171 修正）', () => {
  it('包含 cellClick、companionOnLaunch 等所有畫面的設定，不含視窗位置', () => {
    const s = defaultSettings()
    s.cellClick = { left: 'play', right: 'solo', double: 'none' }
    s.companionOnLaunch = true
    const view = viewSettingsOf(s)
    expect(view.cellClick).toEqual({ left: 'play', right: 'solo', double: 'none' })
    expect(view.companionOnLaunch).toBe(true)
    expect(Object.keys(view).sort()).toEqual(Object.keys(normalizeView({})).sort())
    expect(view).not.toHaveProperty('window')
    expect(view).not.toHaveProperty('companion')
  })
})

describe('雙擊（R174）', () => {
  it('雙擊的選項：全螢幕、開啟選單、只聽這一格、播放／暫停、不作用', () => {
    expect(DOUBLE_CLICK_ACTIONS.map((a) => a.value)).toEqual(['fullscreen', 'menu', 'solo', 'play', 'none'])
  })
  it('單擊只在需要時等：雙擊有效果，而且單擊是播放／暫停或開啟選單', () => {
    expect(clickWaitsForDouble({ left: 'solo', right: 'menu', double: 'fullscreen' })).toBe(false)
    expect(clickWaitsForDouble({ left: 'play', right: 'menu', double: 'fullscreen' })).toBe(true)
    expect(clickWaitsForDouble({ left: 'menu', right: 'solo', double: 'solo' })).toBe(true)
    expect(clickWaitsForDouble({ left: 'play', right: 'menu', double: 'none' })).toBe(false)
  })
})
