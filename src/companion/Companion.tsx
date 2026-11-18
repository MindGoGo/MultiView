// YouTube 小視窗（R78–R82）：分頁「推薦」「留言」「聊天室」「搜尋」
import { useEffect, useRef, useState } from 'react'
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
import { LOGIN_FAILURE_TEXT, loginBrowserInfo, MOBILE_HISTORY_URL } from '../lib/googleLogin'

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

  /** Google 帳號（R165）：null 是還不知道；loggingIn 是登入用的瀏覽器名稱（顯示「請在 ○○ 視窗登入」） */
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 登入、登出後每個網頁重新載入 */
  const [reloadKey, setReloadKey] = useState(0)
  /** 搜尋分頁的網址：按「紀錄」時換成觀看紀錄（每次加上不同的參數，才會重新載入） */
  const [searchUrl, setSearchUrl] = useState(MOBILE_YOUTUBE_HOME)
  const historyCount = useRef(0)
  useEffect(() => {
    void window.companion.googleStatus().then(setLoggedIn)
    return window.companion.onAccount((on) => {
      setLoggedIn(on)
      setReloadKey((k) => k + 1)
    })
  }, [])
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showNotice = (text: string) => {
    clearTimeout(noticeTimer.current)
    setNotice(text)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }
  const login = async () => {
    const { picked } = await window.companion.googleBrowsers()
    setLoggingIn(picked ? loginBrowserInfo(picked).label : '瀏覽器')
    void window.companion.googleLogin().then((r) => {
      setLoggingIn(null)
      showNotice(r === true ? '已登入 Google' : LOGIN_FAILURE_TEXT[r])
    })
  }
  /** 登出前先確認，避免誤觸（R165） */
  const [confirmLogout, setConfirmLogout] = useState(false)
  const logout = () => {
    setConfirmLogout(false)
    void window.companion.googleLogout().then(() => showNotice('已登出 Google'))
  }
  useEffect(() => {
    if (!confirmLogout) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirmLogout(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmLogout])
  const openHistory = () => {
    historyCount.current++
    setSearchUrl(`${MOBILE_HISTORY_URL}?mv=${historyCount.current}`)
    setTab('search')
  }

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
        {/* Google 帳號（R165）：沒登入時「登入」，登入後「紀錄」「登出」 */}
        {loggedIn === false && (
          <button className="companion-account" disabled={!!loggingIn} title="開啟瀏覽器登入 Google（設定 → YouTube 播放 → Google 登入可以選瀏覽器），登入後可以看自己的紀錄、推薦與訂閱" onClick={() => void login()}>
            {loggingIn ? '登入中…' : '登入'}
          </button>
        )}
        {loggedIn && (
          <>
            <button className="companion-account" title="觀看紀錄（在搜尋分頁開啟）" onClick={openHistory}>
              紀錄
            </button>
            <button className="companion-account" title="登出 Google" onClick={() => setConfirmLogout(true)}>
              登出
            </button>
          </>
        )}
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
            reloadKey={reloadKey}
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
        {opened.has('chat') && <CompanionWeb url={chatUrl} shown={tab === 'chat' && !message} reloadKey={reloadKey} />}
        {opened.has('search') && (
          <CompanionWeb
            url={searchUrl}
            shown={tab === 'search'}
            reloadKey={reloadKey}
            userAgent={MOBILE_USER_AGENT}
            // 搜尋到的影片依「放入格子的規則」放進格子，網頁不換頁（R82）
            onVideo={(href) => {
              const parsed = parseSource(href)
              if (parsed?.kind === 'youtube') window.companion.action({ type: 'place', url: watchPageUrl(parsed.videoId) })
            }}
          />
        )}
        {message && <div className="companion-message">{message}</div>}
        {loggingIn && (
          <div className="companion-message companion-login">
            請在開啟的 {loggingIn} 視窗登入 Google。登入完成後 {loggingIn} 會自動關閉，這裡會換成你的帳號。
            <br />
            不想登入時關掉 {loggingIn} 視窗即可。
          </div>
        )}
        {notice && <div className="companion-notice">{notice}</div>}
        {confirmLogout && (
          <div className="companion-confirm-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setConfirmLogout(false)}>
            <div className="companion-confirm" role="alertdialog" aria-modal="true" aria-labelledby="logout-title">
              <div id="logout-title" className="companion-confirm-title">
                要登出 Google 嗎？
              </div>
              <div className="companion-confirm-text">小視窗和格子裡的 YouTube 網頁都會登出，之後要再按「登入」重新登入。</div>
              <div className="companion-confirm-buttons">
                <button autoFocus onClick={() => setConfirmLogout(false)}>
                  取消
                </button>
                <button className="danger" onClick={logout}>
                  登出
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
