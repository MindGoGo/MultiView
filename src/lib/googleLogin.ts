// 用外部瀏覽器登入 Google（R165）的規則：找瀏覽器、判斷登入完成、把瀏覽器的 cookie 轉成程式的 cookie。
// 不依賴 Electron 與 Node，方便測試；連線與啟動瀏覽器在 electron/googleLogin.ts。

/** 開啟的登入頁：登入後回到 YouTube，YouTube 的 cookie 也會設好 */
export const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F')

/** 等使用者登入最多多久（毫秒） */
export const LOGIN_TIMEOUT_MS = 15 * 60_000

/** 登入用的瀏覽器：都是 Chromium 核心，支援偵錯連線（Chrome DevTools Protocol） */
export const LOGIN_BROWSERS = [
  { id: 'edge', label: 'Microsoft Edge', short: 'Edge', path: 'Microsoft\\Edge\\Application\\msedge.exe' },
  { id: 'chrome', label: 'Google Chrome', short: 'Chrome', path: 'Google\\Chrome\\Application\\chrome.exe' },
  { id: 'brave', label: 'Brave', short: 'Brave', path: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' }
] as const

export type LoginBrowser = (typeof LOGIN_BROWSERS)[number]['id']

/** 預設用 Edge（Windows 10、11 內建） */
export const DEFAULT_LOGIN_BROWSER: LoginBrowser = 'edge'

export const normalizeLoginBrowser = (raw: unknown): LoginBrowser =>
  LOGIN_BROWSERS.some((b) => b.id === raw) ? (raw as LoginBrowser) : DEFAULT_LOGIN_BROWSER

export const loginBrowserInfo = (id: LoginBrowser) => LOGIN_BROWSERS.find((b) => b.id === id)!

/**
 * 這個瀏覽器可能的安裝位置：所有使用者（Program Files、Program Files (x86)）、只有自己（LOCALAPPDATA）。
 * env 是環境變數。
 */
export function browserPaths(id: LoginBrowser, env: Record<string, string | undefined>): string[] {
  const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter((r): r is string => !!r)
  return roots.map((r) => `${r}\\${loginBrowserInfo(id).path}`)
}

/**
 * 實際要用的瀏覽器：選的那個有安裝就用它，沒有時依 Edge、Chrome、Brave 的順序用有安裝的；都沒有時是 null。
 * installed 是有安裝的瀏覽器。
 */
export function pickLoginBrowser(selected: LoginBrowser, installed: readonly LoginBrowser[]): LoginBrowser | null {
  if (installed.includes(selected)) return selected
  return LOGIN_BROWSERS.map((b) => b.id).find((id) => installed.includes(id)) ?? null
}

/** 瀏覽器寫在資料夾裡的 DevToolsActivePort：第一行是埠號，第二行是瀏覽器的連線路徑 */
export function parseDevToolsActivePort(text: string): { port: number; path: string } | null {
  const [portLine, pathLine] = text.split(/\r?\n/)
  const port = Number(portLine)
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !pathLine?.startsWith('/devtools/browser/')) return null
  return { port, path: pathLine.trim() }
}

/** Chrome DevTools Protocol 的 cookie（Storage.getCookies 的結果，只列用到的欄位） */
export interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  /** 秒；工作階段 cookie 是 -1 */
  expires: number
  httpOnly: boolean
  secure: boolean
  session?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: unknown
}

/** Electron 的 session.cookies.set 用的資料 */
export interface CookieDetails {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

const hostOf = (domain: string) => domain.replace(/^\./, '').toLowerCase()

/** Google 與 YouTube 的網域（google.com、google.com.tw 這類各地的網域、youtube.com），只帶回這些 cookie */
export function isGoogleDomain(domain: string): boolean {
  const host = hostOf(domain)
  return /(^|\.)youtube\.com$/.test(host) || /(^|\.)google\.(com|[a-z]{2})(\.[a-z]{2})?$/.test(host)
}

/** 登入完成：YouTube 有登入的 cookie（LOGIN_INFO）與帳號的 cookie（SID 系列） */
export function isYouTubeLoggedIn(cookies: readonly Pick<CdpCookie, 'name' | 'domain'>[]): boolean {
  const yt = cookies.filter((c) => /(^|\.)youtube\.com$/.test(hostOf(c.domain)))
  return yt.some((c) => c.name === 'LOGIN_INFO') && yt.some((c) => /^(SID|__Secure-[13]PSID)$/.test(c.name))
}

const SAME_SITE: Record<string, CookieDetails['sameSite']> = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' }

/**
 * 轉成程式的 cookie：只要 Google 與 YouTube 的、不是分區的（partitionKey）；
 * 只限這個主機的 cookie（網域前面沒有點）與 __Host- 開頭的不帶 domain；工作階段 cookie 沒有到期時間。
 */
export function toCookieDetails(cookies: readonly CdpCookie[]): CookieDetails[] {
  return cookies.flatMap((c) => {
    if (!isGoogleDomain(c.domain) || c.partitionKey) return []
    const hostOnly = !c.domain.startsWith('.') || c.name.startsWith('__Host-')
    const details: CookieDetails = {
      url: `https://${hostOf(c.domain)}${c.path || '/'}`,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: (c.sameSite && SAME_SITE[c.sameSite]) || 'unspecified'
    }
    if (!hostOnly) details.domain = c.domain
    if (!c.session && c.expires > 0) details.expirationDate = c.expires
    return [details]
  })
}

/** 登出時要刪掉的 cookie 的網址 */
export const cookieUrl = (c: { domain?: string; path?: string }) => `https://${hostOf(c.domain ?? '')}${c.path || '/'}`

export type LoginResult =
  | { ok: true; cookies: CookieDetails[] }
  /** no-browser：找不到 Edge、Chrome 或 Brave；cancelled：使用者關掉瀏覽器；timeout：太久沒有登入；failed：其他原因 */
  | { ok: false; reason: 'no-browser' | 'cancelled' | 'timeout' | 'failed' | 'busy' }

export type LoginFailure = Exclude<LoginResult, { ok: true }>['reason']

export const LOGIN_FAILURE_TEXT: Record<LoginFailure, string> = {
  'no-browser': '找不到 Microsoft Edge、Google Chrome 或 Brave，無法登入',
  cancelled: '已取消登入',
  timeout: '太久沒有完成登入，已取消',
  failed: '登入失敗，請再試一次',
  busy: '登入視窗已經開著'
}

/** 手機版 YouTube 的觀看紀錄（小視窗的「紀錄」按鈕） */
export const MOBILE_HISTORY_URL = 'https://m.youtube.com/feed/history'
