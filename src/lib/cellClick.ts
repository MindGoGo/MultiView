// 在影片格子上按左鍵、右鍵的效果（R171）。主程序與畫面共用，不依賴 DOM。

/** menu：在游標位置打開齒輪選單；solo：只聽這一格（R7）；play：播放／暫停這一格 */
export type CellClickAction = 'menu' | 'solo' | 'play'

export interface CellClick {
  left: CellClickAction
  right: CellClickAction
}

export const CELL_CLICK_ACTIONS: { value: CellClickAction; label: string }[] = [
  { value: 'menu', label: '開啟選單' },
  { value: 'solo', label: '只聽這一格' },
  { value: 'play', label: '播放／暫停' }
]

/** 預設：左鍵照原本只聽這一格，右鍵打開齒輪選單 */
export const DEFAULT_CELL_CLICK: CellClick = { left: 'solo', right: 'menu' }

const isAction = (v: unknown): v is CellClickAction => CELL_CLICK_ACTIONS.some((a) => a.value === v)

/** 設定檔的 cellClick；沒有這個欄位（舊的設定檔）或不認得的值用預設值 */
export function normalizeCellClick(raw: unknown): CellClick {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    left: isAction(r.left) ? r.left : DEFAULT_CELL_CLICK.left,
    right: isAction(r.right) ? r.right : DEFAULT_CELL_CLICK.right
  }
}
