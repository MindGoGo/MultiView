// 注入網頁來源每一個框架（包括跨網域的子框架）的偵測與控制程式（R13、R15–R17）。
// 在沙箱中執行，不能使用 Node.js；只透過固定的訊息和程式溝通（非功能需求：安全）。
//
// 每個框架每秒找一次自己的主要影片候選，跨網域的子框架用 postMessage 回報給上層框架，
// 上層框架把子框架的位置換算到自己的座標後一起比較，最上層框架再回報給程式。
// 同網域的子框架不會執行這個程式，由上層框架直接進去它的文件裡找。
// 影片模式時，從最上層沿著主要影片所在的框架一路往下，每一層只顯示主要影片（或包著它的子框架）並填滿畫面。
import { ipcRenderer } from 'electron'
import { pickMain, toParentRect, type Candidate, type Rect } from '../src/lib/webVideo'
import { pickPlayButton, PLAY_BUTTON_SELECTORS } from '../src/lib/webKick'
import { progressFromMedia, rangesOf, type Progress } from '../src/lib/progress'
import type { CompanionSection, SectionsReady, WebReport, WebState, WebVideoStatus } from '../src/players/webTypes'

const MARK = '__multiview__'
const SCAN_MS = 1000
/** 子框架超過這麼久沒有回報就當作已經不在 */
const STALE_MS = 3000
const isTop = window === window.top

interface ChildReport {
  best: Rect | null
  vw: number
  vh: number
  status: WebVideoStatus | null
  drm: boolean
  progress: Progress | null
  v: number
}

type Target = HTMLVideoElement | HTMLIFrameElement

// 同網域子框架裡的元素屬於另一個執行環境，不能用 instanceof 判斷
const isVideo = (el: Element | null | undefined): el is HTMLVideoElement => el?.tagName === 'VIDEO'
const isFrame = (el: Element | null | undefined): el is HTMLIFrameElement => el?.tagName === 'IFRAME'

let state: WebState = { v: 0, mode: 'video', intent: 'pause', volume: 100, muted: true }
/** 這個框架是否在「最上層 → 主要影片」的路徑上 */
let onPath = isTop
const children = new Map<Window, { report: ChildReport; at: number }>()
/**
 * 主要影片。path 是從這個框架的文件一路往下到它的元素：
 * 中間是同網域子框架的 iframe 元素，最後是影片，或是跨網域子框架的 iframe 元素。
 */
let best: { el: Target; path: Target[]; rect: Rect } | null = null

/** 主要影片在跨網域子框架裡時，回傳那個子框架的 iframe 元素 */
const pathFrame = (b: typeof best) => (b && isFrame(b.el) ? b.el : null)

// ---------- 找影片 ----------

/** 依頁面順序列出影片和子框架，包括開放的 shadow DOM 裡的 */
function collect(root: Document | ShadowRoot, out: Target[]) {
  root.querySelectorAll<Target>('video, iframe').forEach((el) => out.push(el))
  root.querySelectorAll('*').forEach((el) => el.shadowRoot && collect(el.shadowRoot, out))
}

const isShown = (el: Element) =>
  el.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
    opacityProperty: true,
    visibilityProperty: true
  })

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })

function intersect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null
}

/** 同網域子框架裡的位置換算到這個框架的座標，並裁切到子框架的範圍 */
function place(r: Rect, box: Rect | null): Rect | null {
  return box ? intersect({ x: r.x + box.x, y: r.y + box.y, w: r.w, h: r.h }, box) : r
}

function childReport(el: HTMLIFrameElement): ChildReport | null {
  const win = el.contentWindow
  return (win && children.get(win)?.report) ?? null
}

/** 已經掛上訊息監聽的同網域子框架（它們裡面的跨網域子框架會回報給它們） */
const inlineWindows = new WeakSet<Window>()

