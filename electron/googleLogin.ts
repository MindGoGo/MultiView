// 用外部瀏覽器登入 Google（R168）。
// Google 不讓程式裡的網頁登入，所以用使用者電腦上的 Edge（或 Chrome、Brave）開一個全新的暫存資料夾讓使用者登入。
// 分兩段（0.8.8）：
//   1. 登入：一般的瀏覽器視窗，不開偵錯連線。開著偵錯連線時 Google 會擋個人帳號
//      （「這個瀏覽器或應用程式可能不安全」，0.8.7 實測；公司帳號不受影響）。使用者登入後關掉視窗。
//   2. 讀取：瀏覽器關掉後，用同一個資料夾在背景（看不見的視窗）開瀏覽器與偵錯連線，讀出 Google 與 YouTube 的 cookie，
//      關掉瀏覽器、刪掉暫存資料夾。cookie 交給主程序放進網頁來源與小視窗共用的資料區。
// 不直接依賴 Electron，方便測試。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  browserPaths,
  LOGIN_BROWSERS,
  type LoginBrowser,
  isYouTubeLoggedIn,
  LOGIN_TIMEOUT_MS,
  LOGIN_URL,
  parseDevToolsActivePort,
  toCookieDetails,
  type CdpCookie,
  type LoginResult
} from '../src/lib/googleLogin'

export interface LoginOptions {
  /** 瀏覽器的執行檔；沒有時依序找 Edge、Chrome、Brave */
  executable?: string
  url?: string
  /** 判斷登入完成；預設是 YouTube 有登入的 cookie */
  isDone?(cookies: CdpCookie[]): boolean
  /** 等使用者登入、關掉視窗最多多久 */
  timeoutMs?: number
  /** 檢查瀏覽器關了沒的間隔 */
  pollMs?: number
  /** 登入時額外的瀏覽器參數（測試用，例如 --headless=new） */
  extraArgs?: string[]
  /** 讀取時額外的瀏覽器參數（測試用） */
  readExtraArgs?: string[]
  /** 等瀏覽器開好（資料夾被占用、偵錯連線）最多多久 */
  portWaitMs?: number
  /** 記錄每個步驟（寫進 login.log，方便查問題） */
  log?(message: string): void
  /** 進入讀取登入狀態的階段（小視窗顯示「讀取登入狀態…」） */
  onReading?(): void
  /** 使用者在小視窗按「取消」 */
  signal?: AbortSignal
  /** 測試用：登入的瀏覽器開好之後呼叫（模擬使用者登入、關掉視窗） */
  onBrowserOpen?(dir: string): void
}

/** 電腦上有安裝的登入用瀏覽器與它的執行檔 */
export function installedBrowsers(): Partial<Record<LoginBrowser, string>> {
  const out: Partial<Record<LoginBrowser, string>> = {}
  for (const b of LOGIN_BROWSERS) {
    const exe = browserPaths(b.id, process.env).find((p) => fs.existsSync(p))
    if (exe) out[b.id] = exe
  }
  return out
}

function findBrowser(): string | null {
  return Object.values(installedBrowsers())[0] ?? null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 最簡單的 DevTools Protocol 連線：送出指令、等對應 id 的回應 */
async function connect(url: string, onClose: () => void) {
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('連不上瀏覽器')), { once: true })
  })
  let nextId = 0
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } }
    const p = msg.id === undefined ? undefined : pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id!)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  })
  const fail = () => {
    for (const p of pending.values()) p.reject(new Error('瀏覽器的連線中斷'))
    pending.clear()
  }
  ws.addEventListener('close', () => {
    onClose()
    fail()
  })
  return {
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('瀏覽器的連線中斷'))
      const id = ++nextId
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => ws.close()
  }
}

/** 刪掉暫存資料夾；瀏覽器剛關掉時檔案可能還被占用，重試幾次 */
async function removeDir(dir: string) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      // 瀏覽器的背景程序可能還在寫：過一下再確認一次
      await sleep(500)
      if (!fs.existsSync(dir)) return
    } catch {
      await sleep(500)
    }
  }
}

/** 等瀏覽器開好最多多久：電腦很慢時要一陣子 */
const OPEN_WAIT_MS = 90_000

/**
 * 瀏覽器還開著這個資料夾嗎：Windows 是 lockfile（瀏覽器關掉時刪除），Linux、macOS 是 SingletonLock。
 * Edge 把視窗交給另一個程序開時，我們啟動的程序先結束，所以不能看程序，要看資料夾（0.8.5 實測）。
 */
export function profileInUse(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'lockfile'))) return true
  // SingletonLock 指向「主機名稱-程序編號」；瀏覽器被強制結束時會留下來，所以再看那個程序還在不在
  let target: string
  try {
    target = fs.readlinkSync(path.join(dir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 刪掉以前留下來、已經沒有瀏覽器在用的暫存資料夾 */
function sweepOldDirs(log: (m: string) => void) {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith('multiview-login-')) continue
      const dir = path.join(os.tmpdir(), name)
      if (!profileInUse(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        log(`刪掉以前留下的 ${name}`)
      }
    }
  } catch {
    // 刪不掉就算了
  }
}

/** 關掉瀏覽器在背景繼續執行的功能，不然使用者關掉視窗後瀏覽器還開著資料夾，等不到「關掉了」 */
function writeInitialPrefs(dir: string) {
  const localState = { background_mode: { enabled: false }, startup_boost: { enabled: false } }
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify(localState))
}

