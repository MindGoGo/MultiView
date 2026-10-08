import path from 'node:path'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { createSaver, loadSettings } from './store'
import { MIN_HEIGHT, MIN_WIDTH, resolveBounds } from './windowState'
import { startStaticServer } from './staticServer'
import type { Settings } from '../src/lib/settings'

// 測試時用獨立的資料夾，不動到正式的設定檔
if (process.env['MULTIVIEW_USER_DATA']) app.setPath('userData', process.env['MULTIVIEW_USER_DATA'])

// 多格同時自動播放（含有聲音的格子）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 拿掉 User-Agent 中的 Electron 字樣，避免網站提供降級版本
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|multiview)\/\S+/gi, '')

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

let win: BrowserWindow | null = null
let settings: Settings
let saver: ReturnType<typeof createSaver>

function saveSoon() {
  saver.schedule(settings)
}

function sendWindowState() {
  win?.webContents.send('win:state', {
    fullscreen: win.isFullScreen(),
    alwaysOnTop: win.isAlwaysOnTop()
  })
}

/** 只記錄一般狀態下的位置，全螢幕、最小化、最大化時不記錄（R1 AC4）。 */
function trackBounds() {
  if (!win || win.isFullScreen() || win.isMinimized() || win.isMaximized()) return
  const b = win.getBounds()
  settings.window = { ...settings.window, x: b.x, y: b.y, width: b.width, height: b.height }
  saveSoon()
}

async function createWindow() {
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  const bounds = resolveBounds(settings.window, displays, screen.getPrimaryDisplay().workArea)

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: settings.window.alwaysOnTop,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('moved', trackBounds)
  win.on('resized', trackBounds)
  win.on('enter-full-screen', sendWindowState)
  win.on('leave-full-screen', sendWindowState)
  win.on('always-on-top-changed', sendWindowState)
  win.on('close', () => saver.flush())
  win.on('closed', () => (win = null))

  // 不讓網頁開新視窗（例如點到 YouTube 標誌）
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const url = devUrl ?? (await startStaticServer(path.join(__dirname, '../renderer')))
  await win.loadURL(url)
}

ipcMain.handle('win:getState', () => ({
  fullscreen: win?.isFullScreen() ?? false,
  alwaysOnTop: win?.isAlwaysOnTop() ?? false
}))
ipcMain.on('win:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()))
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
ipcMain.on('win:close', () => win?.close())

app.whenReady().then(() => {
  settings = loadSettings(settingsFile())
  saver = createSaver(settingsFile())
  void createWindow()
})

app.on('window-all-closed', () => app.quit())