/** 同網域、而且沒有執行這個程式的子框架文件；跨網域或有回報的子框架回傳 null */
function inlineDoc(frame: HTMLIFrameElement): Document | null {
  const win = frame.contentWindow
  if (!win || children.has(win)) return null
  let doc: Document | null = null
  try {
    doc = frame.contentDocument
  } catch {
    return null
  }
  if (!doc?.documentElement) return null
  if (!inlineWindows.has(win)) {
    inlineWindows.add(win)
    win.addEventListener('message', onMessage)
  }
  return doc
}

/** 子框架內容區在這個框架的座標 */
function contentBox(frame: HTMLIFrameElement): Rect {
  const r = frame.getBoundingClientRect()
  return { x: r.left + frame.clientLeft, y: r.top + frame.clientTop, w: frame.clientWidth, h: frame.clientHeight }
}

function gather(doc: Document, prefix: Target[], box: Rect | null, out: Candidate<Target[]>[]) {
  const targets: Target[] = []
  collect(doc, targets)
  for (const el of targets) {
    if (!el.isConnected || !isShown(el)) continue
    const path = [...prefix, el]
    let rect: Rect | null
    if (isVideo(el)) {
      watchVideo(el)
      rect = toRect(el.getBoundingClientRect())
    } else {
      const report = childReport(el)
      if (report) {
        if (!report.best) continue
        rect = toParentRect(report.best, contentBox(el), report.vw, report.vh)
      } else {
        const inner = inlineDoc(el)
        const content = place(contentBox(el), box)
        if (inner && content) gather(inner, path, content, out)
        continue
      }
    }
    rect = place(rect, box)
    if (!rect) continue
    // 正在放大顯示的元素量不到原本的位置，用放大前記下的位置比較
    if (styled && styled.path[styled.path.length - 1] === el) rect = styled.rect
    out.push({ item: path, rect, order: out.length })
  }
}

function scan() {
  const now = Date.now()
  for (const [win, c] of children) if (win.closed || now - c.at > STALE_MS) children.delete(win)

  // 量測時先拿掉遮罩的樣式，其他元素才量得到原本的位置；同一個工作內恢復，畫面不會閃
  const overlays = [globalStyle, ...(styled?.overlays ?? [])]
  overlays.forEach((s) => s && (s.disabled = true))
  const vw = window.innerWidth
  const vh = window.innerHeight
  const candidates: Candidate<Target[]>[] = []
  if (document.documentElement) gather(document, [], null, candidates)
  overlays.forEach((s) => s && (s.disabled = false))

  const picked = pickMain(candidates, vw, vh)
  const prevFrame = pathFrame(best)
  best = picked && { el: picked.item[picked.item.length - 1], path: picked.item, rect: picked.rect }
  const nextFrame = pathFrame(best)
  if (prevFrame !== nextFrame) {
    if (prevFrame) syncChild(prevFrame)
    if (nextFrame) syncChild(nextFrame)
  }
  applyStyles()
  syncLeaf()
  report(vw, vh)
}

// ---------- 控制主要影片（R15） ----------

/** 主要影片在這個框架（或同網域子框架）時就是它；在跨網域子框架或這個框架不在路徑上時為 null */
let leafVideo: HTMLVideoElement | null = null

function syncLeaf() {
  const v = onPath && best && isVideo(best.el) ? best.el : null
  if (v === leafVideo) return
  leafVideo = v
  // 換成新的主要影片時套用目前的音量和播放意圖（R15）
  if (v) applyControl(v)
}

function applyControl(v: HTMLVideoElement) {
  v.volume = Math.min(Math.max(state.volume, 0), 100) / 100
  if (!state.muted) v.muted = false
  if (state.intent === 'pause') {
    if (!v.paused) v.pause()
  } else if (v.paused && !v.ended) {
    void v.play().catch(() => undefined)
  }
}

/** 觸發過加密媒體事件（需要 DRM）的影片（R16） */
const drmVideos = new WeakSet<EventTarget>()
const watched = new WeakSet<HTMLVideoElement>()

