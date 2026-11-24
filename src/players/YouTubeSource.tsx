// YouTube 來源：依設定決定用內嵌播放器或 yt-dlp 播放，yt-dlp 播不了時退回內嵌播放器（R88–R90）
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { PlayerHandle, PlayerProps, PlayStatus } from './types'
import type { Quality } from '../lib/quality'
import type { Failure } from '../lib/webErrors'
import { needsResolve, type YouTubeMethods, type YtStream } from '../lib/ytdlp'
import { YouTubePlayer } from './YouTubePlayer'
import { VideoPlayer, type Renew } from './VideoPlayer'
import { selectSegments, sponsorActive, type SkipAction, type SponsorBlockSettings, type SponsorSegment } from '../lib/sponsorBlock'

/**
 * 格子要知道的播放方式：解析中、原本的方式（YouTube 是內嵌播放器、其他網站是網頁）、
 * 因 yt-dlp 失敗而退回原本的方式（R109 小標示加註）、yt-dlp 播放 HLS 主清單／mp4（R89）
 */
export type YtMode = 'resolving' | 'embed' | 'fallback' | 'ytdlp-hls' | 'ytdlp-mp4'

interface Props extends PlayerProps {
  videoId: string
  quality: Quality
  captions: string | null
  /** yt-dlp 播放時記住的語音語言（R95） */
  audioLang: string | null
  methods: YouTubeMethods
  onMode(mode: YtMode): void
  /** 這一格退回內嵌播放器（R90） */
  onFallback(): void
  /** SponsorBlock 的設定（R161） */
  sponsorBlock: SponsorBlockSettings
  /** 自動跳過了一個片段（R161 跳過提示） */
  onSkipSegment?(action: SkipAction): void
}

type Plan =
  | { kind: 'resolving' }
  /** fallback：因為 yt-dlp 失敗而退回；live：解析時知道是不是直播 */
  | { kind: 'embed'; fallback: boolean; live: boolean | null }
  | { kind: 'ytdlp'; stream: YtStream }

const modeOf = (plan: Plan): YtMode =>
  plan.kind === 'ytdlp'
    ? plan.stream.kind === 'hls'
      ? 'ytdlp-hls'
      : 'ytdlp-mp4'
    : plan.kind === 'embed' && plan.fallback
      ? 'fallback'
      : plan.kind

