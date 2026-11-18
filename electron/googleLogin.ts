// 用外部瀏覽器登入 Google（R165）。
// Google 不讓程式裡的網頁登入，所以用使用者電腦上的 Edge（或 Chrome）開一個全新的暫存資料夾讓使用者登入，
// 登入完成後透過瀏覽器的偵錯連線（Chrome DevTools Protocol）讀出 Google 與 YouTube 的 cookie，
// 關掉瀏覽器、刪掉暫存資料夾，cookie 交給主程序放進網頁來源與小視窗共用的資料區。
// 不直接依賴 Electron，方便測試。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  browserCandidates,
  isYouTubeLoggedIn,
  LOGIN_TIMEOUT_MS,
  LOGIN_URL,
  parseDevToolsActivePort,
  toCookieDetails,
  type CdpCookie,
  type LoginResult
} from '../src/lib/googleLogin'

export interface LoginOptions {
  /** 瀏覽器的執行檔；沒有時依序找 Edge、Chrome */
  executable?: string
  url?: string
  /** 判斷登入完成；預設是 YouTube 有登入的 cookie */
  isDone?(cookies: CdpCookie[]): boolean
  timeoutMs?: number
  /** 檢查 cookie 的間隔 */
  pollMs?: number
  /** 額外的瀏覽器參數（測試用，例如 --headless=new） */
  extraArgs?: string[]
}

export function findBrowser(): string | null {
  return browserCandidates(process.env).find((p) => fs.existsSync(p)) ?? null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 最簡單的 DevTools Protocol 連線：送出指令、等對應 id 的回應 */
async function connect(url: string) {
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
  ws.addEventListener('close', fail)
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
      return
    } catch {
      await sleep(500)
    }
  }
}

/** 開啟瀏覽器讓使用者登入，回傳 Google 與 YouTube 的 cookie */
export async function loginWithBrowser(opts: LoginOptions = {}): Promise<LoginResult> {
  const exe = opts.executable ?? findBrowser()
  if (!exe) return { ok: false, reason: 'no-browser' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiview-login-'))
  const child = spawn(
    exe,
    [
      `--user-data-dir=${dir}`,
      // 0：由瀏覽器選一個空的埠號，寫在資料夾的 DevToolsActivePort
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      ...(opts.extraArgs ?? []),
      '--new-window',
      opts.url ?? LOGIN_URL
    ],
    { stdio: 'ignore', detached: false }
  )
  let exited = false
  const exitedPromise = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true
      resolve()
    })
    child.once('error', () => {
      exited = true
      resolve()
    })
  })

  let cdp: Awaited<ReturnType<typeof connect>> | null = null
  try {
    // 等瀏覽器寫出偵錯連線的位置
    const portFile = path.join(dir, 'DevToolsActivePort')
    let target: { port: number; path: string } | null = null
    for (let i = 0; i < 100 && !exited && !target; i++) {
      await sleep(200)
      if (fs.existsSync(portFile)) target = parseDevToolsActivePort(fs.readFileSync(portFile, 'utf8'))
    }
    if (exited) return { ok: false, reason: 'cancelled' }
    if (!target) return { ok: false, reason: 'failed' }
    cdp = await connect(`ws://127.0.0.1:${target.port}${target.path}`)

    const isDone = opts.isDone ?? isYouTubeLoggedIn
    const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS)
    const pollMs = opts.pollMs ?? 1500
    while (true) {
      // 使用者關掉瀏覽器：取消
      if (exited) return { ok: false, reason: 'cancelled' }
      if (Date.now() > deadline) return { ok: false, reason: 'timeout' }
      let cookies: CdpCookie[]
      try {
        // 使用者關掉登入的視窗：Edge 可能在背景繼續執行，所以看還有沒有分頁
        const { targetInfos } = await cdp.send<{ targetInfos: { type: string }[] }>('Target.getTargets')
        if (!targetInfos.some((t) => t.type === 'page')) return { ok: false, reason: 'cancelled' }
        cookies = (await cdp.send<{ cookies: CdpCookie[] }>('Storage.getCookies')).cookies
      } catch {
        if (exited || (await Promise.race([exitedPromise.then(() => true), sleep(1000).then(() => false)])))
          return { ok: false, reason: 'cancelled' }
        return { ok: false, reason: 'failed' }
      }
      if (isDone(cookies)) {
        // 登入後 Google 還會轉址幾次、補上其他網域的 cookie，等一下再拿最後的結果
        await sleep(2000)
        try {
          cookies = (await cdp.send<{ cookies: CdpCookie[] }>('Storage.getCookies')).cookies
        } catch {
          // 沿用剛才拿到的
        }
        return { ok: true, cookies: toCookieDetails(cookies) }
      }
      await sleep(pollMs)
    }
  } catch {
    return { ok: false, reason: exited ? 'cancelled' : 'failed' }
  } finally {
    // 關掉瀏覽器（只有這次開的這個，使用者平常用的 Edge 不受影響）
    try {
      await Promise.race([cdp?.send('Browser.close'), sleep(3000)])
    } catch {
      // 已經關掉了
    }
    cdp?.close()
    await Promise.race([exitedPromise, sleep(5000)])
    if (!exited) child.kill()
    await Promise.race([exitedPromise, sleep(2000)])
    await removeDir(dir)
  }
}