/**
 * 直接在影片上監聽事件：shadow DOM 和同網域子框架裡的影片事件不會傳到這個框架的 window。
 * - 開始、暫停時盡快回報，不等下一次定時檢查
 * - 影片模式下，網站自己開始播放但播放意圖是暫停時，把它暫停（R15 AC5）；
 *   整頁模式下使用者可能直接按了網站的播放，這時改由程式依回報更新播放意圖
 */
/** 這個網頁已經做過「剛載入時暫停一次」（R75） */
let startPaused = false

function watchVideo(v: HTMLVideoElement) {
  if (watched.has(v)) return
  watched.add(v)
  for (const type of ['play', 'pause', 'playing', 'waiting', 'ended', 'emptied', 'loadedmetadata', 'seeked'])
    v.addEventListener(type, scheduleScan)
  v.addEventListener('play', () => {
    // 暫停中切到網頁：網站自己開始播放的當下就暫停，不等下一次回報（R75）
    if (state.pauseOnStart && !startPaused && (v === leafVideo || !leafVideo)) {
      startPaused = true
      v.pause()
      ipcRenderer.sendToHost('mv:startPaused')
      return
    }
    if (v === leafVideo && state.mode === 'video' && state.intent === 'pause') v.pause()
  })
  v.addEventListener('encrypted', () => {
    drmVideos.add(v)
    scheduleScan()
  })
}

// 影片在第一次掃描前就觸發的加密媒體事件
window.addEventListener(
  'encrypted',
  (e) => {
    if (e.target) drmVideos.add(e.target)
    scheduleScan()
  },
  true
)

// ---------- 影片模式的樣式 ----------

