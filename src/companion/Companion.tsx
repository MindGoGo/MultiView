// YouTube 小視窗（R78–R82）：分頁「推薦」「留言」「聊天室」「搜尋」
import { useEffect, useState } from 'react'
import {
  COMPANION_TAB_LABELS,
  COMPANION_TABS,
  companionHeader,
  companionLinkAction,
  liveChatUrl,
  stripYouTubeSuffix,
  MOBILE_USER_AGENT,
  MOBILE_YOUTUBE_HOME,
  watchPageUrl,
  type CompanionLink,
  type CompanionTab
} from '../lib/companion'
import { parseSource } from '../lib/source'
import { CompanionWeb } from './CompanionWeb'
import { PinIcon } from '../components/icons'

export const NO_VIDEO = '這一格沒有 YouTube 影片'
export const NO_CHAT = '這部影片沒有聊天室（只有直播有）'
export const NO_CELL = '請在格子的「YouTube ▾」選擇「推薦影片」「留言」或「聊天室」'

export function Companion({ initial }: { initial: { tab: CompanionTab; link: CompanionLink; pinned: boolean } }) {
  const [tab, setTab] = useState(initial.tab)
  const [link, setLink] = useState(initial.link)
  /** 置頂（R84） */
  const [pinned, setPinned] = useState(initial.pinned)
  /** 開過的分頁才建立網頁，之後一直保留（R78）；推薦和留言共用影片網頁 */
  const [opened, setOpened] = useState(() => new Set([initial.tab]))

  useEffect(() => window.companion.onLink(setLink), [])
  useEffect(() => window.companion.onTab(setTab), [])
  useEffect(() => {
    setOpened((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])))
    window.companion.saveTab(tab)
  }, [tab])

  /** 播放器還沒播放過時拿不到影片名稱，改用影片網頁的標題（影片代碼 → 名稱） */
  const [pageTitles, setPageTitles] = useState<Record<string, string>>({})
  const video = link.video && { ...link.video, title: link.video.title ?? pageTitles[link.video.id] ?? null }
  const watchOpened = opened.has('related') || opened.has('comments')
  const onWatchTab = tab === 'related' || tab === 'comments'
  const chatUrl = video?.live ? liveChatUrl(video.id) : null
  const message =
    tab === 'search'
      ? null
      : link.cell === null
        ? NO_CELL
        : !video
          ? NO_VIDEO
          : tab === 'chat' && !video.live
            ? NO_CHAT
            : null

  return (
    <div className="companion">
      {/* 分頁是分段按鈕，置頂是圖釘圖示（R106） */}
      <div className="companion-tabs">
        <div className="companion-seg" role="tablist" aria-label="小視窗分頁">
          {COMPANION_TABS.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {COMPANION_TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          className={`companion-pin ${pinned ? 'active' : ''}`}
          title={pinned ? '置頂：開（小視窗永遠在最上層）' : '置頂：關'}
          aria-label="置頂"
          aria-pressed={pinned}
          onClick={() => void window.companion.togglePin().then(setPinned)}
        >
          <PinIcon />
        </button>
      </div>
      {tab !== 'search' && link.cell !== null && <div className="companion-header">{companionHeader({ ...link, video })}</div>}
      <div className="companion-body">
        {watchOpened && (
          <CompanionWeb
            url={video ? watchPageUrl(video.id) : null}
            shown={onWatchTab && !message}
            section={tab === 'comments' ? 'comments' : 'related'}
            // 推薦、留言裡的影片：同一部影片帶時間就跳過去，其他影片在連結的格子播放（R79、R80）
            onVideo={(href) => {
              const action = companionLinkAction(href, link.video?.id ?? null)
              if (action) window.companion.action(action)
            }}
            onTitle={(url, title) => {
              const parsed = parseSource(url)
              const name = stripYouTubeSuffix(title)
              if (parsed?.kind === 'youtube' && name && name !== 'YouTube')
                setPageTitles((prev) => ({ ...prev, [parsed.videoId]: name }))
            }}
          />
        )}
        {opened.has('chat') && <CompanionWeb url={chatUrl} shown={tab === 'chat' && !message} />}
        {opened.has('search') && (
          <CompanionWeb
            url={MOBILE_YOUTUBE_HOME}
            shown={tab === 'search'}
            userAgent={MOBILE_USER_AGENT}
            // 搜尋到的影片依「放入格子的規則」放進格子，網頁不換頁（R82）
            onVideo={(href) => {
              const parsed = parseSource(href)
              if (parsed?.kind === 'youtube') window.companion.action({ type: 'place', url: watchPageUrl(parsed.videoId) })
            }}
          />
        )}
        {message && <div className="companion-message">{message}</div>}
      </div>
    </div>
  )
}
