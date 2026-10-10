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

/** YouTube 播放器的錯誤種類（R48）：禁止嵌入、找不到影片、其他 */
export type YouTubeFailure = 'embed' | 'missing' | 'other'

/** 錯誤狀態的種類（網頁來源或 YouTube） */
export type Failure = WebFailure | YouTubeFailure

/** YouTube 錯誤碼：100 找不到 / 101、150 禁止嵌入 / 其他（2 參數錯誤、5 HTML5 播放器錯誤等） */
export function youtubeFailure(code: number): YouTubeFailure {
  if (code === 101 || code === 150) return 'embed'
  if (code === 100) return 'missing'
  return 'other'
}

export const YOUTUBE_FAILURE_TEXT: Record<YouTubeFailure, string> = {
  embed: '此影片無法在外部播放',
  missing: '找不到這部影片，可能已刪除或不公開',
  other: '這部影片無法播放'
}
