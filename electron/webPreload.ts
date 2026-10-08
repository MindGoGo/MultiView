// 注入網頁來源每一個框架（包括跨網域的子框架）的偵測與控制程式（R13、R15）。
// 在沙箱中執行，不能使用 Node.js；只透過固定的訊息和程式溝通（非功能需求：安全）。
//
// 每個框架每秒找一次自己的主要影片候選，子框架用 postMessage 回報給上層框架，
// 上層框架把子框架的位置換算到自己的座標後一起比較，最上層框架再回報給程式。
// 影片模式時，從最上層沿著主要影片所在的框架一路往下，每一層只顯示主要影片（或包著它的子框架）並填滿畫面。
import { ipcRenderer } from 'electron'
import { pickMain, toParentRect, type Candidate, type Rect } from '../src/lib/webVideo'
import type { WebReport, WebState, WebVideoStatus } from '../src/players/webTypes'

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
  v: number
}

type Target = HTMLVideoElement | HTMLIFrameElement

let state: WebState = { v: 0, mode: 'video', intent: 'pause', volume: 100, muted: true }
/** 這個框架是否在「最上層 → 主要影片」的路徑上 */
let onPath = isTop
const children = new Map<Window, { report: ChildReport; at: number }>()
let best: { el: Target; rect: Rect } | null = null

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

function childReport(el: HTMLIFrameElement): ChildReport | null {
  const win = el.contentWindow
  return (win && children.get(win)?.report) ?? null
}

function scan() {
  const now = Date.now()
  for (const [win, c] of children) if (win.closed || now - c.at > STALE_MS) children.delete(win)

  // 量測時先拿掉全頁隱藏的樣式，其他元素才量得到原本的位置；同一個工作內恢復，畫面不會閃
  if (globalStyle) globalStyle.disabled = true
  const vw = window.innerWidth
  const vh = window.innerHeight
  const targets: Target[] = []
  if (document.documentElement) collect(document, targets)
  const candidates: Candidate<Target>[] = []
  targets.forEach((el, order) => {
    if (!el.isConnected || !isShown(el)) return
    let rect: Rect | null
    if (el instanceof HTMLVideoElement) {
      rect = toRect(el.getBoundingClientRect())
    } else {
      const report = childReport(el)
      if (!report?.best) return
      const r = el.getBoundingClientRect()
      const content = { x: r.left + el.clientLeft, y: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight }
      rect = toParentRect(report.best, content, report.vw, report.vh)
    }
    // 正在放大顯示的元素量不到原本的位置，用放大前記下的位置比較
    if (styled?.el === el) rect = styled.rect
    candidates.push({ item: el, rect, order })
  })
  if (globalStyle) globalStyle.disabled = false

  const picked = pickMain(candidates, vw, vh)
  const prev = best?.el ?? null
  best = picked && { el: picked.item, rect: picked.rect }
  if (prev !== (best?.el ?? null)) {
    if (prev instanceof HTMLIFrameElement) syncChild(prev)
    if (best?.el instanceof HTMLIFrameElement) syncChild(best.el)
  }
  applyStyles()
  syncLeaf()
  report(vw, vh)
}

// ---------- 控制主要影片（R15） ----------

/** 主要影片在這個框架時就是它；在子框架或這個框架不在路徑上時為 null */
let leafVideo: HTMLVideoElement | null = null

