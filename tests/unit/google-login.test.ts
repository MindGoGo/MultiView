// 用外部瀏覽器登入 Google（R165）的規則
import { describe, expect, it } from 'vitest'
import {
  browserPaths,
  normalizeLoginBrowser,
  pickLoginBrowser,
  cookieUrl,
  isGoogleDomain,
  isYouTubeLoggedIn,
  LOGIN_URL,
  parseDevToolsActivePort,
  toCookieDetails,
  type CdpCookie
} from '../../src/lib/googleLogin'
import { normalizeSettings } from '../../src/lib/settings'

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
  it('每個瀏覽器的安裝位置，略過沒有的環境變數', () => {
    const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }
    expect(browserPaths('edge', env)).toEqual([
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Users\\a\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'
    ])
    expect(browserPaths('chrome', env)[0]).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(browserPaths('brave', env)).toEqual([
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Users\\a\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    ])
    expect(browserPaths('edge', { 'ProgramFiles(x86)': 'X' })).toEqual(['X\\Microsoft\\Edge\\Application\\msedge.exe'])
    expect(browserPaths('edge', {})).toEqual([])
  })

  it('選的瀏覽器沒有安裝時，依 Edge、Chrome、Brave 的順序用有安裝的', () => {
    expect(pickLoginBrowser('brave', ['edge', 'chrome', 'brave'])).toBe('brave')
    expect(pickLoginBrowser('chrome', ['edge', 'brave'])).toBe('edge')
    expect(pickLoginBrowser('edge', ['brave', 'chrome'])).toBe('chrome')
    expect(pickLoginBrowser('edge', [])).toBeNull()
  })

  it('設定檔的瀏覽器：不認得時是 Edge', () => {
    expect(normalizeLoginBrowser('brave')).toBe('brave')
    expect(normalizeLoginBrowser('firefox')).toBe('edge')
    expect(normalizeLoginBrowser(undefined)).toBe('edge')
    expect(normalizeSettings({ version: 1, loginBrowser: 'chrome' })!.loginBrowser).toBe('chrome')
    expect(normalizeSettings({ version: 1 })!.loginBrowser).toBe('edge')
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

describe('瀏覽器還開著登入的資料夾嗎', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { profileInUse } = await import('../../electron/googleLogin')
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-profile-'))

  it('Windows：有 lockfile 就是開著', () => {
    const dir = tmp()
    expect(profileInUse(dir)).toBe(false)
    fs.writeFileSync(path.join(dir, 'lockfile'), '')
    expect(profileInUse(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it.skipIf(process.platform === 'win32')('Linux、macOS：SingletonLock 指向的程序還在才算開著', () => {
    const dir = tmp()
    fs.symlinkSync(`host-${process.pid}`, path.join(dir, 'SingletonLock'))
    expect(profileInUse(dir)).toBe(true)
    fs.rmSync(path.join(dir, 'SingletonLock'))
    // 瀏覽器被強制結束時留下來的
    fs.symlinkSync('host-999999999', path.join(dir, 'SingletonLock'))
    expect(profileInUse(dir)).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })
})
