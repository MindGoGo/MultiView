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
  /** 等偵錯連線最多多久 */
  portWaitMs?: number
  /** 記錄每個步驟（寫進 login.log，方便查問題） */
  log?(message: string): void
}

export function findBrowser(): string | null {
  return browserCandidates(process.env).find((p) => fs.existsSync(p)) ?? null
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

/** 等瀏覽器寫出偵錯連線的位置最多多久：電腦很慢時 Edge 要一陣子才開好 */
const PORT_WAIT_MS = 90_000
/** 連續幾次檢查都沒有分頁才算使用者關掉視窗（剛開啟、換頁時可能短暫沒有分頁） */
const NO_PAGE_POLLS = 3

/**
 * 開啟瀏覽器讓使用者登入，回傳 Google 與 YouTube 的 cookie。
 * 不看我們啟動的那個程序有沒有結束：Edge 可能把工作交給另一個程序後自己先結束，視窗還開著（0.8.5 實測）。
 * 改用偵錯連線判斷：連線中斷或分頁都關了才算取消。
 */
export async function loginWithBrowser(opts: LoginOptions = {}): Promise<LoginResult> {
  const log = opts.log ?? (() => undefined)
  const exe = opts.executable ?? findBrowser()
  log(`瀏覽器：${exe ?? '找不到'}`)
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
  let childExited = false
  let spawnError = false
  child.once('exit', (code) => {
    childExited = true
    log(`啟動的程序結束（代碼 ${code}）`)
  })
  child.once('error', (e) => {
    childExited = true
    spawnError = true
    log(`無法啟動瀏覽器：${e.message}`)
  })

  let cdp: Awaited<ReturnType<typeof connect>> | null = null
  let closed = false
  try {
    // 等瀏覽器寫出偵錯連線的位置。啟動的程序先結束也繼續等（交給別的程序開視窗）
    const portFile = path.join(dir, 'DevToolsActivePort')
    let target: { port: number; path: string } | null = null
    const portDeadline = Date.now() + (opts.portWaitMs ?? PORT_WAIT_MS)
    while (!target && !spawnError && Date.now() < portDeadline) {
      await sleep(250)
      if (fs.existsSync(portFile)) target = parseDevToolsActivePort(fs.readFileSync(portFile, 'utf8'))
    }
    if (!target) {
      log(spawnError ? '啟動失敗' : '等不到偵錯連線')
      return { ok: false, reason: 'failed' }
    }
    log(`偵錯連線：埠 ${target.port}`)
    cdp = await connect(`ws://127.0.0.1:${target.port}${target.path}`, () => {
      closed = true
      log('偵錯連線中斷（瀏覽器關閉）')
    })

    const isDone = opts.isDone ?? isYouTubeLoggedIn
    const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS)
    const pollMs = opts.pollMs ?? 1500
    let seenPage = false
    let noPage = 0
    while (true) {
      if (Date.now() > deadline) return { ok: false, reason: 'timeout' }
      let cookies: CdpCookie[]
      try {
        // 使用者關掉登入的視窗：Edge 可能在背景繼續執行，所以看還有沒有分頁。
        // 剛開啟時可能還沒有分頁，看過分頁之後連續幾次都沒有才算關掉
        const { targetInfos } = await cdp.send<{ targetInfos: { type: string }[] }>('Target.getTargets')
        if (targetInfos.some((t) => t.type === 'page')) {
          if (!seenPage) log('登入的分頁已開啟')
          seenPage = true
          noPage = 0
        } else if (seenPage && ++noPage >= NO_PAGE_POLLS) {
          log('分頁都關了')
          return { ok: false, reason: 'cancelled' }
        }
        cookies = (await cdp.send<{ cookies: CdpCookie[] }>('Storage.getCookies')).cookies
      } catch (e) {
        log(`讀取失敗：${(e as Error).message}`)
        return { ok: false, reason: closed ? 'cancelled' : 'failed' }
      }
      if (isDone(cookies)) {
        log('偵測到已登入')
        // 登入後 Google 還會轉址幾次、補上其他網域的 cookie，等一下再拿最後的結果
        await sleep(2000)
        try {
          cookies = (await cdp.send<{ cookies: CdpCookie[] }>('Storage.getCookies')).cookies
        } catch {
          // 沿用剛才拿到的
        }
        const details = toCookieDetails(cookies)
        log(`取得 ${details.length} 個 cookie`)
        return { ok: true, cookies: details }
      }
      await sleep(pollMs)
    }
  } catch (e) {
    log(`錯誤：${(e as Error).message}`)
    return { ok: false, reason: closed ? 'cancelled' : 'failed' }
  } finally {
    // 關掉瀏覽器（只有這次開的這個，使用者平常用的 Edge 不受影響）。
    // 用偵錯連線關，交給別的程序開的視窗也關得掉
    if (cdp && !closed) {
      try {
        await Promise.race([cdp.send('Browser.close'), sleep(3000)])
      } catch {
        // 已經關掉了
      }
    }
    // 等瀏覽器真的關掉（偵錯連線中斷）再刪資料夾，不然瀏覽器關閉時又會寫回去
    for (let i = 0; i < 40 && cdp && !closed; i++) await sleep(250)
    cdp?.close()
    for (let i = 0; i < 20 && !childExited; i++) await sleep(250)
    if (!childExited) child.kill()
    await sleep(500)
    await removeDir(dir)
    log('已清理')
  }
}