function syncLeaf() {
  const v = onPath && best?.el instanceof HTMLVideoElement ? best.el : null
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

// 影片模式下，網站自己開始播放但播放意圖是暫停時，把它暫停（R15 AC5）。
// 整頁模式下使用者可能直接按了網站的播放，這時改由程式依回報更新播放意圖。
window.addEventListener(
  'play',
  (e) => {
    const v = leafVideo
    if (v && e.target === v && state.mode === 'video' && state.intent === 'pause') v.pause()
  },
  true
)

// ---------- 影片模式的樣式 ----------

const GLOBAL_CSS = `
html, body { overflow: hidden !important; background: #000 !important; }
html * { visibility: hidden !important; }
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
/** 上層元素有這些屬性時，position: fixed 會以它為基準而不是整個畫面，所以一併拿掉 */
const ANCESTOR_CSS: [string, string][] = [
  ['transform', 'none'],
  ['filter', 'none'],
  ['backdrop-filter', 'none'],
  ['perspective', 'none'],
  ['contain', 'none'],
  ['will-change', 'auto'],
  ['clip-path', 'none'],
  ['mask', 'none'],
  ['opacity', '1']
]

let globalStyle: HTMLStyleElement | null = null
/** 目前放大顯示的元素、放大前的位置，以及被改過 style 的元素原本的 style 屬性 */
let styled: { el: Target; rect: Rect; saved: [HTMLElement, string | null][] } | null = null

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function setStyles(el: HTMLElement, css: [string, string][], saved: [HTMLElement, string | null][]) {
  saved.push([el, el.getAttribute('style')])
  for (const [k, v] of css) el.style.setProperty(k, v, 'important')
}

function unstyle() {
  if (!styled) return
  for (const [el, attr] of styled.saved.reverse()) {
    if (attr === null) el.removeAttribute('style')
    else el.setAttribute('style', attr)
  }
  styled = null
}

function applyStyles() {
  const selected = onPath && state.mode === 'video'
  if (!selected) {
    unstyle()
    globalStyle?.remove()
    globalStyle = null
    return
  }
  // 還沒找到主要影片時整頁都是黑色（R13）
  if (!globalStyle && document.documentElement) {
    globalStyle = document.createElement('style')
    globalStyle.textContent = GLOBAL_CSS
  }
  if (globalStyle && !globalStyle.isConnected) document.documentElement.appendChild(globalStyle)

  if (styled && styled.el !== best?.el) unstyle()
  if (best && !styled) {
    const saved: [HTMLElement, string | null][] = []
    setStyles(best.el, CHOSEN_CSS, saved)
    for (let p = parentOf(best.el); p; p = parentOf(p))
      if (p instanceof HTMLElement) setStyles(p, ANCESTOR_CSS, saved)
    styled = { el: best.el, rect: best.rect, saved }
  }
}

// ---------- 回報 ----------

function videoStatus(v: HTMLVideoElement): WebVideoStatus {
  if (v.ended) return 'ended'
  if (v.paused) return 'paused'
  return v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ? 'loading' : 'playing'
}

/** 主要影片的狀態：影片在這個框架就直接讀，在子框架就用子框架回報的 */
function leafStatus(): WebVideoStatus | null {
  if (!best) return null
  if (best.el instanceof HTMLVideoElement) return videoStatus(best.el)
  return childReport(best.el)?.status ?? null
}

function report(vw: number, vh: number) {
  const status = leafStatus()
  if (isTop) {
    const r: WebReport = { found: best !== null, status, v: state.v }
    ipcRenderer.sendToHost('mv:report', r)
  } else {
    const r: ChildReport = { best: best?.rect ?? null, vw, vh, status, v: state.v }
    window.parent.postMessage({ [MARK]: 'report', ...r }, '*')
  }
}

// ---------- 框架之間的同步 ----------

function syncChild(el: HTMLIFrameElement) {
  el.contentWindow?.postMessage(
    { [MARK]: 'sync', onPath: onPath && best?.el === el, state },
    '*'
  )
}

/** 狀態改變時立刻往下傳，不等子框架下一次回報 */
function broadcast() {
  const targets: Target[] = []
  if (document.documentElement) collect(document, targets)
  targets.forEach((el) => el instanceof HTMLIFrameElement && children.has(el.contentWindow!) && syncChild(el))
}

function setState(next: WebState, nextOnPath: boolean) {
  const changed = next.v !== state.v || nextOnPath !== onPath
  state = next
  onPath = nextOnPath
  if (changed) {
    applyStyles()
    syncLeaf()
    if (leafVideo) applyControl(leafVideo)
    broadcast()
    scheduleScan()
  }
}

window.addEventListener('message', (e) => {
  const d = e.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || !(MARK in d)) return
  const source = e.source as Window | null
  if (d[MARK] === 'report' && source) {
    children.set(source, { report: d as unknown as ChildReport, at: Date.now() })
    // 回覆目前的狀態和是否在路徑上，新出現的子框架也能馬上拿到
    const frame = best?.el instanceof HTMLIFrameElement && best.el.contentWindow === source ? best.el : null
    source.postMessage({ [MARK]: 'sync', onPath: onPath && frame !== null, state }, '*')
    // 主要影片所在的子框架狀態改變時，馬上往上回報
    if (frame && (d.status as WebVideoStatus | null) !== lastForwarded) {
      lastForwarded = d.status as WebVideoStatus | null
      scheduleScan()
    }
  } else if (d[MARK] === 'sync' && !isTop && source === window.parent) {
    setState(d.state as WebState, d.onPath === true)
  }
})
let lastForwarded: WebVideoStatus | null = null

if (isTop) {
  ipcRenderer.on('mv:state', (_, next: WebState) => setState(next, true))
  // 網頁重新載入後狀態會遺失，向程式要一次
  ipcRenderer.sendToHost('mv:hello')
}

// 影片開始、暫停時盡快回報，不等下一次定時檢查
let scanTimer: ReturnType<typeof setTimeout> | undefined
function scheduleScan() {
  if (scanTimer) return
  scanTimer = setTimeout(() => {
    scanTimer = undefined
    scan()
  }, 50)
}
for (const type of ['play', 'pause', 'playing', 'waiting', 'ended', 'emptied', 'loadedmetadata'])
  window.addEventListener(type, scheduleScan, true)

setInterval(scan, SCAN_MS)
