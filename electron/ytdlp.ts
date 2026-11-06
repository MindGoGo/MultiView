// yt-dlp 的準備、解析、更新與狀態（R89–R93）。
// 執行的是使用者的 yt-dlp（%APPDATA%\MultiView\bin\yt-dlp.exe），從安裝檔內附的那一份複製而來（R91）。
import fs from 'node:fs'
import path from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import { app, net, type Session } from 'electron'
import {
  compareVersion,
  isOutdatedError,
  normalizeUpdateRecord,
  parseUpdateOutput,
  parseVersion,
  pickStream,
  shouldAutoUpdate,
  statusOf,
  type ResolveResult,
  type UpdateOutcome,
  type UpdateRecord,
  type YtDlpStatus
} from '../src/lib/ytdlp'
import { createResolver } from '../src/lib/ytdlpResolver'

/** 更新管道（計畫 D4a）：YouTube 改版的修正如果常常要等很久才進 stable，改成 'nightly' */
const UPDATE_CHANNEL = 'stable'
const RESOLVE_TIMEOUT_MS = 30_000
const UPDATE_TIMEOUT_MS = 120_000
/** 直播的 JSON 可能很大 */
const MAX_BUFFER = 32 * 1024 * 1024
/** 設定選單查詢最新版：距離上次成功查詢不到 1 小時就沿用（R93） */
const LATEST_CHECK_INTERVAL_MS = 60 * 60 * 1000
const LATEST_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'

const bundledPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe')
    : path.join(app.getAppPath(), 'vendor', 'yt-dlp.exe')
const binDir = () => path.join(app.getPath('userData'), 'bin')
const userPath = () => path.join(binDir(), 'yt-dlp.exe')
const recordPath = () => path.join(binDir(), 'update.json')

/** 還在執行的 yt-dlp；關閉程式時結束（R89） */
const children = new Set<ChildProcess>()

interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  /** 檔案不存在或無法執行 */
  missing: boolean
}

function exec(args: string[], timeout: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      userPath(),
      args,
      {
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        // yt-dlp 解析 YouTube 需要的 JS 執行環境用程式本身（以 Node 模式執行，第 8 節）
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      },
      (error, stdout, stderr) => {
        children.delete(child)
        const err = error as (NodeJS.ErrnoException & { code?: unknown }) | null
        const missing = !!err && (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'UNKNOWN')
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr, missing })
      }
    )
    children.add(child)
  })
}

async function versionOf(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: 15_000, windowsHide: true }, (error, stdout) =>
      resolve(error ? null : parseVersion(stdout))
    )
  })
}

function readRecord(): UpdateRecord {
  try {
    return normalizeUpdateRecord(JSON.parse(fs.readFileSync(recordPath(), 'utf8')))
  } catch {
    return normalizeUpdateRecord(null)
  }
}

function writeRecord(record: UpdateRecord) {
  try {
    fs.mkdirSync(binDir(), { recursive: true })
    fs.writeFileSync(recordPath(), JSON.stringify(record), 'utf8')
  } catch {
    // 寫不進去只是下次會再檢查一次
  }
}

const status: YtDlpStatus = { state: 'checking', version: null, latest: null }
let lastLatestCheck = -Infinity
let notify: (s: YtDlpStatus) => void = () => undefined

function setStatus(next: Partial<YtDlpStatus>) {
  Object.assign(status, next)
  notify({ ...status })
}

/** 回到一般的狀態（不是正在檢查、正在更新） */
const settle = () => setStatus({ state: statusOf(status.version, status.latest) })

/** 準備使用者的 yt-dlp（R91）：不存在或無法執行就複製；程式換了版本時，內附的比較新就覆蓋 */
async function prepare(): Promise<void> {
  const record = readRecord()
  const copy = async () => {
    try {
      fs.mkdirSync(binDir(), { recursive: true })
      fs.copyFileSync(bundledPath(), userPath())
    } catch {
      // 複製失敗：沒有可用的 yt-dlp，解析一律退回內嵌（R91 AC4）
    }
    return versionOf(userPath())
  }
  let version = fs.existsSync(userPath()) ? await versionOf(userPath()) : null
  if (!version) version = await copy()
  else if (record.appVersion !== app.getVersion()) {
    const bundled = await versionOf(bundledPath())
    if (bundled && compareVersion(bundled, version) > 0) version = (await copy()) ?? version
  }
  writeRecord({ ...readRecord(), appVersion: app.getVersion() })
  status.version = version
  settle()
}

const ready = app.whenReady().then(prepare)

async function run(videoId: string): Promise<ResolveResult> {
  if (!status.version) return { ok: false, reason: 'missing' }
  const r = await exec(
    [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--ignore-config',
      '--js-runtimes',
      `node:${process.execPath}`,
      `https://www.youtube.com/watch?v=${videoId}`
    ],
    RESOLVE_TIMEOUT_MS
  )
  if (r.missing) return { ok: false, reason: 'missing' }
  if (r.code !== 0) return { ok: false, reason: isOutdatedError(r.stderr) ? 'outdated' : 'failed' }
  let stream
  try {
    stream = pickStream(JSON.parse(r.stdout), Date.now())
  } catch {
    stream = null
  }
  if (!stream) return { ok: false, reason: 'failed' }
  if (stream.kind === 'mp4') await waitUntilServed(stream.url)
  return { ok: true, stream }
}

