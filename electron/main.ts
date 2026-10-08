import path from 'node:path'
import { app, BrowserWindow, ipcMain, screen, session, type Rectangle } from 'electron'
import { createSaver, loadSettings } from './store'
import { MIN_HEIGHT, MIN_WIDTH, resolveBounds } from './windowState'
import { startStaticServer } from './staticServer'
import { normalizeView, type Settings } from '../src/lib/settings'
import { guestKeyAction, shortcutFor } from '../src/lib/shortcuts'
import { WEB_PARTITION, type WebMode } from '../src/players/webTypes'
import { forgetWebContents, installAdblock, loadAdblockList, setAdblockEnabled } from './adblock'
import { createListsSaver, loadLists } from './listsStore'
import { normalizeLists, type Lists } from '../src/lib/lists'

// 測試時用獨立的資料夾，不動到正式的設定檔
if (process.env['MULTIVIEW_USER_DATA']) app.setPath('userData', process.env['MULTIVIEW_USER_DATA'])

// 多格同時自動播放（含有聲音的格子）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 拿掉 User-Agent 中的 Electron 字樣，避免網站提供降級版本
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|multiview)\/\S+/gi, '')

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
/** 最愛與歷史清單，和設定檔分開（R21） */
const listsFile = () => path.join(app.getPath('userData'), 'lists.json')

let win: BrowserWindow | null = null
let settings: Settings
let saver: ReturnType<typeof createSaver>
let lists: Lists
let listsSaver: ReturnType<typeof createListsSaver>

function saveSoon() {
  saver.schedule(settings)
}

function sendWindowState() {
  win?.webContents.send('win:state', {
    fullscreen: win.isFullScreen(),
    alwaysOnTop: win.isAlwaysOnTop()
  })
}

/** 進入全螢幕的過程中也會觸發 resize，用這個旗標避免記到全螢幕的大小 */
let fullscreenGuard = false
/** 開啟時還原的位置；高 DPI 下實際大小會有 1–2px 的捨入誤差，不能把誤差存回去，否則每次開啟都會變大 */
let restoredBounds: Rectangle | null = null
const ROUNDING_TOLERANCE_PX = 2

/**
 * 只記錄一般狀態下的位置，全螢幕、最小化、最大化時不記錄（R1 AC4）。
 * 用內容區的大小：無邊框視窗在 Windows 高 DPI 下，用整個視窗大小還原會一次比一次大。
 */
function trackBounds() {
  if (!win || fullscreenGuard || win.isFullScreen() || win.isMinimized() || win.isMaximized())
    return
  const b = win.getContentBounds()
  const r = restoredBounds
  if (
    r &&
    b.x === r.x &&
    b.y === r.y &&
    Math.abs(b.width - r.width) <= ROUNDING_TOLERANCE_PX &&
    Math.abs(b.height - r.height) <= ROUNDING_TOLERANCE_PX
  )
    return
  restoredBounds = null
  settings.window = { ...settings.window, x: b.x, y: b.y, width: b.width, height: b.height }
  saveSoon()
}

async function createWindow() {
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const bounds = resolveBounds(settings.window, displays, screen.getPrimaryDisplay().workArea)

  win = new BrowserWindow({
    ...bounds,
    useContentSize: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: settings.window.alwaysOnTop,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // 網頁來源用 <webview> 顯示（R13）
      webviewTag: true
    }
  })

  // 無邊框視窗在 Windows 高 DPI 下，建構時給的大小不準，建立後再校正一次
  win.setContentBounds(bounds)
  restoredBounds = bounds

  win.on('ready-to-show', () => win?.show())
  // move / resize 在程式移動視窗時也會觸發（moved / resized 不會）
  win.on('move', trackBounds)
  win.on('resize', trackBounds)
  win.on('enter-full-screen', sendWindowState)
  win.on('leave-full-screen', () => {
    fullscreenGuard = false
    sendWindowState()
  })
  win.on('always-on-top-changed', sendWindowState)
  win.on('close', () => {
    trackBounds()
    saver.flush()
    listsSaver.flush()
  })
  win.on('closed', () => (win = null))

  // 焦點在 YouTube 播放器（iframe）裡時，按鍵不會傳到畫面，在這裡攔下來轉給畫面（R9 AC3）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const focused = win?.webContents.focusedFrame
    if (!focused || focused === win?.webContents.mainFrame) return
    if (!shortcutFor(input.key)) return
    event.preventDefault()
    win?.webContents.send('shortcut', input.key)
  })

  // YouTube 播放器會註冊 beforeunload，Electron 遇到時會默默取消關閉，這裡一律允許關閉（R1 AC6）
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault())

  // 不讓網頁開新視窗（例如點到 YouTube 標誌）
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 網頁來源一律在沙箱中執行，只載入我們的偵測程式（非功能需求：安全）
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // 先以空白頁建立，設定好廣告阻擋後才載入使用者的網址（R17）
    if (params.partition !== WEB_PARTITION || (params.src !== 'about:blank' && !/^https?:/i.test(params.src))) {
      event.preventDefault()
      return
    }
    delete (webPreferences as { preloadURL?: string }).preloadURL
    webPreferences.preload = path.join(__dirname, '../preload/web.js')
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // 偵測程式也要注入子框架，主要影片可能在別家網站的播放器裡（R13）
    webPreferences.nodeIntegrationInSubFrames = true
  })
  win.webContents.on('did-attach-webview', (_, guest) => attachWebGuest(guest))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const url = devUrl ?? (await startStaticServer(path.join(__dirname, '../renderer')))
  await win.loadURL(url)
}