// 用一層黑色遮罩蓋住整個網頁，主要影片放在遮罩上面。
// 不能把其他元素設成看不見：有些網站（例如 Twitch）偵測到自己被隱藏時，會連影片一起藏起來。
const GLOBAL_CSS = `
html, body { overflow: hidden !important; }
html::after {
  content: "" !important; position: fixed !important; inset: 0 !important; display: block !important;
  background: #000 !important; z-index: 2147483646 !important; pointer-events: none !important;
}
`
const CHOSEN_CSS: [string, string][] = [
  ['position', 'fixed'],
  ['left', '0'],
  ['top', '0'],
  ['right', 'auto'],
  ['bottom', 'auto'],
  ['width', '100vw'],
  ['height', '100vh'],
  ['min-width', '0'],
  ['min-height', '0'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['transform', 'none'],
  ['clip-path', 'none'],
  ['z-index', '2147483647'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['object-fit', 'contain'],
  ['background', '#000']
]
/**
 * 上層元素有這些屬性時，position: fixed 會以它為基準而不是整個畫面，
 * 或是形成獨立的堆疊層級、讓主要影片被困在遮罩下面，所以一併拿掉
 */
const ANCESTOR_CSS: [string, string][] = [
  ['transform', 'none'],
  ['filter', 'none'],
  ['backdrop-filter', 'none'],
  ['perspective', 'none'],
  ['contain', 'none'],
  ['will-change', 'auto'],
  ['clip-path', 'none'],
  ['mask', 'none'],
  ['opacity', '1'],
  ['z-index', 'auto'],
  ['isolation', 'auto'],
  ['mix-blend-mode', 'normal']
]

let globalStyle: HTMLStyleElement | null = null
/**
 * 目前放大顯示的路徑、放大前的位置、被改過 style 的元素原本的 style 屬性，
 * 以及加在同網域子框架文件裡的遮罩
 */
let styled: {
  path: Target[]
  rect: Rect
  saved: [HTMLElement, string | null][]
  overlays: HTMLStyleElement[]
  /** 網站改寫主要影片的 style 時（例如 YouTube 會一直設定影片的位置和大小），立刻把放大的樣式補回來 */
  observer: MutationObserver
  /** 移到 body 底下的主要影片與它原本的位置（YouTube 網頁，見 needsMove） */
  moved: { el: HTMLVideoElement; parent: Node; next: Node | null } | null
} | null = null

/**
 * YouTube 網頁的影片留在播放器容器（#player-container）裡時，放大到格子大小後整個網頁都畫不出來
 * （全黑但有聲音，關閉硬體解碼、影片疊加層都一樣），移到 body 底下就正常（R48）。只對 YouTube 這樣做，
 * 其他網站維持原本的位置。
 */
function needsMove(path: Target[]): path is [HTMLVideoElement] {
  const host = location.hostname
  return (host === 'youtube.com' || host.endsWith('.youtube.com')) && path.length === 1 && path[0] instanceof HTMLVideoElement
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement
  const root = el.getRootNode() as ShadowRoot
  return root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && root.host ? root.host : null
}

function setStyles(el: HTMLElement, css: [string, string][], saved: [HTMLElement, string | null][]) {
  saved.push([el, el.getAttribute('style')])
  for (const [k, v] of css) el.style.setProperty(k, v, 'important')
}

function unstyle() {
  if (!styled) return
  styled.observer.disconnect()
  const m = styled.moved
  if (m && m.parent.isConnected) m.parent.insertBefore(m.el, m.next && m.next.parentNode === m.parent ? m.next : null)
  for (const [el, attr] of styled.saved.reverse()) {
    if (attr === null) el.removeAttribute('style')
    else el.setAttribute('style', attr)
  }
  styled.overlays.forEach((s) => s.remove())
  styled = null
}

const samePath = (a: Target[], b: Target[]) => a.length === b.length && a.every((el, i) => el === b[i])

function overlayIn(doc: Document): HTMLStyleElement {
  const s = doc.createElement('style')
  s.textContent = GLOBAL_CSS
  doc.documentElement.appendChild(s)
  return s
}

function applyStyles() {
  const selected = onPath && state.mode === 'video'
  if (!selected) {
    unstyle()
    globalStyle?.remove()
    globalStyle = null
    return
  }
  // 還沒找到主要影片時，遮罩讓整頁都是黑色（R13）
  if (!globalStyle && document.documentElement) {
    globalStyle = document.createElement('style')
    globalStyle.textContent = GLOBAL_CSS
  }
  if (globalStyle && !globalStyle.isConnected) document.documentElement.appendChild(globalStyle)

  if (styled && !(best && samePath(styled.path, best.path))) unstyle()
  // 網站把影片搬回自己的容器時再移出來
  if (styled?.moved && styled.moved.el.parentNode !== document.body) document.body.appendChild(styled.moved.el)
  if (best && !styled) {
    const saved: [HTMLElement, string | null][] = []
    const overlays: HTMLStyleElement[] = []
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement
        // 只補回被蓋掉的屬性，避免自己的修改又觸發一次
        for (const [k, v] of CHOSEN_CSS) {
          if (el.style.getPropertyPriority(k) !== 'important') el.style.setProperty(k, v, 'important')
        }
      }
    })
    best.path.forEach((el, i) => {
      // 同網域子框架的文件也要加遮罩
      if (i > 0) overlays.push(overlayIn(el.ownerDocument))
      setStyles(el, CHOSEN_CSS, saved)
      observer.observe(el, { attributes: true, attributeFilter: ['style'] })
      for (let p = parentOf(el); p; p = parentOf(p)) {
        const h = p as HTMLElement
        if (!h.style) continue
        // fixed / sticky 一定會形成堆疊層級，改成一般定位（網頁其他部分已經被遮罩蓋住，版面改變看不到）
        const pos = p.ownerDocument.defaultView?.getComputedStyle(p).position
        setStyles(h, pos === 'fixed' || pos === 'sticky' ? [...ANCESTOR_CSS, ['position', 'static']] : ANCESTOR_CSS, saved)
      }
    })
    let moved: { el: HTMLVideoElement; parent: Node; next: Node | null } | null = null
    if (needsMove(best.path) && best.path[0].parentNode) {
      const el = best.path[0]
      moved = { el, parent: el.parentNode!, next: el.nextSibling }
      document.body.appendChild(el)
    }
    styled = { path: best.path, rect: best.rect, saved, overlays, observer, moved }
  }
}