const BASE_ARGS = ['--no-first-run', '--no-default-browser-check', '--disable-default-apps']

/** 啟動瀏覽器；回傳「我們啟動的程序結束了沒」與停止它的方法 */
function launch(exe: string, args: string[], log: (m: string) => void, tag: string) {
  const child = spawn(exe, args, { stdio: 'ignore', detached: false })
  const state = { exited: false, error: false }
  child.once('exit', (code) => {
    state.exited = true
    log(`${tag}：啟動的程序結束（代碼 ${code}）`)
  })
  child.once('error', (e) => {
    state.exited = true
    state.error = true
    log(`${tag}：無法啟動瀏覽器：${e.message}`)
  })
  return { state, kill: () => !state.exited && child.kill() }
}

/** 開啟瀏覽器讓使用者登入，關掉後讀出 Google 與 YouTube 的 cookie */
export async function loginWithBrowser(opts: LoginOptions = {}): Promise<LoginResult> {
  const log = opts.log ?? (() => undefined)
  const exe = opts.executable ?? findBrowser()
  log(`瀏覽器：${exe ?? '找不到'}`)
  if (!exe) return { ok: false, reason: 'no-browser' }
  sweepOldDirs(log)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiview-login-'))
  writeInitialPrefs(dir)
  const openWait = opts.portWaitMs ?? OPEN_WAIT_MS
  const pollMs = opts.pollMs ?? 1000
  let reader: ReturnType<typeof launch> | null = null
  let cdp: Awaited<ReturnType<typeof connect>> | null = null
  let closed = false
  try {
    // 1. 登入：一般的瀏覽器視窗，沒有偵錯連線
    const login = launch(exe, [`--user-data-dir=${dir}`, ...BASE_ARGS, ...(opts.extraArgs ?? []), '--new-window', opts.url ?? LOGIN_URL], log, '登入')
    let opened = false
    const openDeadline = Date.now() + openWait
    while (!opened && !login.state.error && !opts.signal?.aborted && Date.now() < openDeadline) {
      await sleep(250)
      opened = profileInUse(dir)
    }
    if (opts.signal?.aborted) {
      log('使用者取消')
      return { ok: false, reason: 'cancelled' }
    }
    if (!opened) {
      log(login.state.error ? '啟動失敗' : '等不到瀏覽器開好')
      return { ok: false, reason: 'failed' }
    }
    log('登入的瀏覽器已開啟，等使用者登入並關掉視窗')
    opts.onBrowserOpen?.(dir)
    const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS)
    while (profileInUse(dir)) {
      if (opts.signal?.aborted) {
        log('使用者取消')
        login.kill()
        return { ok: false, reason: 'cancelled' }
      }
      if (Date.now() > deadline) {
        log('等太久')
        login.kill()
        return { ok: false, reason: 'timeout' }
      }
      await sleep(pollMs)
    }
    log('登入的瀏覽器已關閉')

    // 2. 讀取：同一個資料夾，背景開瀏覽器與偵錯連線
    opts.onReading?.()
    const portFile = path.join(dir, 'DevToolsActivePort')
    fs.rmSync(portFile, { force: true })
    reader = launch(
      exe,
      [`--user-data-dir=${dir}`, '--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*', ...BASE_ARGS, ...(opts.readExtraArgs ?? []), 'about:blank'],
      log,
      '讀取'
    )
    let target: { port: number; path: string } | null = null
    const portDeadline = Date.now() + openWait
    while (!target && !reader.state.error && Date.now() < portDeadline) {
      await sleep(250)
      if (fs.existsSync(portFile)) target = parseDevToolsActivePort(fs.readFileSync(portFile, 'utf8'))
    }
    if (!target) {
      log('等不到偵錯連線')
      return { ok: false, reason: 'failed' }
    }
    cdp = await connect(`ws://127.0.0.1:${target.port}${target.path}`, () => {
      closed = true
    })
    const cookies = (await cdp.send<{ cookies: CdpCookie[] }>('Storage.getCookies')).cookies
    const isDone = opts.isDone ?? isYouTubeLoggedIn
    if (!isDone(cookies)) {
      log(`沒有登入（共 ${cookies.length} 個 cookie）`)
      return { ok: false, reason: 'not-logged-in' }
    }
    const details = toCookieDetails(cookies)
    log(`偵測到已登入，取得 ${details.length} 個 cookie`)
    return { ok: true, cookies: details }
  } catch (e) {
    log(`錯誤：${(e as Error).message}`)
    return { ok: false, reason: 'failed' }
  } finally {
    // 關掉讀取用的瀏覽器，等它真的關掉（資料夾不再被占用）再刪資料夾
    if (cdp && !closed) {
      try {
        await Promise.race([cdp.send('Browser.close'), sleep(3000)])
      } catch {
        // 已經關掉了
      }
    }
    cdp?.close()
    for (let i = 0; i < 40 && profileInUse(dir); i++) await sleep(250)
    reader?.kill()
    await sleep(500)
    // 逾時時登入的視窗可能還開著：不要刪掉瀏覽器正在用的資料夾，下次登入時再清
    if (profileInUse(dir)) log('瀏覽器還開著，暫存資料夾下次登入時再刪')
    else {
      await removeDir(dir)
      log('已清理')
    }
  }
}