// 畫面這一側的設定（版型、比例、來源）（R10）
ipcMain.handle('settings:getView', () => ({
  layout: settings.layout,
  ratios: settings.ratios,
  slots: settings.slots
}))
ipcMain.on('settings:saveView', (_, view: unknown) => {
  settings = { ...settings, ...normalizeView(view) }
  saveSoon()
})

// 最愛與歷史清單（R21–R23）
ipcMain.handle('lists:get', () => lists)
ipcMain.on('lists:save', (_, next: unknown) => {
  lists = normalizeLists(next)
  listsSaver.schedule(lists)
})

ipcMain.handle('win:getState', () => ({
  fullscreen: win?.isFullScreen() ?? false,
  alwaysOnTop: win?.isAlwaysOnTop() ?? false
}))
function enterFullscreen() {
  if (!win || win.isFullScreen()) return
  // 先記下進入全螢幕前的位置，關閉時還原用（R1 AC4）
  trackBounds()
  fullscreenGuard = true
  win.setFullScreen(true)
}
function toggleFullscreen() {
  if (win?.isFullScreen()) win.setFullScreen(false)
  else enterFullscreen()
}
ipcMain.on('win:toggleFullscreen', toggleFullscreen)
ipcMain.on('win:exitFullscreen', () => {
  if (win?.isFullScreen()) win.setFullScreen(false)
})
ipcMain.on('win:toggleAlwaysOnTop', () => {
  if (!win) return
  win.setAlwaysOnTop(!win.isAlwaysOnTop())
  settings.window = { ...settings.window, alwaysOnTop: win.isAlwaysOnTop() }
  saveSoon()
})
ipcMain.on('win:minimize', () => win?.minimize())

// 游標在拖曳區或 iframe 上時，網頁收不到滑鼠事件。
// 需要時由主程序定時回報游標位置（R3：工具列隱藏、直接操作模式結束）。
const CURSOR_POLL_MS = 150
let cursorTimer: ReturnType<typeof setInterval> | null = null
ipcMain.on('cursor:watch', (_, on: boolean) => {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = null
  if (!on) return
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && y >= 0 && x < b.width && y < b.height
    win.webContents.send('cursor:pos', { x, y, inside })
  }, CURSOR_POLL_MS)
})
ipcMain.on('win:close', () => win?.close())

// ---- 網頁來源（R13、R14） ----

/** 每個網頁的顯示模式，由畫面告知；用來決定焦點在網頁裡時按鍵給誰 */
const webModes = new Map<number, WebMode>()
ipcMain.on('web:mode', (_, id: number, mode: WebMode) => webModes.set(id, mode))
// 網頁載入使用者的網址前，先設定這一格的廣告阻擋（R17）
ipcMain.handle('web:init', (_, id: number, opts: { adblock: boolean }) => setAdblockEnabled(id, opts.adblock))

function attachWebGuest(guest: Electron.WebContents) {
  const id = guest.id
  // 網頁要開新視窗一律擋下（R14 AC3）
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  guest.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const action = guestKeyAction(input.key, webModes.get(id))
    // F11 也交給畫面處理：單格全螢幕時要先離開單格全螢幕（R20）
    if (action === 'fullscreen' || action === 'forward') {
      event.preventDefault()
      win?.webContents.send('shortcut', input.key)
    }
  })
  guest.once('destroyed', () => {
    webModes.delete(id)
    forgetWebContents(id)
  })
}

app.whenReady().then(() => {
  settings = loadSettings(settingsFile())
  saver = createSaver(settingsFile())
  lists = loadLists(listsFile())
  listsSaver = createListsSaver(listsFile())
  loadAdblockList()
  installAdblock(session.fromPartition(WEB_PARTITION))
  void createWindow()
})

app.on('window-all-closed', () => app.quit())
