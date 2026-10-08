import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { loadYouTubeApi, YT_STATE, type YTPlayer } from './youtubeApi'
import type { PlayerHandle, PlayerProps, PlayStatus } from './types'
import type { Progress } from '../lib/progress'
import type { Quality } from '../lib/slots'
import { findCaptionTrack, toCaptionTracks, type CaptionTrack, type RawCaptionTrack } from '../lib/captions'
import { qualityScale, youtubeHeights } from '../lib/quality'

interface Props extends PlayerProps {
  videoId: string
  /** 選擇特定畫質時，播放器以該畫質的大小排版再縮放到格子（R32） */
  quality: Quality
  /** 字幕的選擇；null 為關閉（R31） */
  captions: string | null
}

/** 開始播放這麼久之後還拿不到字幕清單，就當作沒有字幕（R31 AC5） */
const NO_CAPTIONS_AFTER_MS = 3000

export const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, quality, captions, muted, volume, autoplay, active, onStatus },
  ref
) {
  const outerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const readyRef = useRef(false)
  /**
   * 第一次開始播放的時間：YouTube 在影片開始播放前不提供字幕清單；
   * 沒有字幕的影片不會觸發 onApiChange，播放後一段時間還沒有清單才判斷為「沒有字幕」（R31 AC5）
   */
  const playedAtRef = useRef(0)
  /** 這部影片的字幕軌；字幕模組載入前為 null（R31） */
  const tracksRef = useRef<CaptionTrack[] | null>(null)
  const captionsRef = useRef(captions)
  captionsRef.current = captions
  /**
   * 套用字幕的選擇（R31）：沒有選擇或影片沒有那種語言時關閉，
   * 也會蓋掉 YouTube 依系統語言或上傳者設定自動開啟的字幕
   */
  const applyCaptions = () => {
    const p = playerRef.current
    if (!p || !readyRef.current || !tracksRef.current) return
    const track = findCaptionTrack(tracksRef.current, captionsRef.current)
    p.setOption('captions', 'track', track ? { languageCode: track.languageCode, kind: track.auto ? 'asr' : '' } : {})
  }
  const applyCaptionsRef = useRef(applyCaptions)
  applyCaptionsRef.current = applyCaptions
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
              // 載入字幕模組才拿得到字幕軌，載入後在 onApiChange 套用選擇（R31）
              p.loadModule('captions')
            },
            onApiChange: () => {
              const raw = playerRef.current?.getOption('captions', 'tracklist') as RawCaptionTrack[] | undefined
              if (!Array.isArray(raw)) return
              tracksRef.current = toCaptionTracks(raw)
              applyCaptionsRef.current()
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
              // 第一次開始播放：字幕清單在這之後才拿得到，再載入一次字幕模組（R31）
              if (data === YT_STATE.PLAYING && !playedAtRef.current) {
                playedAtRef.current = Date.now()
                playerRef.current?.loadModule('captions')
              }
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
      tracksRef.current = null
      playedAtRef.current = 0
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

  // 改變字幕的選擇時套用，不重新載入（R31）
  useEffect(() => applyCaptionsRef.current(), [captions])

  useEffect(() => {
    if (!active && readyRef.current) playerRef.current?.pauseVideo()
  }, [active])

  useImperativeHandle(ref, () => ({
    play: () => readyRef.current && playerRef.current?.playVideo(),
    pause: () => readyRef.current && playerRef.current?.pauseVideo(),
    getTitle: () => (readyRef.current && playerRef.current?.getVideoData().title) || null,
    getQualityOptions: () =>
      readyRef.current && playerRef.current ? youtubeHeights(playerRef.current.getAvailableQualityLevels()) : [],
    getCaptionTracks: () => {
      const p = playerRef.current
      if (tracksRef.current || !p || !readyRef.current) return tracksRef.current
      // 還沒收到 onApiChange 時直接查詢；就緒 3 秒後還是沒有清單，表示這部影片沒有字幕
      const raw = p.getOption('captions', 'tracklist') as RawCaptionTrack[] | undefined
      if (Array.isArray(raw) && raw.length > 0) {
        tracksRef.current = toCaptionTracks(raw)
        applyCaptionsRef.current()
        return tracksRef.current
      }
      return playedAtRef.current && Date.now() - playedAtRef.current > NO_CAPTIONS_AFTER_MS ? [] : null
    },
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

  // 選擇特定畫質：YouTube 依播放器大小決定畫質，以該畫質的大小排版再縮放（R32）。改變大小不會重新載入
  useEffect(() => {
    const outer = outerRef.current!
    const host = hostRef.current!
    const layout = () => {
      const w = outer.clientWidth
      const h = outer.clientHeight
      const f = qualityScale(quality, w, h)
      host.style.width = `${w / f}px`
      host.style.height = `${h / f}px`
      host.style.transform = f === 1 ? '' : `scale(${f})`
    }
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(outer)
    return () => ro.disconnect()
  }, [quality])

  return (
    <div className="player yt-outer" ref={outerRef}>
      <div className="yt-host" ref={hostRef} />
    </div>
  )
})