// ---------- 回報 ----------

function videoStatus(v: HTMLVideoElement): WebVideoStatus {
  if (v.ended) return 'ended'
  if (v.paused) return 'paused'
  // 3 = HAVE_FUTURE_DATA
  return v.readyState < 3 ? 'loading' : 'playing'
}

/** 主要影片的狀態：影片在這個框架就直接讀，在跨網域子框架就用子框架回報的 */
function leafStatus(): WebVideoStatus | null {
  if (!best) return null
  if (isVideo(best.el)) return videoStatus(best.el)
  return childReport(best.el)?.status ?? null
}

/** 主要影片是否需要 DRM：影片在這個框架就直接看，在跨網域子框架就用子框架回報的 */
function leafDrm(): boolean {
  if (!best) return false
  if (isVideo(best.el)) return drmVideos.has(best.el)
  return childReport(best.el)?.drm ?? false
}

/** 主要影片的進度（R19）：影片在這個框架就直接算，在跨網域子框架就用子框架回報的 */
function leafProgress(): Progress | null {
  if (!best) return null
  if (isVideo(best.el)) {
    const v = best.el
    if (v.readyState === 0) return null
    return progressFromMedia({ duration: v.duration, currentTime: v.currentTime, seekable: rangesOf(v.seekable) })
  }
  return childReport(best.el)?.progress ?? null
}

/** 跳轉主要影片（R19）：影片在這個框架就直接設定，在跨網域子框架就往下傳 */
function seekLeaf(seconds: number) {
  if (leafVideo) leafVideo.currentTime = seconds
  else pathFrame(best)?.contentWindow?.postMessage({ [MARK]: 'seek', seconds }, '*')
}

function httpStatus(): number | null {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  return nav?.responseStatus || null
}

function report(vw: number, vh: number) {
  const status = leafStatus()
  const drm = leafDrm()
  const progress = leafProgress()
  if (isTop) {
    const r: WebReport = { found: best !== null, status, v: state.v, drm, http: httpStatus(), progress }
    ipcRenderer.sendToHost('mv:report', r)
  } else {
    const r: ChildReport = { best: best?.rect ?? null, vw, vh, status, drm, progress, v: state.v }
    window.parent.postMessage({ [MARK]: 'report', ...r }, '*')
  }
}

// ---------- 框架之間的同步 ----------

const syncMessage = (win: Window) => ({
  [MARK]: 'sync',
  onPath: onPath && pathFrame(best)?.contentWindow === win,
  state
})

function syncChild(el: HTMLIFrameElement) {
  const win = el.contentWindow
  if (win) win.postMessage(syncMessage(win), '*')
}

/** 狀態改變時立刻往下傳，不等子框架下一次回報 */
function broadcast() {
  for (const win of children.keys()) win.postMessage(syncMessage(win), '*')
}

function setState(next: WebState, nextOnPath: boolean) {
  const changed = next.v !== state.v || nextOnPath !== onPath
  if (isTop && next.section !== state.section) applySection(next.section)
  // 播完的影片按播放時從頭播放（R26 AC4）
  if (next.intent === 'play' && state.intent === 'pause' && leafVideo?.ended) leafVideo.currentTime = 0
  // 之後才出現的框架（例如廣告）第一次收到狀態時不算新的請求，只有已經同步過的框架才按（R113）
  const kicked = state.v > 0 && (next.kick ?? 0) > (state.kick ?? 0)
  state = next
  if (kicked) kickPlay()
  onPath = nextOnPath
  if (changed) {
    applyStyles()
    syncLeaf()
    if (leafVideo) applyControl(leafVideo)
    broadcast()
    scheduleScan()
  }
}

