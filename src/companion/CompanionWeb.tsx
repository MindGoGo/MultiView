// 小視窗裡的一個網頁（R78）：和網頁來源一樣在沙箱中執行、套用廣告阻擋；建立後一直保留，切換分頁時不重新載入
import { useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { WEB_PARTITION, type CompanionSection, type WebState } from '../players/webTypes'

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

  const sendState = () => {
    const view = viewRef.current
    if (!view || !page.current.ready) return
    stateRef.current = {
      ...stateRef.current,
      v: stateRef.current.v + 1,
      interceptYouTube: !!latest.current.onVideo,
      section: latest.current.section
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
    }
    const onPageTitle = (e: Electron.PageTitleUpdatedEvent) => latest.current.onTitle?.(view.getURL(), e.title)
    view.addEventListener('dom-ready', onReady)
    view.addEventListener('ipc-message', onMessage)
    view.addEventListener('page-title-updated', onPageTitle)
    hostRef.current?.appendChild(view)
    return () => {
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('ipc-message', onMessage)
      view.removeEventListener('page-title-updated', onPageTitle)
      view.remove()
      viewRef.current = null
    }
  }, [])

  useEffect(load, [url])
  useEffect(sendState, [section])

  return <div ref={hostRef} className={`companion-pane ${shown ? '' : 'hidden'}`} />
}
