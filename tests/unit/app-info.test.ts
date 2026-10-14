// R76：設定選單顯示版本號
import { describe, expect, it } from 'vitest'
import { versionLabel } from '../../src/lib/appInfo'

describe('versionLabel（R76）', () => {
  it('顯示程式的版本號', () => {
    expect(versionLabel('0.5.5')).toBe('MultiView 版本 0.5.5')
  })
})
