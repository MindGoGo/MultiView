import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, screen, session, shell, type Rectangle, type WebContents } from 'electron'
import { createSaver, loadSettings } from './store'
import { MIN_HEIGHT, MIN_WIDTH, resolveBounds } from './windowState'
import { startStaticServer } from './staticServer'
import { normalizeView, type Settings } from '../src/lib/settings'
import { guestKeyAction, isRepeatableKey, shortcutFor } from '../src/lib/shortcuts'
import { WEB_PARTITION, type WebMode } from '../src/players/webTypes'
import { forgetWebContents, installAdblock, loadAdblockList, setAdblockEnabled } from './adblock'
import { createListsSaver, loadLists } from './listsStore'
import { normalizeLists, type Lists } from '../src/lib/lists'
import { pageMenuItems, type PageMenuAction } from '../src/lib/pageMenu'
import {
  COMPANION_MIN_HEIGHT,
  COMPANION_MIN_WIDTH,
  companionOnTop,
  createMinimizeFollower,
  isCompanionTab,
  type CompanionAction,
  type CompanionLink,
  type CompanionTab
} from '../src/lib/companion'
import { extractStoryboardSpec } from '../src/lib/storyboard'
import { isVideoId } from '../src/lib/ytdlp'
import { installStreamCors, ytdlp } from './ytdlp'
import {
  channelFeedUrl,
  channelLiveUrl,
  channelLookupUrl,
  channelPageUrl,
  extractChannelInfo,
  isChannelId,
  parseFeed,
  parseLiveStatus
} from '../src/lib/youtubeFeed'

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
/** 畫面檔案的網址（開發時是開發伺服器，正式版是本機 http） */
let rendererUrl = ''
/** YouTube 小視窗（R78）：只有一個 */
let companion: BrowserWindow | null = null
/** 小視窗連結的格子與它目前的影片，由主畫面告知（R78） */
let companionLink: CompanionLink = { cell: null, video: null }
/** 和主視窗一起縮小、一起還原（R85） */
const companionFollower = createMinimizeFollower()

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

  win.on('ready-to-show', () => {
    win?.show()
    // yt-dlp 的自動更新與查詢最新版在視窗顯示後才在背景進行，不影響開啟速度（R92、R93）
    void ytdlp.afterStartup()
  })
  // move / resize 在程式移動視窗時也會觸發（moved / resized 不會）
  win.on('move', trackBounds)
  win.on('resize', trackBounds)
  win.on('enter-full-screen', sendWindowState)
  win.on('leave-full-screen', () => {
    fullscreenGuard = false
    sendWindowState()
  })
  win.on('always-on-top-changed', () => {
    sendWindowState()
    applyCompanionOnTop()
  })
  // 小視窗和主視窗一起縮小、一起還原（R85）
  win.on('minimize', () => {
    if (companion && companionFollower.mainMinimized(companion.isMinimized())) companion.minimize()
  })
  win.on('restore', () => {
    if (companion && companionFollower.mainRestored() && companion.isMinimized()) {
      companion.restore()
      win?.focus()
    }
  })
  // 小視窗置頂時，點主視窗（主視窗也置頂時）後小視窗仍在主視窗上面（R84）
  win.on('focus', raisePinnedCompanion)
  // 關閉前先向畫面要每一格最新的觀看進度，最多等 1 秒（R55 AC9）
  let closingAsked = false
  win.on('close', (event) => {
    if (!closingAsked && win) {
      closingAsked = true
      event.preventDefault()
      const done = () => {
        clearTimeout(timer)
        ipcMain.removeListener('app:closing-done', done)
        win?.close()
      }
      const timer = setTimeout(done, CLOSING_WAIT_MS)
      ipcMain.on('app:closing-done', done)
      win.webContents.send('app:closing')
      return
    }
    trackBounds()
    saver.flush()
    listsSaver.flush()
  })
  win.on('closed', () => {
    win = null
    // 小視窗不附屬主視窗，要自己關閉（R84 AC6）
    companion?.close()
  })

  // 焦點在 YouTube 播放器（iframe）裡時，按鍵不會傳到畫面，在這裡攔下來轉給畫面（R9 AC3）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (input.isAutoRepeat && !isRepeatableKey(input.key))) return
    const focused = win?.webContents.focusedFrame
    if (!focused || focused === win?.webContents.mainFrame) return
    if (!shortcutFor(input.key)) return
    event.preventDefault()
    win?.webContents.send('shortcut', input.key)
  })

  // 滑鼠的「上一頁」側鍵（Windows 的 app-command）：直接操作時游標在 YouTube 播放器裡也收得到（R63）
  win.on('app-command', (_, command) => {
    if (command === 'browser-backward') win?.webContents.send('shortcut', 'BrowserBack')
  })

  // YouTube 播放器會註冊 beforeunload，Electron 遇到時會默默取消關閉，這裡一律允許關閉（R1 AC6）
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault())

  // 程式內不開新視窗。YouTube 播放器裡的連結交給畫面決定：影片在同一格播放，其他用瀏覽器開啟（R45）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) win?.webContents.send('link:open', url)
    return { action: 'deny' }
  })

  secureWebviews(win.webContents)
  win.webContents.on('did-attach-webview', (_, guest) => attachWebGuest(guest))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  rendererUrl = devUrl ?? (await startStaticServer(path.join(__dirname, '../renderer')))
  installStreamCors(win.webContents.session, new URL(rendererUrl).origin)
  await win.loadURL(rendererUrl)
}

