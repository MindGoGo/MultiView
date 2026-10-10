// 進度條的時間提示與預覽縮圖（R50）：游標上方顯示時間，YouTube 和 mp4 另外顯示那個位置的畫面
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { parseStoryboard, storyboardFrame, type Storyboard } from '../lib/storyboard'

export type PreviewSource = { kind: 'youtube'; videoId: string } | { kind: 'video'; url: string } | null

interface Props {
  /** 游標的視窗座標 x、進度條的位置 */
  clientX: number
  track: DOMRect
  /** 提示限制在這個範圍內（格子） */
  bounds: DOMRect
  label: string
  seconds: number
  duration: number
  source: PreviewSource
}

/** 預覽縮圖的寬度 */
export const PREVIEW_WIDTH = 160
const MARGIN = 6

// 每部 YouTube 影片的縮圖資訊只取得一次（R50 效能）
const storyboards = new Map<string, Promise<Storyboard | null>>()
function loadStoryboard(videoId: string): Promise<Storyboard | null> {
  let p = storyboards.get(videoId)
  if (!p) {
    p = window.multiview
      .getStoryboard(videoId)
      .then((spec) => (spec ? parseStoryboard(spec) : null))
      .catch(() => null)
    storyboards.set(videoId, p)
  }
  return p
}

export function ProgressPreview({ clientX, track, bounds, label, seconds, duration, source }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // 格子放不下縮圖時只顯示時間
  const showImage = source !== null && bounds.width >= PREVIEW_WIDTH + MARGIN * 2

  useLayoutEffect(() => setWidth(ref.current?.offsetWidth ?? 0))

  const left = Math.min(Math.max(clientX - width / 2, bounds.left + MARGIN), bounds.right - width - MARGIN)
  return (
    <div
      className="progress-preview"
      ref={ref}
      style={{ left, bottom: window.innerHeight - track.top + 4, visibility: width ? 'visible' : 'hidden' }}
    >
      {showImage && source.kind === 'youtube' && (
        <YouTubeFrame videoId={source.videoId} seconds={seconds} duration={duration} />
      )}
      {showImage && source.kind === 'video' && <VideoFrame url={source.url} seconds={seconds} />}
      <span className="progress-preview-time">{label}</span>
    </div>
  )
}

function YouTubeFrame({ videoId, seconds, duration }: { videoId: string; seconds: number; duration: number }) {
  const [sb, setSb] = useState<Storyboard | null>(null)
  useEffect(() => {
    let alive = true
    void loadStoryboard(videoId).then((s) => alive && setSb(s))
    return () => {
      alive = false
    }
  }, [videoId])
  // 取得失敗或沒有縮圖（例如直播）時只顯示時間
  if (!sb) return null
  const f = storyboardFrame(sb, seconds, duration)
  const scale = PREVIEW_WIDTH / f.width
  return (
    <div
      className="progress-preview-image"
      style={{
        width: PREVIEW_WIDTH,
        height: Math.round(f.height * scale),
        backgroundImage: `url("${f.url}")`,
        backgroundSize: `${f.sheetWidth * scale}px ${f.sheetHeight * scale}px`,
        backgroundPosition: `-${f.x * scale}px -${f.y * scale}px`
      }}
    />
  )
}

/**
 * mp4：另外開一個靜音、不播放的影片元素跳到游標位置，只在提示顯示時存在（R50 效能、AC6）。
 * 上一次跳轉還沒完成時只記住最新的位置，完成後再跳。
 */
function VideoFrame({ url, seconds }: { url: string; seconds: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const busy = useRef(false)
  const pending = useRef<number | null>(null)

  const seekTo = (t: number) => {
    const v = ref.current
    if (!v || v.readyState < 1) {
      pending.current = t
      return
    }
    if (busy.current) {
      pending.current = t
      return
    }
    busy.current = true
    v.currentTime = t
  }

  useEffect(() => {
    const v = ref.current!
    const onMeta = () => {
      const t = pending.current
      pending.current = null
      if (t !== null) seekTo(t)
    }
    const onSeeked = () => {
      busy.current = false
      setReady(true)
      const t = pending.current
      pending.current = null
      if (t !== null) seekTo(t)
    }
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('seeked', onSeeked)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('seeked', onSeeked)
      // 釋放連線
      v.removeAttribute('src')
      v.load()
    }
  }, [])

  useEffect(() => seekTo(seconds), [seconds])

  return (
    <video
      ref={ref}
      className="progress-preview-image"
      src={url}
      muted
      preload="metadata"
      playsInline
      style={{ width: PREVIEW_WIDTH, display: ready ? 'block' : 'none' }}
    />
  )
}
