// Android 版注入網頁的程式用來取代 Electron 的 ipcRenderer（規格 android-app R157），對照 ios/web/electron-shim.ts。
// 桌面版的 electron/webPreload.ts 原封不動地重用：編譯時把 `import { ipcRenderer } from 'electron'` 換成這個檔案。
// App 用 addJavascriptInterface 提供 window.MultiViewAndroid（每一個框架都有）：
// - sendToHost / send：MultiViewAndroid.post(JSON)，只有最上層框架送（子框架由 webPreload 用 postMessage 轉給上層）
// - on：App 用 window.__multiViewReceive(channel, value) 送進來（只有最上層框架）
// - invoke('adblock:cosmetics')：MultiViewAndroid.cosmetics(網域) 回傳這個網域要隱藏的元素的 CSS（每個框架只要一次）
// 另外處理兩件 Android WebView 做不到的事：
// - 靜音：WebView 不能把整個網頁靜音，所以每個框架定時把影片、聲音元素設成靜音
// - 寬版面：找影片的期間把 viewport 改成 1280 寬，網站才不會用手機的窄版面（影片常常排在畫面外面）

type Listener = (event: unknown, ...args: unknown[]) => void

interface Bridge {
  post(message: string): void
  cosmetics(host: string): string
  muted(): boolean
  wide(): boolean
}

interface AndroidWindow {
  MultiViewAndroid?: Bridge
  __multiViewReceive?: (channel: string, value: unknown) => void
  __multiViewViewport?: (wide: boolean) => void
}

const host = window as unknown as AndroidWindow
const bridge = host.MultiViewAndroid
const isTop = window === window.top
const listeners = new Map<string, Listener[]>()

function post(channel: string, args: unknown[]) {
  if (!isTop) return
  try {
    bridge?.post(JSON.stringify({ channel, args }))
  } catch {
    // App 沒有提供訊息通道時不做事
  }
}

let cosmeticsDone = false

export const ipcRenderer = {
  sendToHost(channel: string, ...args: unknown[]) {
    post(channel, args)
  },
  send(channel: string, ...args: unknown[]) {
    post(channel, args)
  },
  on(channel: string, listener: Listener) {
    const list = listeners.get(channel) ?? []
    list.push(listener)
    listeners.set(channel, list)
  },
  invoke(channel: string): Promise<string> {
    // 元素隱藏規則只看網域，每個框架要一次就夠了
    if (channel !== 'adblock:cosmetics' || cosmeticsDone) return Promise.resolve('')
    cosmeticsDone = true
    try {
      return Promise.resolve(bridge?.cosmetics(location.hostname) ?? '')
    } catch {
      return Promise.resolve('')
    }
  }
}

if (isTop) {
  host.__multiViewReceive = (channel, value) => {
    listeners.get(channel)?.forEach((listener) => listener({}, value))
  }
}

// ---------- 靜音 ----------
// 被這裡設成靜音的元素；取消靜音時只還原這些（網站自己靜音的不動）
const mutedByApp = new WeakSet<HTMLMediaElement>()
const mutedList: HTMLMediaElement[] = []

function applyMuted() {
  let muted = false
  try {
    muted = bridge?.muted() ?? false
  } catch {
    return
  }
  if (muted) {
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
      if (!el.muted) {
        el.muted = true
        if (!mutedByApp.has(el)) {
          mutedByApp.add(el)
          mutedList.push(el)
        }
      }
    })
  } else if (mutedList.length) {
    for (const el of mutedList.splice(0)) {
      mutedByApp.delete(el)
      el.muted = false
    }
  }
}
if (bridge) {
  setInterval(applyMuted, 500)
  // 新的影片開始播放時馬上套用，不等下一次定時檢查
  document.addEventListener('play', applyMuted, true)
}

// ---------- 寬版面（只有最上層框架） ----------
const WIDE_VIEWPORT = 'width=1280'
let wide = false
let originalViewport: string | null = null
let viewportObserver: MutationObserver | null = null

function viewportMeta(create: boolean): HTMLMetaElement | null {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta && create && document.head) {
    meta = document.createElement('meta')
    meta.name = 'viewport'
    document.head.appendChild(meta)
  }
  return meta
}

function applyViewport() {
  const meta = viewportMeta(wide)
  if (!meta) return
  if (wide) {
    if (meta.content !== WIDE_VIEWPORT) {
      // 網站原本的設定留著，找到影片後還原
      originalViewport = meta.content || 'width=device-width, initial-scale=1'
      meta.content = WIDE_VIEWPORT
    }
  } else if (originalViewport !== null && meta.content === WIDE_VIEWPORT) {
    meta.content = originalViewport
    originalViewport = null
  }
}

if (isTop && bridge) {
  host.__multiViewViewport = (next: boolean) => {
    wide = next
    applyViewport()
    if (wide && !viewportObserver && document.documentElement) {
      // 網頁還在載入：<head> 之後才出現，或網站自己又改了 viewport
      viewportObserver = new MutationObserver(applyViewport)
      viewportObserver.observe(document.documentElement, { childList: true, subtree: true })
    } else if (!wide && viewportObserver) {
      viewportObserver.disconnect()
      viewportObserver = null
    }
  }
  try {
    if (bridge.wide()) host.__multiViewViewport(true)
  } catch {
    // 沒有這個功能時照原本的版面
  }
}

// Element.checkVisibility：比較舊的 WebView 沒有。用樣式判斷：自己或上層 display: none、
// 自己 visibility: hidden、自己或上層不透明度是 0 都算看不見。
interface VisibilityOptions {
  checkOpacity?: boolean
  opacityProperty?: boolean
  checkVisibilityCSS?: boolean
  visibilityProperty?: boolean
}
const proto = Element.prototype as Element & { checkVisibility?: (options?: VisibilityOptions) => boolean }
if (typeof proto.checkVisibility !== 'function') {
  proto.checkVisibility = function (this: Element, options: VisibilityOptions = {}) {
    const view = this.ownerDocument.defaultView
    if (!view || !this.isConnected) return false
    const own = view.getComputedStyle(this)
    if ((options.checkVisibilityCSS || options.visibilityProperty) && own.visibility !== 'visible') return false
    for (let el: Element | null = this; el; el = el.parentElement) {
      const style = view.getComputedStyle(el)
      if (style.display === 'none') return false
      if ((options.checkOpacity || options.opacityProperty) && style.opacity === '0') return false
    }
    return true
  }
}
