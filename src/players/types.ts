export type PlayStatus = 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlayerHandle {
  play(): void
  pause(): void
  /** 網頁來源的「只顯示影片」（R14 AC2） */
  requestVideoMode?(): void
}

export interface PlayerProps {
  muted: boolean
  volume: number
  autoplay: boolean
  /** false 表示來源被隱藏（R4 AC3），要暫停 */
  active: boolean
  onStatus(status: PlayStatus): void
}

/** 載入失敗或斷線時的自動重試次數（R2 AC7） */
export const MAX_RETRIES = 3
export const RETRY_DELAY_MS = 1500
