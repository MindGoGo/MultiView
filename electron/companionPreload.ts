// YouTube 小視窗（R78）的畫面可以使用的功能：只有固定的訊息（非功能需求：安全）
import { contextBridge, ipcRenderer } from 'electron'
import type { LoginFailure } from '../src/lib/googleLogin'
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
  getInit: (): Promise<{ tab: CompanionTab; link: CompanionLink; pinned: boolean }> => ipcRenderer.invoke('companion:init'),
  /** 切換置頂，回傳切換後的狀態（R84） */
  togglePin: (): Promise<boolean> => ipcRenderer.invoke('companion:togglePin'),
  /** 從格子的選單再次開啟時切換分頁 */
  onTab: (cb: (tab: CompanionTab) => void) => listen('companion:tab', cb),
  /** 連結的格子或它的影片改變 */
  onLink: (cb: (link: CompanionLink) => void) => listen('companion:link', cb),
  /** 記住上次的分頁 */
  saveTab: (tab: CompanionTab) => ipcRenderer.send('companion:tab', tab),
  /** 交給主畫面的操作（R79、R80、R82） */
  action: (action: CompanionAction) => ipcRenderer.send('companion:action', action),
  /** Google 帳號（R165）：有沒有登入、用 Edge 登入（成功回傳 true，失敗回傳原因）、登出 */
  googleStatus: (): Promise<boolean> => ipcRenderer.invoke('google:status'),
  googleLogin: (): Promise<true | LoginFailure> => ipcRenderer.invoke('google:login'),
  googleLogout: (): Promise<void> => ipcRenderer.invoke('google:logout'),
  onAccount: (cb: (loggedIn: boolean) => void) => listen('companion:account', cb),
  /** 網頁載入網址前設定廣告阻擋（R17、R78） */
  initWeb: (webContentsId: number, opts: { adblock: boolean }): Promise<void> =>
    ipcRenderer.invoke('web:init', webContentsId, opts)
}

export type CompanionApi = typeof api

contextBridge.exposeInMainWorld('companion', api)