/**
 * 找不到影片時按一次網站的播放鈕（R113）：在這一層框架找看得見、不是連結的播放鈕，挑最大、最靠近中央的一個。
 * 有些播放器聽的是按下、放開，所以依序送出這些事件再 click。
 */
function kickPlay() {
  const els = [...document.querySelectorAll<HTMLElement>(PLAY_BUTTON_SELECTORS)]
  const i = pickPlayButton(
    els.map((el) => ({ rect: toRect(el.getBoundingClientRect()), inLink: !!el.closest('a[href]'), shown: isShown(el) })),
    { w: window.innerWidth, h: window.innerHeight }
  )
  const el = els[i]
  if (!el) return
  const r = el.getBoundingClientRect()
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  el.dispatchEvent(new PointerEvent('pointerdown', at))
  el.dispatchEvent(new MouseEvent('mousedown', at))
  el.dispatchEvent(new PointerEvent('pointerup', at))
  el.dispatchEvent(new MouseEvent('mouseup', at))
  el.click()
}

/** 同步訊息可能直接來自上面任何一層（中間隔著同網域的子框架時） */
function isAncestor(source: Window | null): boolean {
  for (let w: Window = window; w !== w.parent; w = w.parent) if (w.parent === source) return true
  return false
}

let lastForwarded = ''

function onMessage(e: MessageEvent) {
  const d = e.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || !(MARK in d)) return
  const source = e.source as Window | null
  if (d[MARK] === 'report' && source) {
    children.set(source, { report: d as unknown as ChildReport, at: Date.now() })
    // 回覆目前的狀態和是否在路徑上，新出現的子框架也能馬上拿到
    source.postMessage(syncMessage(source), '*')
    // 主要影片所在的子框架狀態改變時，馬上往上回報
    const forwarded = String(d.status) + '|' + String(d.drm)
    if (pathFrame(best)?.contentWindow === source && forwarded !== lastForwarded) {
      lastForwarded = forwarded
      scheduleScan()
    }
  } else if (d[MARK] === 'sync' && !isTop && e.currentTarget === window && isAncestor(source)) {
    setState(d.state as WebState, d.onPath === true)
  } else if (d[MARK] === 'seek' && !isTop && e.currentTarget === window && isAncestor(source) && onPath) {
    seekLeaf(Number(d.seconds))
  }
}
window.addEventListener('message', onMessage)

if (isTop) {
  ipcRenderer.on('mv:state', (_, next: WebState) => setState(next, true))
  ipcRenderer.on('mv:seek', (_, seconds: number) => {
    seekLeaf(seconds)
    scheduleScan()
  })
  // 網頁重新載入後狀態會遺失，向程式要一次
  ipcRenderer.sendToHost('mv:hello')
}

let scanTimer: ReturnType<typeof setTimeout> | undefined
function scheduleScan() {
  if (scanTimer) return
  scanTimer = setTimeout(() => {
    scanTimer = undefined
    scan()
  }, 50)
}

setInterval(scan, SCAN_MS)

// 滑鼠的上一頁／下一頁側鍵（R28）：只有整頁模式網頁收得到（影片模式被格子上的攔截層擋住），
// 由程式確認是整頁模式後換頁。Chromium 不會把側鍵轉成視窗的 app-command，只能在網頁裡聽。
window.addEventListener(
  'mouseup',
  (e) => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    ipcRenderer.sendToHost('mv:nav', e.button === 3)
  },
  true
)

