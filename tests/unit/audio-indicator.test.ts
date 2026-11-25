// R173：左上角「這一格有聲音」的標示
import { describe, expect, it } from 'vitest'
import { DEFAULT_AUDIO_INDICATOR, indicatorFill, INDICATOR_STYLES, normalizeAudioIndicator } from '../../src/lib/audioIndicator'
import { defaultSettings, normalizeView, viewSettingsOf } from '../../src/lib/settings'

describe('有聲音的標示（R173）', () => {
  it('預設是白色、跳動的音波；舊的設定檔沒有這個欄位時也是', () => {
    expect(DEFAULT_AUDIO_INDICATOR).toEqual({ style: 'wave-animated', color: 'white' })
    expect(defaultSettings().audioIndicator).toEqual(DEFAULT_AUDIO_INDICATOR)
    expect(normalizeView({ layout: '2x2' }).audioIndicator).toEqual(DEFAULT_AUDIO_INDICATOR)
  })
  it('四種樣式：跳動的音波、音波（不動）、喇叭、不顯示', () => {
    expect(INDICATOR_STYLES.map((s) => s.value)).toEqual(['wave-animated', 'wave', 'speaker', 'none'])
  })
  it('保留合法的選擇；不認得的值改用預設值', () => {
    expect(normalizeAudioIndicator({ style: 'none', color: 'gradient' })).toEqual({ style: 'none', color: 'gradient' })
    expect(normalizeAudioIndicator({ style: 'x', color: 'blue' })).toEqual({ style: 'wave-animated', color: 'blue' })
    expect(normalizeAudioIndicator(null)).toEqual(DEFAULT_AUDIO_INDICATOR)
  })
  it('單色回傳顏色，漸層回傳 null（用 SVG 漸層）', () => {
    expect(indicatorFill('white')).toBe('#ffffff')
    expect(indicatorFill('gradient')).toBeNull()
  })
  it('交給畫面的設定包含這個欄位（0.9.3 漏傳的教訓）', () => {
    const s = defaultSettings()
    s.audioIndicator = { style: 'speaker', color: 'green' }
    expect(viewSettingsOf(s).audioIndicator).toEqual({ style: 'speaker', color: 'green' })
  })
})
