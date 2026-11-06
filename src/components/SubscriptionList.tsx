// 清單面板的「YouTube → 訂閱」分頁（R59）：訂閱的頻道與每個頻道的最新影片
import { useEffect, useReducer, useState } from 'react'
import type { ListItem } from '../lib/lists'
import { countNew, formatAgo, type Channel, type FeedVideo } from '../lib/youtubeFeed'
import { ChevronIcon, ImportIcon, PlusIcon, RefreshIcon, StarIcon, UnsubscribeIcon } from './icons'

interface Props {
  channels: Channel[]
  /** 點一下放進空格、拖曳放到格子（和清單項目相同，R21） */
  pick(key: string, item: ListItem): React.HTMLAttributes<HTMLElement>
  /** 回傳錯誤訊息，成功時回傳 null */
  onAdd(input: string): Promise<string | null>
  onRemove(id: string): void
  /** 從 Google Takeout 匯入（R61） */
  onImport(): void
  isFavorite(url: string): boolean
  onToggleFavorite(url: string, name: string): void
}

/** 最新影片多久自動更新一次（R59） */
const REFRESH_MS = 15 * 60 * 1000
/** 同時讀取的頻道數（非功能需求：避免對 YouTube 發出過多請求） */
const CONCURRENCY = 4

interface FeedState {
  videos: FeedVideo[] | null
  /** 正在直播的影片代碼（R60）；沒有直播或判斷不了時為 null */
  live: string | null
  /** 讀取完成的時間；0 表示還沒讀取過 */
  at: number
  loading: boolean
}

// 最新影片不保存，但面板關掉再打開時沿用（15 分鐘內不重新讀取）
const feeds = new Map<string, FeedState>()
const queue: string[] = []
let running = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!
    running++
    // 最新影片和直播狀態一起讀取（R60）；每個頻道每次最多 2 個請求
    Promise.all([window.multiview.ytFeed(id).catch(() => null), window.multiview.ytLive(id).catch(() => null)])
      .then(([videos, live]) => {
        feeds.set(id, { videos, live, at: Date.now(), loading: false })
        running--
        notify()
        pump()
      })
  }
}

