// 用外部瀏覽器登入 Google（R165）的規則：找瀏覽器、判斷登入完成、把瀏覽器的 cookie 轉成程式的 cookie。
// 不依賴 Electron 與 Node，方便測試；連線與啟動瀏覽器在 electron/googleLogin.ts。

/** 開啟的登入頁：登入後回到 YouTube，YouTube 的 cookie 也會設好 */
export const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=%2F')

/** 等使用者登入最多多久（毫秒） */
export const LOGIN_TIMEOUT_MS = 15 * 60_000

/**
 * 依序找這些瀏覽器：Windows 10、11 內建 Edge，找不到時用 Chrome。
 * env 是環境變數（ProgramFiles、ProgramFiles(x86)、LOCALAPPDATA）。
 */
export function browserCandidates(env: Record<string, string | undefined>): string[] {
  const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter((r): r is string => !!r)
  const edge = roots.map((r) => `${r}\\Microsoft\\Edge\\Application\\msedge.exe`)
  const chrome = roots.map((r) => `${r}\\Google\\Chrome\\Application\\chrome.exe`)
  return [...edge, ...chrome]
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
  /** no-browser：找不到 Edge 或 Chrome；cancelled：使用者關掉瀏覽器；timeout：太久沒有登入；failed：其他原因 */
  | { ok: false; reason: 'no-browser' | 'cancelled' | 'timeout' | 'failed' | 'busy' }

export type LoginFailure = Exclude<LoginResult, { ok: true }>['reason']

export const LOGIN_FAILURE_TEXT: Record<LoginFailure, string> = {
  'no-browser': '找不到 Microsoft Edge 或 Google Chrome，無法登入',
  cancelled: '已取消登入',
  timeout: '太久沒有完成登入，已取消',
  failed: '登入失敗，請再試一次',
  busy: '登入視窗已經開著'
}

/** 手機版 YouTube 的觀看紀錄（小視窗的「紀錄」按鈕） */
export const MOBILE_HISTORY_URL = 'https://m.youtube.com/feed/history'
