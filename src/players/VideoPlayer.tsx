// mp4 與 m3u8（hls.js）共用的播放器（R2）
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Hls from 'hls.js'
import { MAX_RETRIES, RETRY_DELAY_MS, type PlayerHandle, type PlayerProps } from './types'
import { progressFromMedia, rangesOf } from '../lib/progress'
import type { Quality } from '../lib/slots'
import { capLevelFor, hlsHeights, pickHlsLevel } from '../lib/quality'
import { audioOptions, currentOption, pickAudioTrack } from '../lib/audioTracks'

interface Props extends PlayerProps {
  kind: 'hls' | 'mp4'
  url: string
  /** m3u8 的畫質：選擇特定畫質時固定使用，「自動」依格子大小和網路速度（R24、R32）；mp4 不使用 */
  quality: Quality
  /** yt-dlp 解析的串流（R89）：網址會過期，重試和過期後播放時先重新取得網址 */
  renew?: Renew
  /** 記住的語音語言；null 為自動（R95） */
  audioLang?: string | null
}

export interface Renew {
  expiresAt: number
  /** 重新解析（不用快取）；失敗時回傳 null */
  refresh(): Promise<{ url: string; expiresAt: number } | null>
}

/** 網址到期前這麼久按播放，就先重新解析（R89） */
const RENEW_BEFORE_MS = 60_000

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(
  { kind, url, quality, muted, volume, autoplay, active, startAt, onStatus, renew, audioLang = null },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** 使用者希望的播放狀態；重試重新載入後依此決定要不要繼續播放 */
  const wantPlay = useRef(autoplay)
  const hlsRef = useRef<Hls | null>(null)
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  /** 上次的觀看進度（R55）；第一次讀到影片資訊時跳過去，直播不跳 */
  const startAtRef = useRef(startAt)
  const renewRef = useRef(renew)
  renewRef.current = renew
  /** 目前的網址與有效期限；重新解析後換掉，不重新建立播放器 */
  const urlRef = useRef(url)
  const expiresRef = useRef(renew?.expiresAt ?? Infinity)
  /** 重新取得網址後載入，維持播放位置（R89） */
  const reloadRef = useRef<() => void>(() => undefined)

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

    urlRef.current = url
    expiresRef.current = renewRef.current?.expiresAt ?? Infinity
    const load = () => {
      const url = urlRef.current
      if (kind === 'hls' && Hls.isSupported()) {
        hls?.destroy()
        hls = new Hls()
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) fail()
        })
        hls.on(Hls.Events.FRAG_LOADED, () => (retries = 0))
        hls.on(Hls.Events.MANIFEST_PARSED, () => applyQuality())
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => applyAudioRef.current())
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
      retryTimer = setTimeout(reload, RETRY_DELAY_MS)
    }

    /** yt-dlp 的串流先重新解析（網址可能過期了，R89）；重新解析失敗也算一次重試 */
    const reload = async () => {
      const r = renewRef.current
      if (r) {
        const next = await r.refresh()
        if (disposed) return
        if (!next) return fail()
        urlRef.current = next.url
        expiresRef.current = next.expiresAt
      }
      load()
    }
    reloadRef.current = () => void reload()

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

    const onMeta = () => {
      const t = startAtRef.current
      startAtRef.current = null
      if (t && Number.isFinite(video.duration) && t < video.duration) video.currentTime = t
    }
    video.addEventListener('loadedmetadata', onMeta, { once: true })
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
      hlsRef.current = null
      video.removeEventListener('loadedmetadata', onMeta)
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

  /**
   * 套用畫質（R24、R32）：
   * - 特定畫質：不限制，固定使用不高於選擇的最高畫質
   * - 自動：上限依格子大小，在上限內依網路速度自動選擇。
   *   不用 hls.js 的 capLevelToPlayerSize：1.7.3 在播放中把它打開不會生效
   * immediate：使用者剛選了特定畫質，清掉已緩衝的片段立刻換（R32 AC1：15 秒內）；
   * 否則等已緩衝的片段播完才換。一般影片會緩衝 30 秒以上，不立刻換會等很久
   */
  const applyQuality = (immediate = false) => {
    const hls = hlsRef.current
    const video = videoRef.current
    if (!hls || !video || hls.levels.length === 0) return
    const q = qualityRef.current
    if (q !== 'auto') {
      hls.autoLevelCapping = -1
      const level = pickHlsLevel(hls.levels, q)
      if (immediate) hls.currentLevel = level
      else hls.nextLevel = level
    } else {
      const dpr = window.devicePixelRatio || 1
      hls.autoLevelCapping = capLevelFor(hls.levels, video.clientWidth * dpr, video.clientHeight * dpr)
      if (!hls.autoLevelEnabled) hls.nextLevel = -1
    }
  }
  const applyQualityRef = useRef(applyQuality)
  applyQualityRef.current = applyQuality
  /**
   * 聲音軌（R95）：主清單沒有標預設的聲音軌時 hls.js 會用第一條（可能是 AI 配音），
   * 依記住的語言 → 系統語言 → 原本的聲音選擇
   */
  const audioLangRef = useRef(audioLang)
  audioLangRef.current = audioLang
  const applyAudio = () => {
    const hls = hlsRef.current
    if (!hls || hls.audioTracks.length < 2) return
    const i = pickAudioTrack(hls.audioTracks, audioLangRef.current, navigator.language)
    if (i >= 0 && hls.audioTrack !== i) hls.audioTrack = i
  }
  const applyAudioRef = useRef(applyAudio)
  applyAudioRef.current = applyAudio
  useEffect(applyAudio, [audioLang])

  // 載入時由 MANIFEST_PARSED 套用；之後是使用者改了畫質
  const appliedOnce = useRef(false)
  useEffect(() => {
    if (!appliedOnce.current) {
      appliedOnce.current = true
      return applyQuality()
    }
    applyQuality(true)
  }, [quality])
  // 格子大小改變時重新計算自動的上限
  useEffect(() => {
    if (kind !== 'hls') return
    const ro = new ResizeObserver(() => qualityRef.current === 'auto' && applyQualityRef.current())
    ro.observe(videoRef.current!)
    return () => ro.disconnect()
  }, [kind])

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
      // 暫停到網址快過期才按播放：先重新解析再播放，一般影片從原本的時間點繼續（R89）
      if (renewRef.current && Date.now() > expiresRef.current - RENEW_BEFORE_MS) return reloadRef.current()
      void videoRef.current!.play().catch(() => undefined)
    },
    pause: () => {
      wantPlay.current = false
      videoRef.current!.pause()
    },
    getQualityOptions: () => (hlsRef.current ? hlsHeights(hlsRef.current.levels) : []),
    getAudioTracks: () => {
      const hls = hlsRef.current
      if (!hls || hls.audioTracks.length === 0) return null
      const options = audioOptions(hls.audioTracks)
      return { options, current: currentOption(hls.audioTracks, options, hls.audioTrack) }
    },
    // mp4 / m3u8 沒有標題，由清單依網址取檔名（R22 共用定義）
    getTitle: () => null,
    getProgress: () => {
      const v = videoRef.current
      if (!v || v.readyState === 0) return null
      // m3u8 以播放清單判斷是不是直播；mp4 依長度判斷
      const details = hlsRef.current?.levels[Math.max(hlsRef.current.currentLevel, 0)]?.details
      return progressFromMedia({
        duration: v.duration,
        currentTime: v.currentTime,
        seekable: rangesOf(v.seekable),
        live: kind === 'hls' && details ? details.live : undefined
      })
    },
    // 設定 currentTime 不改變播放或暫停狀態；播完的影片跳轉後維持暫停（R19 AC11）
    seek: (seconds) => {
      videoRef.current!.currentTime = seconds
    }
  }))

  // mp4 播完停在最後一個畫面，不重播（R2 AC3）
  return <video className="player" ref={videoRef} playsInline muted={muted} />
})
