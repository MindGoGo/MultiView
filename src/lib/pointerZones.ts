// 整頁模式時工具列的感應區與操作列的小把手（R116、R117）。不依賴 DOM，方便測試。

/** 一般的感應區，也是工具列的高度 */
export const TOOLBAR_ZONE_PX = 40
/** 滑鼠在整頁模式的格子上方時，要進到視窗最上面這個範圍 */
export const EDGE_ZONE_PX = 6
/** 而且要停留這麼久，工具列才出現 */
export const EDGE_DWELL_MS = 300
/** 滑鼠離開操作列這麼久後收回小把手 */
export const HANDLE_COLLAPSE_MS = 300

/** show：顯示工具列；dwell：開始或繼續等待停留；leave：不在感應區 */
export type ToolbarZone = 'show' | 'dwell' | 'leave'

export function toolbarZone(opts: { y: number; inside: boolean; visible: boolean; overPage: boolean }): ToolbarZone {
  if (!opts.inside || opts.y >= TOOLBAR_ZONE_PX) return 'leave'
  // 工具列已經出現時，整個工具列的高度都算，滑鼠才移得到按鈕上
  if (opts.visible || !opts.overPage) return 'show'
  return opts.y < EDGE_ZONE_PX ? 'dwell' : 'leave'
}

export type ControlsView = 'none' | 'handle' | 'bar'

/** busy：選單、滑桿開著，或正在拖曳進度條、換位，這時不收回 */
export function controlsView(opts: { pageMode: boolean; shown: boolean; expanded: boolean; busy: boolean }): ControlsView {
  if (!opts.shown) return 'none'
  return !opts.pageMode || opts.expanded || opts.busy ? 'bar' : 'handle'
}
