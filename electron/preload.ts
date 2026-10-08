import { contextBridge, ipcRenderer } from 'electron'

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
  close: () => ipcRenderer.send('win:close')
}

export type MultiviewApi = typeof api

contextBridge.exposeInMainWorld('multiview', api)
