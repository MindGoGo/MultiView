import { contextBridge, ipcRenderer } from 'electron'
import type { ViewSettings } from '../src/lib/settings'
import type { WebMode } from '../src/players/webTypes'
import type { Lists } from '../src/lib/lists'
import type { FeedVideo } from '../src/lib/youtubeFeed'
import type { CompanionAction, CompanionLink, CompanionTab } from '../src/lib/companion'
import type { ResolveResult, UpdateOutcome, YtDlpStatus } from '../src/lib/ytdlp'

export interface CursorPos {
  x: number
  y: number
  inside: boolean
}

export interface WinState {
  fullscreen: boolean
  alwaysOnTop: boolean
}

const api = {
  getView: (): Promise<ViewSettings> => ipcRenderer.invoke('settings:getView'),
  saveView: (view: ViewSettings) => ipcRenderer.send('settings:saveView', view),
  getWindowState: (): Promise<WinState> => ipcRenderer.invoke('win:getState'),
  onWindowState: (cb: (state: WinState) => void) => {
    const listener = (_: unknown, state: WinState) => cb(state)
    ipcRenderer.on('win:state', listener)
    return () => {
      ipcRenderer.removeListener('win:state', listener)
    }
  },
  toggleFullscreen: () => ipcRenderer.send('win:toggleFullscreen'),
  exitFullscreen: () => ipcRenderer.send('win:exitFullscreen'),
  toggleAlwaysOnTop: () => ipcRenderer.send('win:toggleAlwaysOnTop'),
  minimize: () => ipcRenderer.send('win:minimize'),
  watchCursor: (on: boolean) => ipcRenderer.send('cursor:watch', on),
  onShortcut: (cb: (key: string) => void) => {
    const listener = (_: unknown, key: string) => cb(key)
    ipcRenderer.on('shortcut', listener)
    return () => {
      ipcRenderer.removeListener('shortcut', listener)
    }
  },
  onCursor: (cb: (pos: CursorPos) => void) => {
    const listener = (_: unknown, pos: CursorPos) => cb(pos)
    ipcRenderer.on('cursor:pos', listener)
    return () => {
      ipcRenderer.removeListener('cursor:pos', listener)
    }
  },
  close: () => ipcRenderer.send('win:close'),
  /** 程式的版本號（R76） */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** 程式要關閉時通知（R55）：送出最新的設定後呼叫 closingDone */
  onClosing: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('app:closing', listener)
    return () => {
      ipcRenderer.removeListener('app:closing', listener)
    }
  },
  closingDone: () => ipcRenderer.send('app:closing-done'),
  /** YouTube 播放器裡要開新視窗的連結（R45） */
  onLink: (cb: (url: string) => void) => {
    const listener = (_: unknown, url: string) => cb(url)
    ipcRenderer.on('link:open', listener)
    return () => {
      ipcRenderer.removeListener('link:open', listener)
    }
  },
  /** YouTube 預覽縮圖的資訊；取不到時為 null（R50） */
  getStoryboard: (videoId: string): Promise<string | null> => ipcRenderer.invoke('youtube:storyboard', videoId),
  /** 用 yt-dlp 解析 YouTube（R89）；refresh 為 true 時不用快取 */
  ytdlpResolve: (videoId: string, refresh = false): Promise<ResolveResult> =>
    ipcRenderer.invoke('ytdlp:resolve', videoId, refresh),
  /** 用 yt-dlp 解析其他網站的網址（R103） */
  ytdlpResolveUrl: (url: string, refresh = false): Promise<ResolveResult> => ipcRenderer.invoke('ytdlp:resolveUrl', url, refresh),
  /** 更新 yt-dlp（R93）；和自動更新同時發生時共用同一次 */
  ytdlpUpdate: (): Promise<{ result: UpdateOutcome; version: string | null }> => ipcRenderer.invoke('ytdlp:update'),
  /** 設定選單的 yt-dlp 狀態（R93） */
  ytdlpStatus: (): Promise<YtDlpStatus> => ipcRenderer.invoke('ytdlp:status'),
  /** 打開設定選單時查詢最新版（1 小時內查過就不查，R93） */
  ytdlpCheck: () => ipcRenderer.send('ytdlp:check'),
  onYtdlpStatus: (cb: (s: YtDlpStatus) => void) => {
    const listener = (_: unknown, s: YtDlpStatus) => cb(s)
    ipcRenderer.on('ytdlp:status', listener)
    return () => {
      ipcRenderer.removeListener('ytdlp:status', listener)
    }
  },
  /** YouTube 訂閱（R59）：由網址取得頻道代碼與名稱、讀取頻道的最新影片；失敗時為 null */
  ytChannelInfo: (input: string): Promise<{ id: string; name: string; url: string } | null> =>
    ipcRenderer.invoke('yt:channelInfo', input),
  ytFeed: (id: string): Promise<FeedVideo[] | null> => ipcRenderer.invoke('yt:feed', id),
  /** 選擇並讀取 Google Takeout 的訂閱檔（R61）；取消時為 null */
  pickTakeout: (): Promise<string | null> => ipcRenderer.invoke('yt:pickTakeout'),
  /** 正在直播的影片代碼（R60）；沒有直播或判斷不了時為 null */
  ytLive: (id: string): Promise<string | null> => ipcRenderer.invoke('yt:live', id),
  /** 這部影片是不是正在直播（R81）；判斷不了時為 false */
  ytVideoLive: (videoId: string): Promise<boolean> => ipcRenderer.invoke('yt:videoLive', videoId),
  /** 用系統預設的瀏覽器開啟（R45） */
  openExternal: (url: string) => ipcRenderer.send('link:external', url),
  /** 告知主程序網頁來源的顯示模式（R14） */
  setWebMode: (webContentsId: number, mode: WebMode) => ipcRenderer.send('web:mode', webContentsId, mode),
  /** 網頁載入使用者的網址前，設定這一格的廣告阻擋（R17） */
  initWeb: (webContentsId: number, opts: { adblock: boolean }): Promise<void> =>
    ipcRenderer.invoke('web:init', webContentsId, opts),
  /** 最愛與歷史清單（R21） */
  getLists: (): Promise<Lists> => ipcRenderer.invoke('lists:get'),
  saveLists: (lists: Lists) => ipcRenderer.send('lists:save', lists),
  /** 開啟 YouTube 小視窗（R78）；tab 為 null 時顯示上次的分頁 */
  openCompanion: (tab: CompanionTab | null) => ipcRenderer.send('companion:open', tab),
  /** 告知小視窗連結的格子與它目前的影片（R78） */
  sendCompanionLink: (link: CompanionLink) => ipcRenderer.send('companion:link', link),
  /** 小視窗交給主畫面的操作（R79、R80、R82） */
  onCompanionAction: (cb: (action: CompanionAction) => void) => {
    const listener = (_: unknown, action: CompanionAction) => cb(action)
    ipcRenderer.on('companion:action', listener)
    return () => {
      ipcRenderer.removeListener('companion:action', listener)
    }
  },
  /** 主視窗切到最前面（R82） */
  focusWindow: () => ipcRenderer.send('win:focus')
}

export type MultiviewApi = typeof api

contextBridge.exposeInMainWorld('multiview', api)
