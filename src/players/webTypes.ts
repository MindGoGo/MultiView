// 程式和注入網頁的程式之間傳遞的資料（R13、R14）

/** 影片模式 / 整頁模式（R13、R14） */
export type WebMode = 'video' | 'page'

export type WebVideoStatus = 'loading' | 'playing' | 'paused' | 'ended'

/** 程式送給網頁的狀態；v 每次改變都加一，網頁用來判斷要不要往子框架傳 */
export interface WebState {
  v: number
  mode: WebMode
}

/** 網頁最上層框架每秒回報給程式 */
export interface WebReport {
  /** 是否找到主要影片 */
  found: boolean
  /** 主要影片的狀態；沒有找到時為 null */
  status: WebVideoStatus | null
}

/** 網頁來源使用的網站資料區（R18） */
export const WEB_PARTITION = 'web'
