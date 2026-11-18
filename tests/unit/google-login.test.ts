// 用外部瀏覽器登入 Google（R165）的規則
import { describe, expect, it } from 'vitest'
import {
  browserCandidates,
  cookieUrl,
  isGoogleDomain,
  isYouTubeLoggedIn,
  LOGIN_URL,
  parseDevToolsActivePort,
  toCookieDetails,
  type CdpCookie
} from '../../src/lib/googleLogin'

const cookie = (over: Partial<CdpCookie>): CdpCookie => ({
  name: 'SID',
  value: 'v',
  domain: '.youtube.com',
  path: '/',
  expires: 2_000_000_000,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
  ...over
})

describe('找瀏覽器', () => {
  it('先 Edge 再 Chrome，略過沒有的環境變數', () => {
    expect(browserCandidates({ ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' })).toEqual([
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Users\\a\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    ])
    expect(browserCandidates({ 'ProgramFiles(x86)': 'X' })[0]).toBe('X\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(browserCandidates({})).toEqual([])
  })

  it('讀 DevToolsActivePort', () => {
    expect(parseDevToolsActivePort('51234\n/devtools/browser/abc-123\n')).toEqual({ port: 51234, path: '/devtools/browser/abc-123' })
    expect(parseDevToolsActivePort('51234\r\n/devtools/browser/x')).toEqual({ port: 51234, path: '/devtools/browser/x' })
    // 瀏覽器還沒寫完
    expect(parseDevToolsActivePort('51234')).toBeNull()
    expect(parseDevToolsActivePort('')).toBeNull()
    expect(parseDevToolsActivePort('abc\n/devtools/browser/x')).toBeNull()
  })

  it('登入頁登入後回到 YouTube', () => {
    expect(LOGIN_URL.startsWith('https://accounts.google.com/')).toBe(true)
    expect(decodeURIComponent(LOGIN_URL)).toContain('continue=https://www.youtube.com/signin')
  })
})

describe('登入完成', () => {
  it('YouTube 要有 LOGIN_INFO 和帳號的 cookie', () => {
    expect(isYouTubeLoggedIn([cookie({ name: 'LOGIN_INFO' }), cookie({ name: '__Secure-3PSID' })])).toBe(true)
    expect(isYouTubeLoggedIn([cookie({ name: 'LOGIN_INFO' }), cookie({ name: 'SID' })])).toBe(true)
    // 只有 Google 登入了，還沒回到 YouTube
    expect(isYouTubeLoggedIn([cookie({ name: 'SID', domain: '.google.com' }), cookie({ name: 'LOGIN_INFO', domain: '.google.com' })])).toBe(false)
    expect(isYouTubeLoggedIn([cookie({ name: 'LOGIN_INFO' })])).toBe(false)
    expect(isYouTubeLoggedIn([cookie({ name: 'PREF' }), cookie({ name: 'VISITOR_INFO1_LIVE' })])).toBe(false)
    // 別的網站剛好有同名的 cookie
    expect(isYouTubeLoggedIn([cookie({ name: 'LOGIN_INFO', domain: 'notyoutube.com' }), cookie({ name: 'SID', domain: 'notyoutube.com' })])).toBe(false)
  })
})

describe('cookie 轉換', () => {
  it('只要 Google 與 YouTube 的網域', () => {
    expect(isGoogleDomain('.youtube.com')).toBe(true)
    expect(isGoogleDomain('www.youtube.com')).toBe(true)
    expect(isGoogleDomain('.google.com')).toBe(true)
    expect(isGoogleDomain('accounts.google.com')).toBe(true)
    expect(isGoogleDomain('.google.com.tw')).toBe(true)
    expect(isGoogleDomain('.google.de')).toBe(true)
    expect(isGoogleDomain('.microsoft.com')).toBe(false)
    expect(isGoogleDomain('evilgoogle.com')).toBe(false)
    expect(isGoogleDomain('youtube.com.evil.net')).toBe(false)
  })

  it('網域 cookie、只限主機的 cookie、__Host-、工作階段', () => {
    const out = toCookieDetails([
      cookie({ name: 'SID', domain: '.youtube.com', sameSite: 'None' }),
      cookie({ name: 'LSID', domain: 'accounts.google.com', path: '/', sameSite: 'Lax' }),
      cookie({ name: '__Host-GAPS', domain: 'accounts.google.com', sameSite: 'Strict' }),
      cookie({ name: 'S', domain: '.google.com', expires: -1, session: true, sameSite: undefined }),
      cookie({ name: 'MUID', domain: '.bing.com' }),
      cookie({ name: 'P', domain: '.youtube.com', partitionKey: { topLevelSite: 'https://x.com' } })
    ])
    expect(out).toEqual([
      {
        url: 'https://youtube.com/',
        name: 'SID',
        value: 'v',
        domain: '.youtube.com',
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: 2_000_000_000,
        sameSite: 'no_restriction'
      },
      {
        url: 'https://accounts.google.com/',
        name: 'LSID',
        value: 'v',
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: 2_000_000_000,
        sameSite: 'lax'
      },
      {
        url: 'https://accounts.google.com/',
        name: '__Host-GAPS',
        value: 'v',
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: 2_000_000_000,
        sameSite: 'strict'
      },
      { url: 'https://google.com/', name: 'S', value: 'v', domain: '.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'unspecified' }
    ])
  })

  it('登出時刪除的網址', () => {
    expect(cookieUrl({ domain: '.youtube.com', path: '/' })).toBe('https://youtube.com/')
    expect(cookieUrl({ domain: 'accounts.google.com', path: '/ServiceLogin' })).toBe('https://accounts.google.com/ServiceLogin')
  })
})
