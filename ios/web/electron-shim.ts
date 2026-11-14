// iOS 版注入網頁的程式用來取代 Electron 的 ipcRenderer（規格 ios-app R137）。
// 桌面版的 electron/webPreload.ts 原封不動地重用：編譯時把 `import { ipcRenderer } from 'electron'` 換成這個檔案。
// - sendToHost / send：交給 App（WKScriptMessageHandler，名稱是 multiview）
// - on：App 用 window.__multiViewReceive(channel, value) 送進來（只有最上層框架）
// - invoke：只用在桌面版的廣告元素隱藏；iOS 版改用 WebKit 的內容阻擋規則，所以回傳空字串

type Listener = (event: unknown, ...args: unknown[]) => void

interface WebKitWindow {
  webkit?: { messageHandlers?: { multiview?: { postMessage(message: unknown): void } } }
  __multiViewReceive?: (channel: string, value: unknown) => void
}

const listeners = new Map<string, Listener[]>()

function post(channel: string, args: unknown[]) {
  try {
    // 先轉成純資料：postMessage 不能傳函式等物件
    const message = JSON.parse(JSON.stringify({ channel, args }))
    ;(window as unknown as WebKitWindow).webkit?.messageHandlers?.multiview?.postMessage(message)
  } catch {
    // App 沒有提供訊息通道（例如網頁被其他方式開啟）時不做事
  }
}

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
  invoke(): Promise<string> {
    return Promise.resolve('')
  }
}

if (window === window.top) {
  ;(window as unknown as WebKitWindow).__multiViewReceive = (channel, value) => {
    listeners.get(channel)?.forEach((listener) => listener({}, value))
  }
}

// Element.checkVisibility：Safari 17.4 才有。舊版用樣式判斷：自己或上層 display: none、
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