// ---------- YouTube 網站頁面的影片連結（R57、R63） ----------
// 在 YouTube 自己的處理之前攔下影片連結的點擊：網頁不換頁（保留搜尋結果、捲動位置，也不會在網頁裡開始播放），
// 交給程式把這一格換成那部影片。只在最上層框架、程式開啟這個功能時作用。
function youtubeVideoHref(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
  if (!a) return null
  try {
    const u = new URL(a.href, location.href)
    const host = u.hostname.toLowerCase()
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com')
    return isYouTube && u.pathname === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') ?? '') ? u.href : null
  } catch {
    return null
  }
}
if (window === window.top) {
  window.addEventListener(
    'click',
    (e) => {
      if (!state.interceptYouTube || e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey) return
      const href = youtubeVideoHref(e.target)
      if (!href) return
      e.preventDefault()
      e.stopImmediatePropagation()
      ipcRenderer.sendToHost('mv:ytvideo', href, location.href)
    },
    true
  )
}

// ---------- YouTube 小視窗的推薦區、留言區（R79、R80） ----------
// 推薦區和留言區各自固定填滿整個畫面、可以捲動，只有目前分頁的那一個看得到（另一個隱藏但保留捲動位置）；
// 網頁其他部分（影片、頂端列）設成看不見，只有目前的區域看得見（子元素可以覆蓋上層的 visibility）；
// 不靠 z-index 蓋住，YouTube 的層級設定會讓其他固定位置的元素畫在上面。
// 一開始（區域還沒出現時）整個網頁就看不見，讀取中不會透出影片；
// YouTube 改版、一直找不到這兩個區域時，由小視窗取消這個模式，顯示整個網頁（R86）。
const SECTION_SELECTORS: Record<CompanionSection, string> = {
  related: 'ytd-watch-flexy #related',
  comments: 'ytd-watch-flexy #comments'
}
const PANE_CSS = `position: fixed !important; inset: 0 !important; width: auto !important; min-width: 0 !important;
  max-width: none !important; height: auto !important; margin: 0 !important; padding: 12px 16px !important;
  box-sizing: border-box !important; overflow-y: auto !important; z-index: 2147483647 !important;
  display: block !important; background: #fff !important;`
function sectionCss(active: CompanionSection): string {
  const sels = Object.values(SECTION_SELECTORS)
  const inactive = SECTION_SELECTORS[active === 'related' ? 'comments' : 'related']
  return `
html:has(${SECTION_SELECTORS[active]}), html:has(${SECTION_SELECTORS[active]}) body { overflow: hidden !important; }
${sels.join(', ')} { ${PANE_CSS} }
html[dark] :is(${sels.join(', ')}) { background: #0f0f0f !important; }
${SECTION_SELECTORS[active]} { visibility: visible !important; }
${inactive} { visibility: hidden !important; pointer-events: none !important; }
html:has(${SECTION_SELECTORS[active]}) #masthead-container { display: none !important; }
body { visibility: hidden !important; }
html { background: #fff !important; }
html[dark] { background: #0f0f0f !important; }
`
}
let sectionStyle: HTMLStyleElement | null = null
function applySection(section: CompanionSection | undefined) {
  if (!section) {
    sectionStyle?.remove()
    sectionStyle = null
    return
  }
  // 影片不播放（R79 AC1）：已經在播的也暫停
  document.querySelectorAll('video').forEach((v) => {
    v.muted = true
    if (!v.paused) v.pause()
  })
  if (!document.documentElement) return
  sectionStyle ??= document.createElement('style')
  sectionStyle.textContent = sectionCss(section)
  if (!sectionStyle.isConnected) document.documentElement.appendChild(sectionStyle)
}
window.addEventListener('DOMContentLoaded', () => state.section && applySection(state.section))

