// R63：回到 YouTube 頁面
import { describe, expect, it } from 'vitest'
import { guestKeyAction, isRepeatableKey, shortcutFor } from '../../src/lib/shortcuts'
import { normalizeView } from '../../src/lib/settings'

const VIDEO = 'https://www.youtube.com/watch?v=tBfHI8sNWVU'
const PAGE = 'https://www.youtube.com/results?search_query=TED+talk'

describe('回到 YouTube 頁面的按鍵（R63）', () => {
  it('Backspace 與滑鼠「上一頁」側鍵都是回到 YouTube 頁面', () => {
    expect(shortcutFor('Backspace')).toEqual({ type: 'back' })
    expect(shortcutFor('BrowserBack')).toEqual({ type: 'back' })
  })

  it('按住 Backspace 不會連續作用', () => {
    expect(isRepeatableKey('Backspace')).toBe(false)
  })

  it('整頁模式的網頁有焦點時 Backspace 交給網頁；影片模式轉給程式', () => {
    expect(guestKeyAction('Backspace', 'page')).toBe('page')
    expect(guestKeyAction('Backspace', 'video')).toBe('forward')
  })
})

describe('設定檔中的來源頁面（R63 AC7）', () => {
  it('保存的來源頁面讀回不變', () => {
    expect(normalizeView({ slots: [{ url: VIDEO, backUrl: PAGE }] }).slots[0]?.backUrl).toBe(PAGE)
  })

  it('舊的設定檔、不是 YouTube 網站頁面的網址 → 沒有來源頁面', () => {
    const v = normalizeView({
      slots: [{ url: VIDEO }, { url: VIDEO, backUrl: 'https://example.com/' }, { url: VIDEO, backUrl: VIDEO }, { url: VIDEO, backUrl: 3 }]
    })
    expect(v.slots.slice(0, 4).map((s) => s?.backUrl)).toEqual([null, null, null, null])
  })
})
