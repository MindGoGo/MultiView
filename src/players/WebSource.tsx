// 其他網站（R102–R103）：依設定用網頁或 yt-dlp 播放，yt-dlp 播不了時退回網頁
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { PlayerHandle, PlayStatus } from './types'
import type { Quality } from '../lib/quality'
import type { Failure } from '../lib/webErrors'
import type { WebMethod, YtStream } from '../lib/ytdlp'
import type { YtMode } from './YouTubeSource'
import { WebPlayer } from './WebPlayer'
import { VideoPlayer, type Renew } from './VideoPlayer'

type WebPlayerProps = ComponentProps<typeof WebPlayer>

interface Props extends Omit<WebPlayerProps, 'ref'> {
  method: WebMethod
  /** 這一格按了「改用網頁」（R103）：這次一律用網頁 */
  forceWeb: boolean
  quality: Quality
  audioLang: string | null
  /** 'embed' 表示用網頁播放（和 YouTube 的「原本的方式」共用同一組值） */
  onMode(mode: YtMode): void
  /** 這一格從 yt-dlp 退回網頁（R103） */
  onFallback(): void
}

type Plan = { kind: 'resolving' } | { kind: 'web'; fallback: boolean } | { kind: 'ytdlp'; stream: YtStream }

const modeOf = (plan: Plan): YtMode =>
  plan.kind === 'ytdlp' ? (plan.stream.kind === 'hls' ? 'ytdlp-hls' : 'ytdlp-mp4') : plan.kind === 'web' ? 'embed' : 'resolving'

export const WebSource = forwardRef<PlayerHandle, Props>(function WebSource(props, ref) {
  const { method, forceWeb, quality, audioLang, onMode, onFallback, onStatus, startAt, autoplay, ...web } = props
  const useYtdlp = method === 'ytdlp' && !forceWeb
  const [plan, setPlan] = useState<Plan>(() => (useYtdlp ? { kind: 'resolving' } : { kind: 'web', fallback: false }))
  const planRef = useRef(plan)
  planRef.current = plan
  const [start, setStart] = useState({ startAt, autoplay, n: 0 })
  const childRef = useRef<PlayerHandle | null>(null)
  const playingRef = useRef(autoplay)
  const latest = useRef({ onStatus, onMode, onFallback, useYtdlp })
  latest.current = { onStatus, onMode, onFallback, useYtdlp }
  const tokenRef = useRef(0)

  /** 換播放器時的起點：沿用目前偵測到的位置（網頁偵測不到時從頭，R102） */
  const snapshot = () => {
    const p = childRef.current?.getProgress() ?? null
    const at = p && !p.live ? p.current : null
    setStart((s) => ({ startAt: at, autoplay: playingRef.current, n: s.n + 1 }))
  }

  const decide = () => {
    const token = ++tokenRef.current
    if (!latest.current.useYtdlp) return setPlan({ kind: 'web', fallback: false })
    setPlan({ kind: 'resolving' })
    void window.multiview.ytdlpResolveUrl(web.url).then((r) => {
      if (token !== tokenRef.current) return
      if (r.ok) return setPlan({ kind: 'ytdlp', stream: r.stream })
      latest.current.onFallback()
      setPlan({ kind: 'web', fallback: true })
    })
  }

  useEffect(() => {
    if (plan.kind === 'resolving') decide()
    return () => {
      tokenRef.current++
    }
    // 只在載入時決定一次；之後由設定改變、「改用網頁」、退回觸發
  }, [])

  // 設定改變、按「改用網頁」：方式不同時重新載入；整頁模式的格子不動（R102）
  const prevUse = useRef(useYtdlp)
  useEffect(() => {
    if (prevUse.current === useYtdlp) return
    prevUse.current = useYtdlp
    const p = planRef.current
    const current = p.kind === 'ytdlp' || p.kind === 'resolving' ? true : p.fallback ? null : false
    if (current === useYtdlp) return
    if (p.kind === 'web' && web.mode === 'page') return
    snapshot()
    decide()
  }, [useYtdlp])

  useEffect(() => {
    latest.current.onMode(modeOf(plan))
    if (plan.kind === 'resolving') latest.current.onStatus('loading')
  }, [plan])

  const childStatus = (s: PlayStatus, f?: Failure) => {
    // yt-dlp 播放中斷、重試都失敗：改用網頁（R103）
    if (s === 'error' && planRef.current.kind === 'ytdlp') {
      latest.current.onFallback()
      snapshot()
      setPlan({ kind: 'web', fallback: true })
      return
    }
    if (s === 'playing') playingRef.current = true
    else if (s === 'paused' || s === 'ended') playingRef.current = false
    latest.current.onStatus(s, f)
  }

  const renew = useMemo<Renew | undefined>(() => {
    if (plan.kind !== 'ytdlp') return undefined
    return {
      expiresAt: plan.stream.expiresAt,
      refresh: async () => {
        const r = await window.multiview.ytdlpResolveUrl(web.url, true)
        return r.ok ? { url: r.stream.url, expiresAt: r.stream.expiresAt } : null
      }
    }
  }, [plan, web.url])

  useImperativeHandle(ref, () => ({
    play: () => {
      playingRef.current = true
      childRef.current?.play()
    },
    pause: () => {
      playingRef.current = false
      childRef.current?.pause()
    },
    requestVideoMode: () => childRef.current?.requestVideoMode?.(),
    getProgress: () => childRef.current?.getProgress() ?? null,
    seek: (seconds) => childRef.current?.seek(seconds),
    // yt-dlp 播放時用解析拿到的影片名稱（R103）
    getTitle: () => (planRef.current.kind === 'ytdlp' ? planRef.current.stream.title : (childRef.current?.getTitle() ?? null)),
    getQualityOptions: () => childRef.current?.getQualityOptions?.() ?? [],
    getAudioTracks: () => (planRef.current.kind === 'ytdlp' ? (childRef.current?.getAudioTracks?.() ?? null) : null),
    getUrl: () => childRef.current?.getUrl?.() ?? null,
    goBack: () => childRef.current?.goBack?.(),
    goForward: () => childRef.current?.goForward?.()
  }))

  const key = `${plan.kind}-${start.n}`
  if (plan.kind === 'resolving') return <div className="player" />
  const common = {
    muted: web.muted,
    volume: web.volume,
    active: web.active,
    startAt: start.startAt,
    autoplay: playingRef.current,
    onStatus: childStatus,
    ref: childRef
  }
  return plan.kind === 'ytdlp' ? (
    <VideoPlayer key={key} kind={plan.stream.kind} url={plan.stream.url} quality={quality} renew={renew} audioLang={audioLang} {...common} />
  ) : (
    <WebPlayer key={key} {...web} {...common} />
  )
})