export const YouTubeSource = forwardRef<PlayerHandle, Props>(function YouTubeSource(props, ref) {
  const { videoId, quality, captions, audioLang, methods, onStatus, onMode, onFallback, startAt, autoplay, sponsorBlock, onSkipSegment, ...rest } =
    props
  const [plan, setPlan] = useState<Plan>(() =>
    needsResolve(methods) ? { kind: 'resolving' } : { kind: 'embed', fallback: false, live: null }
  )
  const planRef = useRef(plan)
  planRef.current = plan
  /** 播放器載入時的位置與要不要播放；改變方式時沿用目前的狀態（R88、R90） */
  const [start, setStart] = useState({ startAt, autoplay, n: 0 })
  const childRef = useRef<PlayerHandle | null>(null)
  /** 使用者希望的播放狀態 */
  const playingRef = useRef(autoplay)
  const statusRef = useRef<PlayStatus>('loading')
  const latest = useRef({ onStatus, onMode, onFallback, methods })
  latest.current = { onStatus, onMode, onFallback, methods }
  /** 每次重新決定加一，丟掉過時的解析結果（R88：改設定時取消解析中的結果） */
  const tokenRef = useRef(0)

  /** 換播放器時的起點：一般影片從目前的時間點，直播從最新的位置 */
  const snapshot = () => {
    const p = childRef.current?.getProgress() ?? null
    const at = p ? (p.live ? null : p.current) : (start.startAt ?? null)
    setStart((s) => ({ startAt: at, autoplay: playingRef.current, n: s.n + 1 }))
  }

  const decide = () => {
    const token = ++tokenRef.current
    const m = latest.current.methods
    if (!needsResolve(m)) return setPlan({ kind: 'embed', fallback: false, live: null })
    setPlan({ kind: 'resolving' })
    void window.multiview.ytdlpResolve(videoId).then((r) => {
      if (token !== tokenRef.current) return
      if (!r.ok) {
        latest.current.onFallback()
        return setPlan({ kind: 'embed', fallback: true, live: null })
      }
      const method = r.stream.isLive ? latest.current.methods.live : latest.current.methods.vod
      setPlan(method === 'ytdlp' ? { kind: 'ytdlp', stream: r.stream } : { kind: 'embed', fallback: false, live: r.stream.isLive })
    })
  }

  useEffect(() => {
    if (plan.kind === 'resolving') decide()
    return () => {
      tokenRef.current++
    }
    // 只在載入時決定一次；之後由設定改變、退回內嵌觸發
  }, [])

  // 改變設定：目前的方式和新的選擇不同的格子重新載入；退回內嵌、錯誤、解析中、還不知道是不是直播的格子重新決定（R88）
  const prevMethods = useRef(methods)
  useEffect(() => {
    if (prevMethods.current.live === methods.live && prevMethods.current.vod === methods.vod) return
    prevMethods.current = methods
    const p = planRef.current
    let live: boolean | null = null
    let current: 'embed' | 'ytdlp' | null = null
    if (p.kind === 'ytdlp') {
      live = p.stream.isLive
      current = 'ytdlp'
    } else if (p.kind === 'embed' && !p.fallback && statusRef.current !== 'error') {
      live = p.live ?? childRef.current?.getProgress()?.live ?? null
      current = 'embed'
    }
    if (live !== null && current === (live ? methods.live : methods.vod)) return
    snapshot()
    decide()
  }, [methods.live, methods.vod])

  useEffect(() => {
    latest.current.onMode(modeOf(plan))
    if (plan.kind === 'resolving') latest.current.onStatus('loading')
  }, [plan])

  const childStatus = (s: PlayStatus, f?: Failure) => {
    // yt-dlp 播放中斷、重試都失敗：從目前的時間點改用內嵌播放器（R90）
    if (s === 'error' && planRef.current.kind === 'ytdlp') {
      latest.current.onFallback()
      snapshot()
      setPlan({ kind: 'embed', fallback: true, live: null })
      return
    }
    if (s === 'playing') playingRef.current = true
    else if (s === 'paused' || s === 'ended') playingRef.current = false
    statusRef.current = s
    latest.current.onStatus(s, f)
  }

  // SponsorBlock（R161）：開啟、一般影片用 yt-dlp 播放時，建立時就在背景抓片段（和 yt-dlp 解析同時）。
  // 失敗、逾時當作沒有片段，不影響播放；關閉後再開啟時，還沒抓過的影片才去抓（主程序有快取）
  const [rawSegments, setRawSegments] = useState<SponsorSegment[]>([])
  const wantSegments = sponsorActive(sponsorBlock) && methods.vod === 'ytdlp'
  useEffect(() => {
    if (!wantSegments) return
    let cancelled = false
    void window.multiview
      .sponsorSegments(videoId)
      .then((list) => !cancelled && setRawSegments(list))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [videoId, wantSegments])
  // 只有 yt-dlp 播放的一般影片才跳過；直播、內嵌播放器不處理。改設定馬上套用
  const vodByYtdlp = plan.kind === 'ytdlp' && !plan.stream.isLive
  const segments = useMemo(
    () => (vodByYtdlp ? selectSegments(rawSegments, sponsorBlock) : []),
    [vodByYtdlp, rawSegments, sponsorBlock]
  )

  const renew = useMemo<Renew | undefined>(() => {
    if (plan.kind !== 'ytdlp') return undefined
    return {
      expiresAt: plan.stream.expiresAt,
      refresh: async () => {
        const r = await window.multiview.ytdlpResolve(videoId, true)
        return r.ok ? { url: r.stream.url, expiresAt: r.stream.expiresAt } : null
      }
    }
  }, [plan, videoId])

  useImperativeHandle(ref, () => ({
    play: () => {
      playingRef.current = true
      childRef.current?.play()
    },
    pause: () => {
      playingRef.current = false
      childRef.current?.pause()
    },
    getProgress: () => childRef.current?.getProgress() ?? null,
    seek: (seconds) => childRef.current?.seek(seconds),
    // yt-dlp 播放時用解析拿到的影片名稱（R89）
    getTitle: () => (planRef.current.kind === 'ytdlp' ? planRef.current.stream.title : (childRef.current?.getTitle() ?? null)),
    getQualityOptions: () => childRef.current?.getQualityOptions?.() ?? [],
    // yt-dlp 播放不支援字幕（R89）
    getAudioTracks: () => (planRef.current.kind === 'ytdlp' ? (childRef.current?.getAudioTracks?.() ?? null) : null),
    getCaptionTracks: () => (planRef.current.kind === 'ytdlp' ? null : (childRef.current?.getCaptionTracks?.() ?? null)),
    getSegments: () => childRef.current?.getSegments?.() ?? [],
    cancelSkip: (segment) => childRef.current?.cancelSkip?.(segment)
  }))

  const key = `${plan.kind}-${start.n}`
  // 解析中還沒有播放器；這段期間按播放／暫停記在 playingRef，載入時套用
  if (plan.kind === 'resolving') return <div className="player" />
  const common = { ...rest, startAt: start.startAt, autoplay: playingRef.current, onStatus: childStatus, ref: childRef }
  return plan.kind === 'ytdlp' ? (
    <VideoPlayer key={key} kind={plan.stream.kind} url={plan.stream.url} quality={quality} renew={renew} audioLang={audioLang} segments={segments} onSkip={onSkipSegment} {...common} />
  ) : (
    <YouTubePlayer key={key} videoId={videoId} quality={quality} captions={captions} {...common} />
  )
})