// 推薦區、留言區已經有內容時回報，小視窗才拿掉讀取畫面（R86）。
// 留言區一開始就存在但是空的，所以看內容：留言、留言數與排序、或「留言功能已關閉」等訊息
const SECTION_CONTENT: Record<CompanionSection, string> = {
  related: 'a[href*="/watch?v="]',
  comments: 'ytd-comment-thread-renderer, ytd-comments-header-renderer, ytd-message-renderer'
}
const SECTIONS_CHECK_MS = 300
/** 網頁載入完成後留言區一直被 YouTube 藏起來這麼久，才當作沒有留言（載入中也可能短暫藏起來） */
const COMMENTS_OFF_MS = 3000
let sentSections = ''
let commentsHiddenSince = 0
if (isTop) {
  setInterval(() => {
    if (!state.section || !sectionStyle?.isConnected) return
    const ready = {} as SectionsReady
    for (const k of Object.keys(SECTION_SELECTORS) as CompanionSection[])
      ready[k] = !!document.querySelector(`${SECTION_SELECTORS[k]} :is(${SECTION_CONTENT[k]})`)
    const hidden = document.readyState === 'complete' && !ready.comments && !!document.querySelector(`${SECTION_SELECTORS.comments}[hidden]`)
    commentsHiddenSince = hidden ? commentsHiddenSince || Date.now() : 0
    ready.commentsOff = hidden && Date.now() - commentsHiddenSince >= COMMENTS_OFF_MS
    const key = JSON.stringify(ready)
    if (key === sentSections) return
    sentSections = key
    ipcRenderer.sendToHost('mv:sections', ready)
  }, SECTIONS_CHECK_MS)
}
// 小視窗的影片網頁：影片（包括廣告）一開始播放就暫停（R79、R80）。
// 媒體事件不會往上傳，但捕獲階段收得到，不等定時找影片
window.addEventListener(
  'play',
  (e) => {
    const v = e.target as HTMLMediaElement
    if (!state.section || v.tagName !== 'VIDEO') return
    v.muted = true
    v.pause()
  },
  true
)

// ---------- 隱藏廣告元素（R17） ----------
// 把頁面上出現的 class / id / 連結交給程式比對廣告清單，拿回要隱藏的樣式。
// 關閉廣告阻擋的格子和 YouTube 播放器框架，程式會回傳空字串。

const MAX_TOKENS = 1000
const seen = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() }
let adStyle: HTMLStyleElement | null = null

function collectNew(root: ParentNode, out: { classes: string[]; ids: string[]; hrefs: string[] }) {
  root.querySelectorAll('[class], [id], a[href]').forEach((el) => {
    el.classList.forEach((c) => {
      if (!seen.classes.has(c) && out.classes.length < MAX_TOKENS) {
        seen.classes.add(c)
        out.classes.push(c)
      }
    })
    if (el.id && !seen.ids.has(el.id) && out.ids.length < MAX_TOKENS) {
      seen.ids.add(el.id)
      out.ids.push(el.id)
    }
    const href = el instanceof HTMLAnchorElement ? el.href : ''
    if (href && !seen.hrefs.has(href) && out.hrefs.length < MAX_TOKENS) {
      seen.hrefs.add(href)
      out.hrefs.push(href)
    }
  })
}

async function requestCosmetics(first: boolean) {
  const dom = { url: location.href, classes: [] as string[], ids: [] as string[], hrefs: [] as string[] }
  if (document.documentElement) collectNew(document, dom)
  if (!first && dom.classes.length + dom.ids.length + dom.hrefs.length === 0) return
  const css = (await ipcRenderer.invoke('adblock:cosmetics', dom).catch(() => '')) as string
  if (!css || !document.documentElement) return
  adStyle ??= document.createElement('style')
  adStyle.textContent += css + '\n'
  if (!adStyle.isConnected) document.documentElement.appendChild(adStyle)
}

let cosmeticsTimer: ReturnType<typeof setTimeout> | undefined
function scheduleCosmetics() {
  if (cosmeticsTimer) return
  cosmeticsTimer = setTimeout(() => {
    cosmeticsTimer = undefined
    void requestCosmetics(false)
  }, 500)
}

if (location.protocol === 'http:' || location.protocol === 'https:') {
  window.addEventListener('DOMContentLoaded', () => {
    void requestCosmetics(true)
    new MutationObserver(scheduleCosmetics).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id']
    })
  })
}