const SERVE_WAIT_TRIES = 10
const SERVE_WAIT_INTERVAL_MS = 1000

/**
 * 剛解析出來的一般影片網址，前幾秒 YouTube 會回 403（2026-11-06 實測約 3 秒），
 * 播放器會因此失敗、重新解析又拿到新的網址。先試讀第一個位元組，可以讀了才交給畫面；
 * 10 秒內都不行就照樣交出去，由播放器的重試處理。
 */
async function waitUntilServed(url: string) {
  for (let i = 0; i < SERVE_WAIT_TRIES; i++) {
    try {
      const res = await net.fetch(url, { headers: { Range: 'bytes=0-0' } })
      await res.body?.cancel()
      if (res.ok) return
    } catch {
      // 網路錯誤也再等一下
    }
    await new Promise((r) => setTimeout(r, SERVE_WAIT_INTERVAL_MS))
  }
}

/** 執行一次更新（R92）：yt-dlp 自己會先下載並檢查雜湊才替換，失敗時原本的檔案不變 */
async function rawUpdate(): Promise<{ result: UpdateOutcome; version: string | null }> {
  if (!status.version) return { result: 'failed', version: null }
  setStatus({ state: 'updating' })
  const r = await exec(['--update-to', UPDATE_CHANNEL], UPDATE_TIMEOUT_MS)
  const out = parseUpdateOutput(`${r.stdout}\n${r.stderr}`, r.code)
  if (out.result !== 'failed') {
    const version = out.version ?? (await versionOf(userPath())) ?? status.version
    writeRecord({ ...readRecord(), lastCheck: Date.now() })
    // 剛更新或確認過，就是最新版
    status.version = version
    status.latest = version
    lastLatestCheck = Date.now()
  }
  settle()
  return { ...out, version: out.version ?? status.version }
}

const resolver = createResolver({ run, update: rawUpdate, ready, now: Date.now })

/** 查詢 GitHub 上最新的穩定版（R93）；1 小時內查過就不再查，查詢失敗下次會再試 */
async function checkLatest(): Promise<void> {
  await ready
  if (Date.now() - lastLatestCheck < LATEST_CHECK_INTERVAL_MS || resolver.updating || !status.version) return
  setStatus({ state: 'checking' })
  let latest: string | null = null
  try {
    const r = await net.fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (r.ok) {
      const tag = ((await r.json()) as { tag_name?: unknown }).tag_name
      latest = typeof tag === 'string' ? parseVersion(tag) : null
    }
  } catch {
    latest = null
  }
  if (latest) lastLatestCheck = Date.now()
  // 查詢期間開始更新時，交給更新完成後的狀態
  if (resolver.updating) return
  status.latest = latest
  settle()
}

export const ytdlp = {
  resolve: (videoId: string, refresh: boolean) => resolver.resolve(videoId, { refresh }),
  update: () => resolver.update(),
  getStatus: (): YtDlpStatus => ({ ...status }),
  checkLatest,
  onStatus(cb: (s: YtDlpStatus) => void) {
    notify = cb
  },
  /** 視窗顯示後呼叫：開啟時的自動更新（R92 時機 1）與查詢最新版（R93），都在背景 */
  async afterStartup() {
    await ready
    if (status.version && shouldAutoUpdate(readRecord(), Date.now())) await resolver.update()
    await checkLatest()
  },
  killAll() {
    for (const c of children) c.kill()
    children.clear()
  }
}

/**
 * 串流的跨網站存取許可（R89、第 8 節）：程式畫面用 hls.js 讀 googlevideo.com 的清單與片段，
 * 對方沒有回傳 Access-Control-Allow-Origin。只補給程式畫面發出的請求（Origin 是畫面的網址），
 * 內嵌播放器（Origin 是 YouTube）的請求不動。
 */
export function installStreamCors(ses: Session, appOrigin: string) {
  const filter = { urls: ['*://*.googlevideo.com/*'] }
  const fromApp = new Set<number>()
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const origin = Object.entries(details.requestHeaders).find(([k]) => k.toLowerCase() === 'origin')?.[1]
    if (origin === appOrigin) fromApp.add(details.id)
    callback({ requestHeaders: details.requestHeaders })
  })
  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    if (!fromApp.delete(details.id)) return callback({})
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(([k]) => k.toLowerCase() !== 'access-control-allow-origin')
    )
    headers['Access-Control-Allow-Origin'] = [appOrigin]
    callback({ responseHeaders: headers })
  })
  ses.webRequest.onErrorOccurred(filter, (details) => fromApp.delete(details.id))
}
