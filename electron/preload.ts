import { contextBridge, ipcRenderer } from 'electron'
import type { ViewSettings } from '../src/lib/settings'
import type { WebMode } from '../src/players/webTypes'

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
  /** 告知主程序網頁來源的顯示模式（R14） */
  setWebMode: (webContentsId: number, mode: WebMode) => ipcRenderer.send('web:mode', webContentsId, mode),
  /** 網頁載入使用者的網址前，設定這一格的廣告阻擋（R17） */
  initWeb: (webContentsId: number, opts: { adblock: boolean }): Promise<void> =>
    ipcRenderer.invoke('web:init', webContentsId, opts)
}

export type MultiviewApi = typeof api

contextBridge.exposeInMainWorld('multiview', api)
