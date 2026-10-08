import type { WebFailure } from '../lib/webErrors'
import type { Progress } from '../lib/progress'

export type PlayStatus = 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlayerHandle {
  play(): void
  pause(): void
  /** 網頁來源的「只顯示影片」（R14 AC2） */
  requestVideoMode?(): void
  /** 目前的進度（R19）；還不知道長度、沒有主要影片時回傳 null */
  getProgress(): Progress | null
  /** 跳到指定的秒數，維持原本的播放或暫停狀態（R19） */
  seek(seconds: number): void
}

export interface PlayerProps {
  muted: boolean
  volume: number
  autoplay: boolean
  /** false 表示來源被隱藏（R4 AC3），要暫停 */
  active: boolean
  /** failure：網頁來源錯誤狀態的種類（R16），其他來源不使用 */
  onStatus(status: PlayStatus, failure?: WebFailure): void
}

/** 載入失敗或斷線時的自動重試次數（R2 AC7） */
export const MAX_RETRIES = 3
export const RETRY_DELAY_MS = 1500
