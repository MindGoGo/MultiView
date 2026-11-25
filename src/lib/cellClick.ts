// 在影片格子上按左鍵、右鍵的效果（R171）。主程序與畫面共用，不依賴 DOM。

/** menu：在游標位置打開齒輪選單；solo：只聽這一格（R7）；play：播放／暫停這一格 */
export type CellClickAction = 'menu' | 'solo' | 'play'

/** 雙擊的效果（R174）：fullscreen 切換單格全螢幕（R20）；none 不作用 */
export type DoubleClickAction = CellClickAction | 'fullscreen' | 'none'

export interface CellClick {
  left: CellClickAction
  right: CellClickAction
  double: DoubleClickAction
}

export const CELL_CLICK_ACTIONS: { value: CellClickAction; label: string }[] = [
  { value: 'menu', label: '開啟選單' },
  { value: 'solo', label: '只聽這一格' },
  { value: 'play', label: '播放／暫停' }
]

export const DOUBLE_CLICK_ACTIONS: { value: DoubleClickAction; label: string }[] = [
  { value: 'fullscreen', label: '全螢幕' },
  ...CELL_CLICK_ACTIONS,
  { value: 'none', label: '不作用' }
]

/** 預設：左鍵照原本只聽這一格，右鍵打開齒輪選單，雙擊切換全螢幕 */
export const DEFAULT_CELL_CLICK: CellClick = { left: 'solo', right: 'menu', double: 'fullscreen' }

/** 等多久沒有第二下才算單擊（R174） */
export const DOUBLE_CLICK_MS = 250

/**
 * 單擊要不要等 DOUBLE_CLICK_MS 確定不是雙擊（R174）：雙擊有效果，而且單擊是「播放／暫停」或「開啟選單」
 * （連按兩次結果會不同）時才等；「只聽這一格」連按兩次結果相同，不用等。
 */
export const clickWaitsForDouble = (c: CellClick) => c.double !== 'none' && (c.left === 'play' || c.left === 'menu')

const isAction = (v: unknown): v is CellClickAction => CELL_CLICK_ACTIONS.some((a) => a.value === v)

/** 設定檔的 cellClick；沒有這個欄位（舊的設定檔）或不認得的值用預設值 */
export function normalizeCellClick(raw: unknown): CellClick {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    left: isAction(r.left) ? r.left : DEFAULT_CELL_CLICK.left,
    right: isAction(r.right) ? r.right : DEFAULT_CELL_CLICK.right,
    double: DOUBLE_CLICK_ACTIONS.some((a) => a.value === r.double) ? (r.double as DoubleClickAction) : DEFAULT_CELL_CLICK.double
  }
}
