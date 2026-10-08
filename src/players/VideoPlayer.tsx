// mp4 與 m3u8（hls.js）共用的播放器（R2）
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Hls from 'hls.js'
import { MAX_RETRIES, RETRY_DELAY_MS, type PlayerHandle, type PlayerProps } from './types'

interface Props extends PlayerProps {
  kind: 'hls' | 'mp4'
  url: string
}

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(
  { kind, url, muted, volume, autoplay, active, onStatus },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** 使用者希望的播放狀態；重試重新載入後依此決定要不要繼續播放 */
  const wantPlay = useRef(autoplay)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    const video = videoRef.current!
    let hls: Hls | null = null
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const report = (s: Parameters<typeof onStatus>[0]) => !disposed && onStatusRef.current(s)

    const tryPlay = () => {
      if (wantPlay.current) void video.play().catch(() => undefined)
    }

    const load = () => {
      if (kind === 'hls' && Hls.isSupported()) {
        hls?.destroy()
        hls = new Hls()
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) fail()
        })
        hls.on(Hls.Events.FRAG_LOADED, () => (retries = 0))
        hls.loadSource(url)
        hls.attachMedia(video)
      } else {
        const resumeAt = video.currentTime
        video.src = url
        if (resumeAt > 0) {
          video.addEventListener('loadedmetadata', () => (video.currentTime = resumeAt), {
            once: true
          })
        }
        video.load()
      }
      tryPlay()
    }

    const fail = () => {
      if (retries >= MAX_RETRIES) {
        hls?.destroy()
        hls = null
        report('error')
        return
      }
      retries++
      report('loading')
      clearTimeout(retryTimer)
      retryTimer = setTimeout(load, RETRY_DELAY_MS)
    }

    const onPlaying = () => {
      retries = 0
      report('playing')
    }
    const onPause = () => !video.ended && report('paused')
    const onEnded = () => report('ended')
    const onWaiting = () => report('loading')
    const onCanPlay = () => {
      if (video.paused && !wantPlay.current) report('paused')
    }
    // hls.js 自己處理 video 的錯誤；mp4 才需要聽 video 的 error
    const onError = () => kind === 'mp4' && fail()

    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('error', onError)
    report('loading')
    load()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      hls?.destroy()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
      video.removeAttribute('src')
      video.load()
    }
  }, [kind, url])

  useEffect(() => {
    videoRef.current!.muted = muted
  }, [muted])

  useEffect(() => {
    videoRef.current!.volume = volume / 100
  }, [volume])

  useEffect(() => {
    if (!active) {
      wantPlay.current = false
      videoRef.current!.pause()
    }
  }, [active])

  useImperativeHandle(ref, () => ({
    play: () => {
      wantPlay.current = true
      void videoRef.current!.play().catch(() => undefined)
    },
    pause: () => {
      wantPlay.current = false
      videoRef.current!.pause()
    }
  }))

  // mp4 播完停在最後一個畫面，不重播（R2 AC3）
  return <video className="player" ref={videoRef} playsInline muted={muted} />
})
