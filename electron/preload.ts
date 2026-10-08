import { contextBridge, ipcRenderer } from 'electron'

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
  close: () => ipcRenderer.send('win:close')
}

export type MultiviewApi = typeof api

contextBridge.exposeInMainWorld('multiview', api)