// 網頁來源一律在沙箱中執行，只載入我們的偵測程式（非功能需求：安全）；小視窗的網頁也一樣（R78）
function secureWebviews(contents: WebContents) {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
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
}

// ---- YouTube 小視窗（R78–R82） ----

/** 只記錄一般狀態下的位置與大小 */
function trackCompanionBounds() {
  if (!companion || companion.isMinimized() || companion.isMaximized() || companion.isFullScreen()) return
  const b = companion.getBounds()
  settings.companion = { ...settings.companion, x: b.x, y: b.y, width: b.width, height: b.height }
  saveSoon()
}

/** 開啟小視窗，已經開著時切到最前面；tab 為 null 時顯示上次的分頁 */
function openCompanion(tab: CompanionTab | null) {
  if (!win) return
  if (tab) {
    settings.companion = { ...settings.companion, tab }
    saveSoon()
  }
  if (companion) {
    if (tab) companion.webContents.send('companion:tab', tab)
    if (companion.isMinimized()) companion.restore()
    companion.show()
    companion.focus()
    return
  }
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const bounds = resolveBounds(settings.companion, displays, screen.getPrimaryDisplay().workArea, {
    width: COMPANION_MIN_WIDTH,
    height: COMPANION_MIN_HEIGHT
  })
  // 一般視窗：點主視窗時退到後面，縮小時收到工作列；需要時由使用者置頂（R84）
  companion = new BrowserWindow({
    ...bounds,
    title: 'YouTube 小視窗',
    minWidth: COMPANION_MIN_WIDTH,
    minHeight: COMPANION_MIN_HEIGHT,
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/companion.js'),
      sandbox: true,
      contextIsolation: true,
      webviewTag: true
    }
  })
  companion.setMenu(null)
  applyCompanionOnTop()
  companion.on('restore', () => companionFollower.companionRestored())
  companion.on('ready-to-show', () => companion?.show())
  companion.on('move', trackCompanionBounds)
  companion.on('resize', trackCompanionBounds)
  companion.on('closed', () => (companion = null))
  // 小視窗不開新視窗
  companion.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  secureWebviews(companion.webContents)
  companion.webContents.on('did-attach-webview', (_, guest) => {
    const id = guest.id
    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
    guest.once('destroyed', () => forgetWebContents(id))
  })
  void companion.loadURL(new URL('companion.html', rendererUrl).href)
}

/** 小視窗是否在其他程式上面（R84） */
function applyCompanionOnTop() {
  if (!companion) return
  const onTop = companionOnTop(settings.companion.pinned, win?.isAlwaysOnTop() ?? false)
  if (companion.isAlwaysOnTop() !== onTop) companion.setAlwaysOnTop(onTop)
  raisePinnedCompanion()
}

