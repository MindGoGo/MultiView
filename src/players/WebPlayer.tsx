// 網頁來源的播放器（R13–R17）：在格子裡用 <webview> 載入整個網頁
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { parseSource } from '../lib/source'
import type { WebviewTag } from 'electron'
import type { NavState, PlayerHandle, PlayerProps, PlayStatus } from './types'
import { isHttpFailure, isLoadFailure, LOAD_TIMEOUT_MS, type WebFailure } from '../lib/webErrors'
import { videoModeScale } from '../lib/webVideo'
import { intentFromReport, shouldWaitForVideo } from '../lib/webPlayback'
import { WEB_PARTITION, type WebMode, type WebReport, type WebState } from './webTypes'

interface Props extends PlayerProps {
  url: string
  /** 廣告阻擋（R17）；改變時由上層換新的來源 id，網頁會重新載入 */
  adblock: boolean
  mode: WebMode
  onModeChange(mode: WebMode): void
  /** 能不能上一頁／下一頁改變時通知（R28） */
  onNavState(state: NavState): void
  /**
   * YouTube 網站頁面（R57）：網頁換到影片頁時通知（網址），網頁先靜音並暫停，不在網頁裡播出聲音；
   * 沒有提供時照一般網頁處理。from 是點影片前的頁面網址（R63）
   */
  onYouTubeVideo?(url: string, from: string): void
  /** 保留在背景的來源頁面（R63）：不顯示、靜音；回到前景時恢復聲音 */
  parked?: boolean
  /**
   * 網頁剛載入、網站自己開始播放時暫停一次（R66：播放器暫停時切到 YouTube 網頁）。
   * 整頁模式平常不阻止網站播放（R15），所以只處理第一次
   */
  pauseOnStart?: boolean
}

/** 網頁載入完成或主要影片消失後，找不到主要影片多久就切換成整頁模式（R13 AC4） */
export const NO_VIDEO_MS = 15000
/** 上次的觀看進度最多等多久才放棄（R55） */
const PENDING_START_MS = 30000
const NOTICE_AUTO_MS = 5000
const NOTICE_NOT_FOUND_MS = 3000
export const NOTICE_AUTO = '找不到影片，可以在網頁中操作後按「只顯示影片」'
export const NOTICE_NOT_FOUND = '找不到影片'

