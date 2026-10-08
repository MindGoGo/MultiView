// 網頁來源的播放意圖與自動切換整頁模式的判斷（R13、R15）。不依賴 DOM，方便測試。
import type { WebMode, WebReport, WebState } from '../players/webTypes'

/**
 * 整頁模式中使用者直接按網站的播放 / 暫停，也算播放意圖（R15 AC7）。
 * 只採用網頁已經收到最新狀態後的回報，避免蓋掉剛送出的操作。
 * 回傳新的播放意圖；不需要改變時回傳 null。
 */
export function intentFromReport(state: WebState, report: Pick<WebReport, 'status' | 'v'>): WebState['intent'] | null {
  if (state.mode !== 'page' || report.v !== state.v) return null
  if (report.status === 'playing' && state.intent === 'pause') return 'play'
  if (report.status === 'paused' && state.intent === 'play') return 'pause'
  return null
}

/** 是否要開始「找不到影片」的計時（R13 AC4、AC3-3）：影片模式、網頁已載入、沒有主要影片、不是錯誤狀態 */
export function shouldWaitForVideo(p: { mode: WebMode; loaded: boolean; found: boolean; failed: boolean }): boolean {
  return p.mode === 'video' && p.loaded && !p.found && !p.failed
}
