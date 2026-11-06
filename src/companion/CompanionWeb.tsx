// 小視窗裡的一個網頁（R78）：和網頁來源一樣在沙箱中執行、套用廣告阻擋；建立後一直保留，切換分頁時不重新載入
import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { WEB_PARTITION, type CompanionSection, type SectionsReady, type WebState } from '../players/webTypes'
import { LoadingCritter } from '../components/LoadingCritter'

/** 小視窗裡 YouTube 網頁的捲軸：深色細捲軸（R105 的共用規則、R106） */
const SCROLLBAR_CSS = `
/* 新版 Chromium 在網頁設定了 scrollbar-color 時會忽略 ::-webkit-scrollbar，兩種寫法都加 */
* { scrollbar-width: thin !important; scrollbar-color: rgba(128, 128, 128, 0.45) transparent !important; }
::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent !important; }
::-webkit-scrollbar-thumb { border: 2px solid transparent !important; border-radius: 999px !important; background: rgba(128, 128, 128, 0.35) padding-box !important; }
:hover::-webkit-scrollbar-thumb { background-color: rgba(128, 128, 128, 0.55) !important; }
::-webkit-scrollbar-button { display: none !important; }
`

/** 網頁載入完成後這麼久仍然沒有推薦區／留言區，就拿掉讀取畫面顯示整個網頁（R86） */
export const SECTION_WAIT_MS = 15000
export const LOADING_TEXT = '讀取中…'
export const NO_COMMENTS = '這部影片目前沒有留言（直播中請看聊天室）'
const NOT_READY: SectionsReady = { related: false, comments: false }

interface Props {
  /** 要顯示的網址；null 時維持目前的網頁 */
  url: string | null
  shown: boolean
  /** 影片網頁只顯示推薦區或留言區（R79、R80） */
  section?: CompanionSection
  /** 手機版的瀏覽器識別（R82） */
  userAgent?: string
  /** 攔下 YouTube 影片連結的點擊，網頁不換頁（R63 的做法） */
  onVideo?(href: string): void
  /** 網頁標題改變（網頁目前的網址、標題） */
  onTitle?(url: string, title: string): void
}

export function CompanionWeb({ url, shown, section, userAgent, onVideo, onTitle }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<WebviewTag | null>(null)
  /** 設定好廣告阻擋、可以載入網址了；loaded 是目前載入的網址 */
  const page = useRef({ ready: false, loaded: '' })
  const latest = useRef({ url, section, onVideo, onTitle })
  latest.current = { url, section, onVideo, onTitle }
  const stateRef = useRef<WebState>({ v: 0, mode: 'page', intent: 'pause', volume: 0, muted: true })
  /** 推薦區、留言區是否已經有內容；等太久時改顯示整個網頁（R86） */
  const [ready, setReady] = useState<SectionsReady>(NOT_READY)
  const [gaveUp, setGaveUp] = useState(false)
  /** 目前的區域等太久仍然沒有內容：取消只顯示那一區，顯示整個網頁（R86） */
  const fallback = gaveUp && !!section && !ready[section] && !(section === 'comments' && ready.commentsOff)
  const fallbackRef = useRef(false)
  fallbackRef.current = fallback

  const sendState = () => {
    const view = viewRef.current
    if (!view || !page.current.ready) return
    stateRef.current = {
      ...stateRef.current,
      v: stateRef.current.v + 1,
      interceptYouTube: !!latest.current.onVideo,
      section: fallbackRef.current ? undefined : latest.current.section
    }
    view.send('mv:state', stateRef.current)
  }
  const load = () => {
    const view = viewRef.current
    const next = latest.current.url
    if (!view || !page.current.ready || !next || next === page.current.loaded) return
    page.current.loaded = next
    void view.loadURL(next).catch(() => undefined)
  }

  useEffect(() => {
    const view = document.createElement('webview') as WebviewTag
    view.setAttribute('partition', WEB_PARTITION)
    if (userAgent) view.setAttribute('useragent', userAgent)
    // 先載入空白頁；設定好廣告阻擋後才載入網址（R17）
    view.setAttribute('src', 'about:blank')
    view.className = 'companion-web'
    viewRef.current = view
    let started = false
    const onReady = () => {
      // 小視窗的網頁一律靜音（推薦、留言的網頁不播放，搜尋結果的預覽也不出聲）
      view.setAudioMuted(true)
      // 每次換頁都重新加上深色細捲軸（R106）
      void view.insertCSS(SCROLLBAR_CSS).catch(() => undefined)
      if (started) return
      started = true
      void window.companion.initWeb(view.getWebContentsId(), { adblock: true }).then(() => {
        page.current.ready = true
        load()
      })
    }
    const onMessage = (e: Electron.IpcMessageEvent) => {
      if (e.channel === 'mv:hello') sendState()
      else if (e.channel === 'mv:ytvideo' && typeof e.args[0] === 'string') latest.current.onVideo?.(e.args[0])
      else if (e.channel === 'mv:sections') setReady({ ...NOT_READY, ...(e.args[0] as SectionsReady) })
    }
    // 換頁（換影片）時重新顯示讀取畫面；網頁載入完成後開始計時（R86）
    let waitTimer: ReturnType<typeof setTimeout> | undefined
    const onStartNavigation = (e: Electron.DidStartNavigationEvent) => {
      if (!e.isMainFrame || e.isInPlace) return
      clearTimeout(waitTimer)
      setReady(NOT_READY)
      fallbackRef.current = false
      setGaveUp(false)
    }
    const onFinishLoad = () => {
      if (view.getURL() === 'about:blank') return
      clearTimeout(waitTimer)
      waitTimer = setTimeout(() => setGaveUp(true), SECTION_WAIT_MS)
    }
    const onPageTitle = (e: Electron.PageTitleUpdatedEvent) => latest.current.onTitle?.(view.getURL(), e.title)
    view.addEventListener('dom-ready', onReady)
    view.addEventListener('ipc-message', onMessage)
    view.addEventListener('page-title-updated', onPageTitle)
    view.addEventListener('did-start-navigation', onStartNavigation)
    view.addEventListener('did-finish-load', onFinishLoad)
    hostRef.current?.appendChild(view)
    return () => {
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('ipc-message', onMessage)
      view.removeEventListener('page-title-updated', onPageTitle)
      view.removeEventListener('did-start-navigation', onStartNavigation)
      view.removeEventListener('did-finish-load', onFinishLoad)
      clearTimeout(waitTimer)
      view.remove()
      viewRef.current = null
    }
  }, [])

  useEffect(load, [url])
  useEffect(sendState, [section, fallback])

  // 讀取畫面蓋在網頁上面，網頁在背後照常載入（留言要在畫面上才會開始載入）（R86）
  const commentsOff = section === 'comments' && !!ready.commentsOff
  const loading = !!section && !ready[section] && !gaveUp
  return (
    <div className={`companion-pane ${shown ? '' : 'hidden'}`}>
      <div ref={hostRef} className="companion-web-host" />
      {(loading || commentsOff) && (
        <div className="companion-loading">
          {commentsOff ? NO_COMMENTS : <LoadingCritter kind="loading" label={LOADING_TEXT} />}
        </div>
      )}
    </div>
  )
}