function load(ids: string[], force: boolean) {
  const now = Date.now()
  for (const id of ids) {
    const f = feeds.get(id)
    if (f?.loading || queue.includes(id)) continue
    if (!force && f && now - f.at < REFRESH_MS) continue
    feeds.set(id, { videos: f?.videos ?? null, live: f?.live ?? null, at: f?.at ?? 0, loading: true })
    queue.push(id)
  }
  notify()
  pump()
}

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`

export function SubscriptionList(props: Props) {
  const { channels } = props
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<{ url: string; error: string | null; busy: boolean } | null>(null)

  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])

  // 開啟訂閱分頁時讀取，之後每 15 分鐘更新一次（R59）
  const ids = channels.map((c) => c.id).join(',')
  useEffect(() => {
    const list = ids ? ids.split(',') : []
    load(list, false)
    const timer = setInterval(() => load(list, false), REFRESH_MS)
    return () => clearInterval(timer)
  }, [ids])

  const anyLoading = channels.some((c) => feeds.get(c.id)?.loading)
  const now = Date.now()
  // 正在直播的排在最上面（R60），其他依名稱排序
  const isLive = (c: Channel) => !!feeds.get(c.id)?.live
  const sorted = [...channels].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || a.name.localeCompare(b.name, 'zh-TW'))

  const submit = async () => {
    if (!adding || adding.busy || !adding.url.trim()) return
    setAdding({ ...adding, busy: true, error: null })
    const error = await props.onAdd(adding.url)
    setAdding(error ? { ...adding, busy: false, error } : null)
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="subscriptions">
      <div className="list-bar">
        <button className="set-button small" title="貼上頻道網址、@帳號或影片網址" onClick={() => setAdding({ url: '', error: null, busy: false })}>
          <PlusIcon />
          加入頻道
        </button>
        <div className="list-head-spacer" />
        <button
          className="tb-btn"
          title="匯入 Google Takeout 匯出的 YouTube 訂閱清單（subscriptions.csv）"
          aria-label="匯入訂閱清單"
          onClick={props.onImport}
        >
          <ImportIcon />
        </button>
        <button
          className="tb-btn"
          title="重新讀取每個頻道的最新影片"
          aria-label="重新整理"
          disabled={anyLoading || channels.length === 0}
          onClick={() => load(channels.map((c) => c.id), true)}
        >
          <RefreshIcon />
        </button>
      </div>

      {adding && (
        <div className="list-form">
          <input
            className="url-input"
            autoFocus
            placeholder="頻道網址（例如 https://www.youtube.com/@TED）或影片網址"
            value={adding.url}
            disabled={adding.busy}
            onChange={(e) => setAdding({ ...adding, url: e.target.value, error: null })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void submit()
              else if (e.key === 'Escape') setAdding(null)
            }}
          />
          {adding.error && <div className="url-error">{adding.error}</div>}
          <div className="list-form-buttons">
            <button className="set-button primary" disabled={adding.busy} onClick={() => void submit()}>
              {adding.busy ? '加入中…' : '加入'}
            </button>
            <button className="link" onClick={() => setAdding(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      <ul className="list-items">
        {channels.length === 0 && (
          <li className="list-empty">
            還沒有訂閱的頻道，按「加入頻道」貼上頻道網址。
            <br />
            要匯入現有的 YouTube 訂閱：到 Google Takeout（takeout.google.com）只勾選「YouTube 和 YouTube Music」，在選項中只保留「訂閱內容」，匯出後解壓縮，按上方的匯入圖示選擇裡面的 subscriptions.csv。
          </li>
        )}
        {sorted.map((ch) => {
          const feed = feeds.get(ch.id)
          const videos = feed?.videos ?? []
          const fresh = countNew(videos, now)
          const open = expanded.has(ch.id)
          const live = feed?.live ?? null
          // 拖曳頻道：正在直播時播放那場直播，否則以整頁模式顯示頻道頁（R59、R60）
          const channelItem: ListItem = live ? { url: watchUrl(live), name: ch.name, time: 0 } : { url: ch.url, name: ch.name, time: 0 }
          return (
            <li key={ch.id} className="channel">
              <div
                className="list-item channel-row"
                title="點一下放進空格，或拖到要放的格子"
                {...props.pick(`channel:${ch.id}`, channelItem)}
              >
                <button
                  className="row-btn channel-toggle"
                  title={open ? '收合' : '顯示最新影片'}
                  aria-label={open ? '收合' : '顯示最新影片'}
                  onClick={() => toggle(ch.id)}
                >
                  <ChevronIcon open={open} />
                </button>
                <div className="list-text">
                  <div className="list-name">
                    {ch.name}
                    {live && (
                      <button
                        className="channel-live"
                        title="播放這場直播（點一下放進空格，或拖到要放的格子）"
                        {...props.pick(`live:${ch.id}`, channelItem)}
                      >
                        ● 直播中
                      </button>
                    )}
                    {fresh > 0 && (
                      <span className="channel-new" title="24 小時內發布的新影片">
                        {fresh}
                      </span>
                    )}
                  </div>
                </div>
                <div className="list-actions">
                  <button className="row-btn" title="取消訂閱" aria-label="取消訂閱" onClick={() => props.onRemove(ch.id)}>
                    <UnsubscribeIcon />
                  </button>
                </div>
              </div>
              {open && (
                <ul className="channel-videos">
                  {feed?.loading && !feed.videos && <li className="list-empty">讀取中…</li>}
                  {feed && !feed.loading && feed.videos === null && <li className="list-empty">無法取得最新影片</li>}
                  {videos.map((v) => {
                    const url = watchUrl(v.videoId)
                    const fav = props.isFavorite(url)
                    return (
                      <li
                        key={v.videoId}
                        className="list-item channel-video"
                        title="點一下放進空格，或拖到要放的格子"
                        {...props.pick(`video:${v.videoId}`, { url, name: v.title, time: 0 })}
                      >
                        <div className="list-text">
                          <div className="list-name">{v.title}</div>
                          <div className="list-time">{formatAgo(v.published, now)}</div>
                        </div>
                        <div className="list-actions">
                          <button
                            className={`row-btn ${fav ? 'active' : ''}`}
                            title={fav ? '從最愛移除' : '加入最愛'}
                            aria-label={fav ? '從最愛移除' : '加入最愛'}
                            aria-pressed={fav}
                            onClick={() => props.onToggleFavorite(url, v.title)}
                          >
                            <StarIcon filled={fav} />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
