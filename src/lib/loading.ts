// 讀取動畫的顯示時機（R99）。不依賴 DOM，方便測試。
import type { PlayStatus } from '../players/types'
import type { YtMode } from '../players/YouTubeSource'

/** 載入中、緩衝中這麼久還沒恢復才顯示，避免閃爍；解析中立即顯示 */
export const LOADING_DELAY_MS = 500

export type LoadingKind = 'resolving' | 'loading'

/**
 * 這一格要不要顯示讀取動畫、顯示哪一種文字。
 * 網頁來源不顯示（網頁本身會逐步顯示內容）；錯誤、輸入網址、暫停中不顯示。
 */
export function loadingKind(opts: {
  status: PlayStatus | undefined
  ytMode: YtMode | undefined
  isWeb: boolean
  showInput: boolean
}): LoadingKind | null {
  if (opts.isWeb || opts.showInput) return null
  if (opts.ytMode === 'resolving') return 'resolving'
  return opts.status === 'loading' ? 'loading' : null
}

export const LOADING_TEXT: Record<LoadingKind, string> = {
  resolving: '解析中…',
  loading: '載入中…'
}
