import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { loadYouTubeApi, YT_STATE, type YTPlayer } from './youtubeApi'
import type { PlayerHandle, PlayerProps, PlayStatus } from './types'
import type { Progress } from '../lib/progress'

interface Props extends PlayerProps {
  videoId: string
}

export const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, muted, volume, autoplay, active, onStatus },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const readyRef = useRef(false)
  // 讓 effect 內的 callback 永遠拿到最新的 props
  const latest = useRef({ muted, volume, onStatus })
  latest.current = { muted, volume, onStatus }

  useEffect(() => {
    let cancelled = false
    // YouTube API 會把元素換成 iframe，所以另外建一個不歸 React 管的元素給它
    const target = document.createElement('div')
    hostRef.current!.appendChild(target)
    latest.current.onStatus('loading')

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        playerRef.current = new YT.Player(target, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            mute: latest.current.muted ? 1 : 0,
            controls: 0,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            disablekb: 1,
            fs: 0,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: ({ target: p }) => {
              readyRef.current = true
              const { muted: m, volume: v } = latest.current
              p.setVolume(v)
              if (m) p.mute()
              else p.unMute()
              if (autoplay) p.playVideo()
              else latest.current.onStatus('paused')
            },
            onStateChange: ({ data }) => {
              const map: Record<number, PlayStatus> = {
                [YT_STATE.PLAYING]: 'playing',
                [YT_STATE.PAUSED]: 'paused',
                [YT_STATE.ENDED]: 'ended',
                [YT_STATE.BUFFERING]: 'loading',
                [YT_STATE.CUED]: 'paused'
              }
              const status = map[data]
              if (status) latest.current.onStatus(status)
            },
            // 100 找不到 / 101、150 禁止內嵌 / 2 參數錯誤 / 5 HTML5 播放器錯誤（R2 AC6）
            onError: () => latest.current.onStatus('error')
          }
        })
      })
      .catch(() => {
        if (!cancelled) latest.current.onStatus('error')
      })

    return () => {
      cancelled = true
      readyRef.current = false
      playerRef.current?.destroy()
      playerRef.current = null
      target.remove()
    }
    // autoplay 只在載入時使用
  }, [videoId])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !readyRef.current) return
    if (muted) p.mute()
    else p.unMute()
  }, [muted])

  useEffect(() => {
    const p = playerRef.current
    if (p && readyRef.current) p.setVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!active && readyRef.current) playerRef.current?.pauseVideo()
  }, [active])

  useImperativeHandle(ref, () => ({
    play: () => readyRef.current && playerRef.current?.playVideo(),
    pause: () => readyRef.current && playerRef.current?.pauseVideo(),
    getTitle: () => (readyRef.current && playerRef.current?.getVideoData().title) || null,
    getProgress: (): Progress | null => {
      const p = playerRef.current
      if (!p || !readyRef.current) return null
      const current = p.getCurrentTime()
      const data = p.getVideoData()
      if (data.isLive) {
        // 直播的 getDuration 和 getCurrentTime 不同步，用播放器回報的可回放範圍；不能倒轉時只顯示 LIVE
        const ps = p.playerInfo?.progressState
        if (data.allowLiveDvr === false || !ps || !(ps.seekableEnd > ps.seekableStart))
          return { current, start: current, end: current, live: true }
        return { current: ps.current, start: ps.seekableStart, end: Math.max(ps.seekableEnd, ps.current), live: true }
      }
      const duration = p.getDuration()
      return duration > 0 ? { current, start: 0, end: duration, live: false } : null
    },
    seek: (seconds) => {
      const p = playerRef.current
      if (!p || !readyRef.current) return
      const wasPlaying = p.getPlayerState() === YT_STATE.PLAYING || p.getPlayerState() === YT_STATE.BUFFERING
      p.seekTo(seconds, true)
      // YouTube 在暫停或播完時跳轉會自動開始播放，依規格維持原本的狀態（R19 AC2、AC11）
      if (!wasPlaying) p.pauseVideo()
    }
  }))

  return <div className="player yt-host" ref={hostRef} />
})
