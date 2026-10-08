// R26：播放按鈕的圖示；R27：整頁模式右鍵選單的項目與可用狀態
import { describe, expect, it } from 'vitest'
import { pageMenuItems, type PageMenuContext } from '../../src/lib/pageMenu'
import { isPlayingStatus } from '../../src/lib/playback'

const ctx = (over: Partial<PageMenuContext> = {}): PageMenuContext => ({
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
  linkURL: '',
  canGoBack: false,
  canGoForward: false,
  ...over
})

const labels = (c: PageMenuContext) =>
  pageMenuItems(c).map((i) => (i.type === 'separator' ? '|' : `${i.label}${i.enabled ? '' : '(灰)'}`))

describe('pageMenuItems（R27）', () => {
  it('順序：剪下、複製、貼上、全選｜上一頁、下一頁、重新整理', () => {
    expect(labels(ctx())).toEqual(['剪下(灰)', '複製(灰)', '貼上(灰)', '全選', '|', '上一頁(灰)', '下一頁(灰)', '重新整理'])
  })

  it('AC1：選取文字時可以複製', () => {
    expect(labels(ctx({ editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true } }))[1]).toBe('複製')
  })

  it('AC2：在輸入框中可以剪下、貼上', () => {
    const l = labels(ctx({ editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }))
    expect(l.slice(0, 4)).toEqual(['剪下', '複製', '貼上', '全選'])
  })

  it('AC3：沒有選取文字、不在輸入框時剪下、複製、貼上是灰色', () => {
    expect(labels(ctx()).slice(0, 3)).toEqual(['剪下(灰)', '複製(灰)', '貼上(灰)'])
  })

  it('AC4：在連結上按右鍵時最後多「複製連結網址」', () => {
    const l = labels(ctx({ linkURL: 'https://example.com/a' }))
    expect(l.slice(-2)).toEqual(['|', '複製連結網址'])
    expect(labels(ctx())).not.toContain('複製連結網址')
  })

  it('R28：有上一頁／下一頁時可以按', () => {
    const l = labels(ctx({ canGoBack: true, canGoForward: true }))
    expect(l.slice(5, 7)).toEqual(['上一頁', '下一頁'])
  })

  it('AC5：重新整理一律可以按', () => {
    const reload = pageMenuItems(ctx()).find((i) => i.type === 'item' && i.action === 'reload')
    expect(reload).toMatchObject({ enabled: true })
  })
})

describe('isPlayingStatus（R26 按鈕圖示）', () => {
  it('播放中、緩衝中顯示暫停（❚❚）', () => {
    expect(isPlayingStatus('playing')).toBe(true)
    expect(isPlayingStatus('loading')).toBe(true)
  })

  it('暫停、播完、錯誤、還不知道時顯示播放（▶）', () => {
    expect(isPlayingStatus('paused')).toBe(false)
    expect(isPlayingStatus('ended')).toBe(false)
    expect(isPlayingStatus('error')).toBe(false)
    expect(isPlayingStatus(undefined)).toBe(false)
  })
})
