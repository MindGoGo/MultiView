// R116 整頁模式時工具列的感應區、R117 操作列的小把手
import { describe, expect, it } from 'vitest'
import { controlsView, EDGE_DWELL_MS, EDGE_ZONE_PX, TOOLBAR_ZONE_PX, toolbarZone } from '../../src/lib/pointerZones'

const hidden = { inside: true, visible: false }

describe('工具列的感應區（R116）', () => {
  it('AC1：整頁模式的格子上方，上緣以下不觸發', () => {
    expect(toolbarZone({ ...hidden, overPage: true, y: EDGE_ZONE_PX })).toBe('leave')
    expect(toolbarZone({ ...hidden, overPage: true, y: 20 })).toBe('leave')
  })
  it('AC2、AC3：上緣要停留，由呼叫端計時 0.3 秒', () => {
    expect(toolbarZone({ ...hidden, overPage: true, y: 0 })).toBe('dwell')
    expect(toolbarZone({ ...hidden, overPage: true, y: EDGE_ZONE_PX - 1 })).toBe('dwell')
    expect(EDGE_DWELL_MS).toBe(300)
  })
  it('AC2：工具列出現後，整個工具列的高度都維持顯示', () => {
    expect(toolbarZone({ inside: true, visible: true, overPage: true, y: 30 })).toBe('show')
    expect(toolbarZone({ inside: true, visible: true, overPage: true, y: TOOLBAR_ZONE_PX })).toBe('leave')
  })
  it('AC4：其他格子上方，最上面 40 像素立即顯示', () => {
    expect(toolbarZone({ ...hidden, overPage: false, y: 39 })).toBe('show')
    expect(toolbarZone({ ...hidden, overPage: false, y: TOOLBAR_ZONE_PX })).toBe('leave')
  })
  it('滑鼠在視窗外不觸發', () => {
    expect(toolbarZone({ inside: false, visible: true, overPage: false, y: 0 })).toBe('leave')
  })
})

describe('操作列的小把手（R117）', () => {
  const page = { pageMode: true, shown: true, expanded: false, busy: false }
  it('AC1：整頁模式平常只有小把手', () => {
    expect(controlsView(page)).toBe('handle')
  })
  it('AC2：展開後是操作列', () => {
    expect(controlsView({ ...page, expanded: true })).toBe('bar')
  })
  it('AC4：選單、滑桿開著時不收回', () => {
    expect(controlsView({ ...page, busy: true })).toBe('bar')
  })
  it('AC6：影片模式沒有小把手', () => {
    expect(controlsView({ ...page, pageMode: false })).toBe('bar')
  })
  it('滑鼠不在格子上時都不顯示', () => {
    expect(controlsView({ ...page, shown: false, expanded: true })).toBe('none')
  })
})
