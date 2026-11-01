// YouTube 小視窗（R78）的畫面可以使用的功能：只有固定的訊息（非功能需求：安全）
import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionAction, CompanionLink, CompanionTab } from '../src/lib/companion'

function listen<T>(channel: string, cb: (value: T) => void) {
  const listener = (_: unknown, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  /** 開啟時的分頁與連結的格子 */
  getInit: (): Promise<{ tab: CompanionTab; link: CompanionLink }> => ipcRenderer.invoke('companion:init'),
  /** 從格子的選單再次開啟時切換分頁 */
  onTab: (cb: (tab: CompanionTab) => void) => listen('companion:tab', cb),
  /** 連結的格子或它的影片改變 */
  onLink: (cb: (link: CompanionLink) => void) => listen('companion:link', cb),
  /** 記住上次的分頁 */
  saveTab: (tab: CompanionTab) => ipcRenderer.send('companion:tab', tab),
  /** 交給主畫面的操作（R79、R80、R82） */
  action: (action: CompanionAction) => ipcRenderer.send('companion:action', action),
  /** 網頁載入網址前設定廣告阻擋（R17、R78） */
  initWeb: (webContentsId: number, opts: { adblock: boolean }): Promise<void> =>
    ipcRenderer.invoke('web:init', webContentsId, opts)
}

export type CompanionApi = typeof api

contextBridge.exposeInMainWorld('companion', api)