export const WebPlayer = forwardRef<PlayerHandle, Props>(function WebPlayer(
  { url, adblock, mode, onModeChange, onNavState, onYouTubeVideo, parked, pauseOnStart, muted, volume, autoplay, active, startAt, onStatus, onLoaded },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<WebviewTag | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ mode, onModeChange, onStatus, onLoaded, onNavState, onYouTubeVideo })
  latest.current = { mode, onModeChange, onStatus, onLoaded, onNavState, onYouTubeVideo }
  /** 網頁回報的最新結果，以及網頁是否已經載入完成 */
  const page = useRef({ loaded: false, found: false, attached: false, failed: false })
  /** 還要在網站自己開始播放時暫停一次（R66） */
  const pauseOnce = useRef(!!pauseOnStart)
  /** 網頁回報的主要影片進度（R19） */
  const progressRef = useRef<WebReport['progress']>(null)
  /**
   * 還沒跳過去的上次觀看進度（R55）：等影片長度大於這個位置才跳（YouTube 網頁會先播比較短的廣告）；
   * 跳過去之前不回報進度，存檔時保留原本的位置。第一次有進度後 30 秒內都等不到就放棄，從頭開始。
   */
  const pendingStart = useRef(startAt)
  const pendingSince = useRef(0)
  // 新加入的來源播放意圖是「播放」，從設定檔還原的是「暫停」（R15）
  const stateRef = useRef<WebState>({
    v: 0,
    mode,
    intent: autoplay ? 'play' : 'pause',
    volume,
    muted,
    interceptYouTube: !!onYouTubeVideo
  })
  const noVideoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = (text: string, ms: number) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }
  const showNoticeRef = useRef(showNotice)
  showNoticeRef.current = showNotice

  const sendState = () => {
    const view = viewRef.current
    if (!view || !page.current.attached) return
    view.send('mv:state', stateRef.current)
    window.multiview.setWebMode(view.getWebContentsId(), stateRef.current.mode)
    // 靜音作用在整個網頁，包括主要影片以外的聲音（R15 AC6）
    view.setAudioMuted(stateRef.current.muted)
  }
  const updateState = (patch: Partial<Omit<WebState, 'v'>>) => {
    stateRef.current = { ...stateRef.current, ...patch, v: stateRef.current.v + 1 }
    sendState()
  }
  const updateStateRef = useRef(updateState)
  updateStateRef.current = updateState

  /** 影片模式、網頁已載入、但沒有主要影片時開始計時，否則取消（R13 AC4、AC3-3） */
  const checkNoVideo = () => {
    if (shouldWaitForVideo({ mode: latest.current.mode, ...page.current })) {
      noVideoTimer.current ??= setTimeout(() => {
        noVideoTimer.current = null
        latest.current.onModeChange('page')
        showNoticeRef.current(NOTICE_AUTO, NOTICE_AUTO_MS)
      }, NO_VIDEO_MS)
    } else if (noVideoTimer.current) {
      clearTimeout(noVideoTimer.current)
      noVideoTimer.current = null
    }
  }
  const checkNoVideoRef = useRef(checkNoVideo)
  checkNoVideoRef.current = checkNoVideo

  useEffect(() => {
    const view = document.createElement('webview') as WebviewTag
    view.setAttribute('partition', WEB_PARTITION)
    // 先載入空白頁；設定好廣告阻擋後才載入使用者的網址（R17）
    view.setAttribute('src', 'about:blank')
    view.className = 'web-view'
    viewRef.current = view
    page.current = { loaded: false, found: false, attached: false, failed: false }
    progressRef.current = null
    let lastStatus: PlayStatus | null = null
    const report = (s: PlayStatus) => {
      if (page.current.failed) return
      if (s !== lastStatus) latest.current.onStatus(s)
      lastStatus = s
    }
    report('loading')

    // 錯誤狀態（R16）：不自動重試，等使用者按「重試」或「更換網址」
    let loadTimer: ReturnType<typeof setTimeout> | undefined
    const fail = (failure: WebFailure) => {
      if (page.current.failed) return
      clearTimeout(loadTimer)
      page.current.failed = true
      checkNoVideoRef.current()
      if (failure === 'drm') updateStateRef.current({ intent: 'pause' })
      else if (page.current.attached) view.stop()
      latest.current.onStatus('error', failure)
    }
    const startLoadTimer = () => {
      clearTimeout(loadTimer)
      loadTimer = setTimeout(() => fail('load'), LOAD_TIMEOUT_MS)
    }
    startLoadTimer()
    const onStartNavigation = (e: Electron.DidStartNavigationEvent) => {
      if (e.isMainFrame && !e.isInPlace) {
        page.current.loaded = false
        checkNoVideoRef.current()
        startLoadTimer()
      }
    }
    // 空白頁第一次 dom-ready 時網頁已經建立，設定好廣告阻擋後才載入使用者的網址（R17）
    let started = false
    const start = () => {
      if (started) return
      started = true
      void window.multiview
        .initWeb(view.getWebContentsId(), { adblock })
        .then(() => view.isConnected && view.setAttribute('src', url))
    }
    const onFailLoad = (e: Electron.DidFailLoadEvent) => {
      if (isLoadFailure(e.errorCode, e.isMainFrame)) fail('load')
    }
    const onGone = () => fail('load')

    // 瀏覽紀錄從使用者的網址開始：程式內部先載入的空白頁不算一頁（R28）
    let historyCleared = false
    const reportNav = () => {
      if (!page.current.attached) return
      latest.current.onNavState({ back: view.canGoBack(), forward: view.canGoForward() })
    }
    // YouTube 網站換到影片頁（YouTube 是單頁應用程式，通常是同一頁內換網址）（R57）
    // 點影片前的頁面（R63）
    let pageUrl = url
    const checkYouTubeVideo = (next: string) => {
      const cb = latest.current.onYouTubeVideo
      if (!cb || parseSource(next)?.kind !== 'youtube') {
        if (next !== 'about:blank') pageUrl = next
        return
      }
      view.setAudioMuted(true)
      updateStateRef.current({ intent: 'pause' })
      cb(next, pageUrl)
      // 網頁退回點影片前的頁面，保留在背景，不在背景播放影片（R63）
      if (view.canGoBack()) view.goBack()
    }
    const onNavigate = (e: Electron.DidNavigateEvent) => {
      if (!historyCleared && e.url !== 'about:blank') {
        historyCleared = true
        view.clearHistory()
      }
      reportNav()
      checkYouTubeVideo(e.url)
    }
    const onNavigateInPage = (e: Electron.DidNavigateInPageEvent) => {
      reportNav()
      if (e.isMainFrame) checkYouTubeVideo(e.url)
    }

    const onDomReady = () => {
      page.current.attached = true
      sendState()
      start()
    }
    const onFinishLoad = () => {
      if (view.getURL() === 'about:blank') return
      clearTimeout(loadTimer)
      if (!page.current.loaded && !page.current.failed) latest.current.onLoaded?.()
      page.current.loaded = true
      checkNoVideoRef.current()
    }
    const onIpc = (e: Electron.IpcMessageEvent) => {
      if (e.channel === 'mv:hello') {
        sendState()
      } else if (e.channel === 'mv:ytvideo') {
        // YouTube 網站頁面點了影片連結：網頁沒有換頁，停在原本的位置（R57、R63）
        const [href, from] = e.args as [string, string]
        if (typeof href === 'string' && parseSource(href)?.kind === 'youtube')
          latest.current.onYouTubeVideo?.(href, typeof from === 'string' ? from : url)
      } else if (e.channel === 'mv:nav') {
        // 滑鼠側鍵只在整頁模式作用（R28 AC3）
        if (latest.current.mode !== 'page' || !page.current.attached) return
        if (e.args[0] === true && view.canGoBack()) view.goBack()
        else if (e.args[0] === false && view.canGoForward()) view.goForward()
      } else if (e.channel === 'mv:report') {
        const r = e.args[0] as WebReport
        if (isHttpFailure(r.http)) fail('load')
        else if (r.drm) fail('drm')
        if (page.current.failed) return
        page.current.found = r.found
        progressRef.current = r.progress
        const t = pendingStart.current
        if (t && r.progress) {
          pendingSince.current ||= Date.now()
          if (r.progress.live) pendingStart.current = null
          else if (t < r.progress.end) {
            pendingStart.current = null
            view.send('mv:seek', t)
          } else if (Date.now() - pendingSince.current > PENDING_START_MS) pendingStart.current = null
        }
        checkNoVideoRef.current()
        report(r.status ?? 'loading')
        if (pauseOnce.current && r.status === 'playing') {
          pauseOnce.current = false
          updateStateRef.current({ intent: 'pause' })
          return
        }
        // 整頁模式中使用者直接按網站的播放 / 暫停，也算播放意圖（R15 AC7）
        const intent = intentFromReport(stateRef.current, r)
        if (intent) updateStateRef.current({ intent })
      }
    }
    view.addEventListener('dom-ready', onDomReady)
    view.addEventListener('did-finish-load', onFinishLoad)
    view.addEventListener('ipc-message', onIpc)
    view.addEventListener('did-start-navigation', onStartNavigation)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigateInPage)
    view.addEventListener('did-fail-load', onFailLoad)
    view.addEventListener('render-process-gone', onGone)
    hostRef.current!.appendChild(view)

    return () => {
      clearTimeout(loadTimer)
      view.removeEventListener('dom-ready', onDomReady)
      view.removeEventListener('did-finish-load', onFinishLoad)
      view.removeEventListener('ipc-message', onIpc)
      view.removeEventListener('did-start-navigation', onStartNavigation)
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigateInPage)
      view.removeEventListener('did-fail-load', onFailLoad)
      view.removeEventListener('render-process-gone', onGone)
      view.remove()
      viewRef.current = null
      if (noVideoTimer.current) clearTimeout(noVideoTimer.current)
      noVideoTimer.current = null
    }
  }, [url])

  useEffect(() => {
    // <webview> 的底色是透明的；整頁模式比照一般瀏覽器用白色，影片模式用黑色
    if (viewRef.current) viewRef.current.style.background = mode === 'page' ? '#fff' : '#000'
    updateStateRef.current({ mode })
    checkNoVideoRef.current()
  }, [mode])

  useEffect(() => {
    if (stateRef.current.muted !== muted) updateStateRef.current({ muted })
  }, [muted])

  // 回到前景時恢復聲音（R63）；背景時維持靜音
  useEffect(() => {
    const view = viewRef.current
    if (view && page.current.attached) view.setAudioMuted(!!parked)
  }, [parked])

  useEffect(() => {
    if (stateRef.current.volume !== volume) updateStateRef.current({ volume })
  }, [volume])

  // 變成隱藏的來源時暫停（R15 AC4）
  useEffect(() => {
    if (!active) updateStateRef.current({ intent: 'pause' })
  }, [active])

  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // 影片模式下網頁以較大的尺寸排版再縮小；整頁模式以格子大小排版、不縮放（R13、R14）
  useEffect(() => {
    const host = hostRef.current!
    const layout = () => {
      const view = viewRef.current
      if (!view) return
      const w = host.clientWidth
      const h = host.clientHeight
      const f = mode === 'video' ? videoModeScale(w, h) : 1
      view.style.width = `${w / f}px`
      view.style.height = `${h / f}px`
      view.style.transform = f === 1 ? '' : `scale(${f})`
    }
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(host)
    return () => ro.disconnect()
  }, [mode, url])

  useImperativeHandle(ref, () => ({
    play: () => updateStateRef.current({ intent: 'play' }),
    pause: () => updateStateRef.current({ intent: 'pause' }),
    getProgress: () => (page.current.failed || pendingStart.current ? null : progressRef.current),
    getTitle: () => (viewRef.current && page.current.attached ? viewRef.current.getTitle() || null : null),
    getUrl: () => (viewRef.current && page.current.attached ? viewRef.current.getURL() || null : null),
    goBack: () => {
      const view = viewRef.current
      if (view && page.current.attached && view.canGoBack()) view.goBack()
    },
    goForward: () => {
      const view = viewRef.current
      if (view && page.current.attached && view.canGoForward()) view.goForward()
    },
    seek: (seconds) => {
      const view = viewRef.current
      if (view && page.current.attached) view.send('mv:seek', seconds)
    },
    // 「只顯示影片」：找得到主要影片才切回影片模式（R14 AC2）
    requestVideoMode: () => {
      if (page.current.found) latest.current.onModeChange('video')
      else showNoticeRef.current(NOTICE_NOT_FOUND, NOTICE_NOT_FOUND_MS)
    }
  }))

  return (
    <div className="player web-host" ref={hostRef}>
      {notice && <div className="web-notice">{notice}</div>}
    </div>
  )
})
