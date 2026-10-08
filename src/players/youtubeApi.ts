// 載入 YouTube IFrame Player API。只宣告用得到的型別。

export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  mute(): void
  unMute(): void
  setVolume(volume: number): void
  destroy(): void
  getCurrentTime(): number
  getDuration(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getPlayerState(): number
  getPlaybackQuality(): string
  /** 沒有公開文件，但實際有 title；直播時 isLive 為 true，allowLiveDvr 表示能不能倒轉 */
  getVideoData(): { title?: string; isLive?: boolean; allowLiveDvr?: boolean }
  /**
   * 沒有公開文件：播放器回報給頁面的最新狀態。直播的 getDuration 和 getCurrentTime 不同步，
   * 可回放範圍要用 progressState（R19）。
   */
  playerInfo?: {
    progressState?: { current: number; seekableStart: number; seekableEnd: number; isAtLiveHead?: boolean }
  }
}

export interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      width?: string
      height?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: number; target: YTPlayer }) => void
        onError?: (e: { data: number }) => void
      }
    }
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let loading: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      loading = null
      reject(new Error('無法載入 YouTube 播放器'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/** YT.PlayerState */
export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
