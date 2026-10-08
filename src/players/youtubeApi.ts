// 載入 YouTube IFrame Player API。只宣告用得到的型別。

export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  mute(): void
  unMute(): void
  setVolume(volume: number): void
  destroy(): void
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
