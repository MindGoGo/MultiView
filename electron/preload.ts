import { contextBridge, ipcRenderer } from 'electron'
import type { ViewSettings } from '../src/lib/settings'
import type { WebMode } from '../src/players/webTypes'
import type { Lists } from '../src/lib/lists'

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
  /** 用系統預設的瀏覽器開啟（R45） */
  openExternal: (url: string) => ipcRenderer.send('link:external', url),
  /** 告知主程序網頁來源的顯示模式（R14） */
  setWebMode: (webContentsId: number, mode: WebMode) => ipcRenderer.send('web:mode', webContentsId, mode),
  /** 網頁載入使用者的網址前，設定這一格的廣告阻擋（R17） */
  initWeb: (webContentsId: number, opts: { adblock: boolean }): Promise<void> =>
    ipcRenderer.invoke('web:init', webContentsId, opts),
  /** 最愛與歷史清單（R21） */
  getLists: (): Promise<Lists> => ipcRenderer.invoke('lists:get'),
  saveLists: (lists: Lists) => ipcRenderer.send('lists:save', lists)
}

export type MultiviewApi = typeof api

contextBridge.exposeInMainWorld('multiview', api)
