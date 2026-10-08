// 網頁來源的錯誤判斷（R16）。不依賴 Electron，方便測試。

/** 從開始載入算起，這麼久還沒有「網頁載入完成」就算失敗（R16） */
export const LOAD_TIMEOUT_MS = 30000

/** Chromium 的 ERR_ABORTED：導覽被新的導覽取代或被停止，不是載入失敗 */
const ERR_ABORTED = -3

/**
 * did-fail-load 是否算網頁載入失敗：只看主框架，子項目（圖片、廣告等）失敗不算（R16 AC7）。
 * 找不到網站、連線失敗、憑證錯誤都會以負數的錯誤碼出現在這裡。
 */
export function isLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode < 0 && errorCode !== ERR_ABORTED
}

/** 主文件的 HTTP 狀態碼是否算載入失敗（R16 AC2）；拿不到狀態碼（例如 0）時不算 */
export function isHttpFailure(status: number | null | undefined): boolean {
  return typeof status === 'number' && status >= 400
}

/** 錯誤狀態的種類：網頁載入失敗，或主要影片需要 DRM（R16） */
export type WebFailure = 'load' | 'drm'

export const WEB_FAILURE_TEXT: Record<WebFailure, string> = {
  load: '無法載入網頁',
  drm: '這個影片有版權保護，無法播放'
}