/**
 * 置頂的小視窗排回主視窗上面（R84）。主視窗取得焦點、切換置頂時，系統在事件之後才把主視窗排到前面，
 * 所以稍後再排
 */
const RAISE_DELAY_MS = 50
function raisePinnedCompanion() {
  setTimeout(() => {
    if (companion && settings.companion.pinned && !companion.isMinimized()) companion.moveTop()
  }, RAISE_DELAY_MS)
}

ipcMain.on('companion:open', (e, tab: unknown) => {
  if (e.sender === win?.webContents) openCompanion(isCompanionTab(tab) ? tab : null)
})
ipcMain.on('companion:link', (e, link: CompanionLink) => {
  if (e.sender !== win?.webContents) return
  companionLink = link
  companion?.webContents.send('companion:link', link)
})
ipcMain.handle('companion:init', () => ({
  tab: settings.companion.tab,
  link: companionLink,
  pinned: settings.companion.pinned
}))
// 小視窗的「置頂」按鈕（R84）：選擇保存在設定檔
ipcMain.handle('companion:togglePin', (e) => {
  if (e.sender !== companion?.webContents) return settings.companion.pinned
  settings.companion = { ...settings.companion, pinned: !settings.companion.pinned }
  saveSoon()
  applyCompanionOnTop()
  return settings.companion.pinned
})
ipcMain.on('companion:tab', (e, tab: unknown) => {
  if (e.sender !== companion?.webContents || !isCompanionTab(tab)) return
  settings.companion = { ...settings.companion, tab }
  saveSoon()
})
ipcMain.on('companion:action', (e, action: CompanionAction) => {
  if (e.sender === companion?.webContents) win?.webContents.send('companion:action', action)
})
// 小視窗放入影片需要選擇格子時，主視窗切到最前面（R82）
ipcMain.on('win:focus', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// 畫面這一側的設定（版型、比例、來源）（R10）
ipcMain.handle('settings:getView', () => ({
  layout: settings.layout,
  ratios: settings.ratios,
  slots: settings.slots,
  brightness: settings.brightness,
  autoYoutubeWeb: settings.autoYoutubeWeb,
  youtubeMethods: settings.youtubeMethods,
  webMethod: settings.webMethod,
  listTab: settings.listTab
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
// 設定選單顯示的版本號（R76）：和安裝檔、檔案內容的版本相同
ipcMain.handle('app:version', () => app.getVersion())

// yt-dlp 播放（R89–R93）：失敗時回傳原因，不把例外丟回畫面
ipcMain.handle('ytdlp:resolve', (_, videoId: unknown, refresh: unknown) =>
  isVideoId(videoId) ? ytdlp.resolve(videoId, refresh === true) : { ok: false, reason: 'failed' }
)
// 其他網站（R103）：只接受 http、https 的網址，交給 yt-dlp 前不經過命令列殼層
ipcMain.handle('ytdlp:resolveUrl', (_, url: unknown, refresh: unknown) =>
  typeof url === 'string' && url.length < 4096 && /^https?:///i.test(url)
    ? ytdlp.resolveUrl(url, refresh === true)
    : { ok: false, reason: 'failed' }
)
ipcMain.handle('ytdlp:update', () => ytdlp.update())
ipcMain.handle('ytdlp:status', () => ytdlp.getStatus())
ipcMain.on('ytdlp:check', () => void ytdlp.checkLatest())
ytdlp.onStatus((s) => win?.webContents.send('ytdlp:status', s))

// YouTube 預覽縮圖的資訊（R50）：從這部影片的 YouTube 網頁取出，每部影片只取得一次
const storyboardSpecs = new Map<string, Promise<string | null>>()
ipcMain.handle('youtube:storyboard', (_, videoId: unknown) => {
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  let p = storyboardSpecs.get(videoId)
  if (!p) {
    p = net
      .fetch(`https://www.youtube.com/watch?v=${videoId}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then(extractStoryboardSpec)
      .catch(() => null)
    storyboardSpecs.set(videoId, p)
  }
  return p
})

// YouTube 訂閱（R59）：只讀取公開的頻道網頁與頻道摘要，失敗時回傳 null
async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await net.fetch(url)
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}
ipcMain.handle('yt:channelInfo', async (_, input: unknown) => {
  const lookup = typeof input === 'string' ? channelLookupUrl(input) : null
  if (!lookup) return null
  const html = await fetchText(lookup.page)
  const info = html ? extractChannelInfo(html, lookup.kind) : null
  return info ? { ...info, url: channelPageUrl(info.id) } : null
})
ipcMain.handle('yt:feed', async (_, id: unknown) => {
  if (!isChannelId(id)) return null
  const xml = await fetchText(channelFeedUrl(id))
  return xml ? parseFeed(xml) : null
})
// 選擇 Google Takeout 的訂閱檔並讀取內容（R61）；取消或讀取失敗時為 null
ipcMain.handle('yt:pickTakeout', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, {
    title: '選擇 Google Takeout 匯出的 subscriptions.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  try {
    return await fs.promises.readFile(r.filePaths[0], 'utf8')
  } catch {
    return null
  }
})

// 正在直播的影片代碼（R60）；沒有直播或判斷不了時為 null
ipcMain.handle('yt:live', async (_, id: unknown) => {
  if (!isChannelId(id)) return null
  const html = await fetchText(channelLiveUrl(id))
  return html ? parseLiveStatus(html) : null
})

// 這部影片是不是正在直播（R81）：播放器還沒回報時（例如還沒播放過）由影片網頁判斷；判斷不了時為 false
ipcMain.handle('yt:videoLive', async (_, id: unknown) => {
  if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return false
  const html = await fetchText(`https://www.youtube.com/watch?v=${id}`)
  return html ? parseLiveStatus(html) === id : false
})

// 只有 http／https 網址交給系統瀏覽器（R45，非功能需求：安全）
ipcMain.on('link:external', (_, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
})

// 游標在拖曳區或 iframe 上時，網頁收不到滑鼠事件。
// 需要時由主程序定時回報游標位置（R3：工具列隱藏、直接操作模式結束）。
const CURSOR_POLL_MS = 150
/** 關閉前等畫面回報最新觀看進度的時間（R55） */
const CLOSING_WAIT_MS = 1000
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
    // 方向鍵按住時連續快轉、倒轉，網頁有焦點時也一樣（R51）
    if (input.type !== 'keyDown' || (input.isAutoRepeat && !isRepeatableKey(input.key))) return
    const action = guestKeyAction(input.key, webModes.get(id))
    // F11 也交給畫面處理：單格全螢幕時要先離開單格全螢幕（R20）
    if (action === 'fullscreen' || action === 'forward') {
      event.preventDefault()
      win?.webContents.send('shortcut', input.key)
    }
  })
  // 整頁模式的右鍵選單（R27）；影片模式（包括「直接操作」）不出現
  guest.on('context-menu', (_, params) => {
    if (webModes.get(id) !== 'page' || !win) return
    const nav = guest.navigationHistory
    const actions: Record<PageMenuAction, () => void> = {
      cut: () => guest.cut(),
      copy: () => guest.copy(),
      paste: () => guest.paste(),
      selectAll: () => guest.selectAll(),
      back: () => nav.goBack(),
      forward: () => nav.goForward(),
      reload: () => guest.reload(),
      copyLink: () => clipboard.writeText(params.linkURL)
    }
    const items = pageMenuItems({
      editFlags: params.editFlags,
      linkURL: params.linkURL,
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward()
    })
    Menu.buildFromTemplate(
      items.map((i) =>
        i.type === 'separator' ? { type: 'separator' as const } : { label: i.label, enabled: i.enabled, click: actions[i.action] }
      )
    ).popup({ window: win })
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
// 結束還在執行的 yt-dlp（R89）；更新途中被結束時 yt-dlp 還沒替換檔案，原本的不受影響
app.on('before-quit', () => ytdlp.killAll())
