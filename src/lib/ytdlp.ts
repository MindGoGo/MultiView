// yt-dlp 播放（R88–R93）的共用型別與純邏輯：解析結果的判讀、錯誤判斷、更新輸出、版本比較。
// 主程序與畫面共用，不依賴 Electron。
import { getDomain } from 'tldts-experimental'

/** 每一組（直播、一般影片）的播放方式（R88） */
export type PlayMethod = 'embed' | 'ytdlp'

export interface YouTubeMethods {
  live: PlayMethod
  vod: PlayMethod
}

export const DEFAULT_METHODS: YouTubeMethods = { live: 'embed', vod: 'embed' }

export function normalizeMethods(raw: unknown): YouTubeMethods {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    live: obj.live === 'ytdlp' ? 'ytdlp' : 'embed',
    vod: obj.vod === 'ytdlp' ? 'ytdlp' : 'embed'
  }
}

/** 其他網站的播放方式（R102）：網頁或 yt-dlp */
export type WebMethod = 'web' | 'ytdlp'
export const normalizeWebMethod = (raw: unknown): WebMethod => (raw === 'ytdlp' ? 'ytdlp' : 'web')

/** 兩組都是內嵌播放器時不執行 yt-dlp（R88） */
export const needsResolve = (m: YouTubeMethods) => m.live === 'ytdlp' || m.vod === 'ytdlp'

/** 解析得到的串流（R89） */
export interface YtStream {
  kind: 'hls' | 'mp4'
  url: string
  isLive: boolean
  title: string | null
  /** 網址的有效期限（毫秒時間） */
  expiresAt: number
  /** 網站要求的請求標頭（其他網站，R103）：只有 Referer、User-Agent */
  headers?: Record<string, string>
}

/**
 * 解析失敗的種類（R90、R92）：
 * - outdated：yt-dlp 可能太舊（無法解析 YouTube 頁面），會自動更新後再試一次
 * - missing：找不到或無法執行 yt-dlp（R91）
 * - failed：其他原因（影片不存在、私人、需要登入、還沒開始的直播、網路……）
 */
export type ResolveFailure = 'outdated' | 'missing' | 'failed'

export type ResolveResult = { ok: true; stream: YtStream } | { ok: false; reason: ResolveFailure }

/** 讀不到網址的有效期限時，當作 5 小時後過期 */
export const DEFAULT_EXPIRY_MS = 5 * 60 * 60 * 1000

/** 串流網址的有效期限：query 的 expire= 或路徑中的 /expire/<秒>/ */
export function expiryOf(url: string, now: number): number {
  const m = /[?&/]expire[=/](\d{9,})/.exec(url)
  return m ? Number(m[1]) * 1000 : now + DEFAULT_EXPIRY_MS
}

interface RawFormat {
  format_id?: unknown
  protocol?: unknown
  url?: unknown
  manifest_url?: unknown
  vcodec?: unknown
  acodec?: unknown
  height?: unknown
  ext?: unknown
  http_headers?: unknown
}

/** 播放器（Chromium）能播的容器；avi、mkv、flv 等不能（R103，archive.org 實測選到 avi） */
const PLAYABLE_EXT = ['mp4', 'm4v', 'webm', 'mov']
const playableExt = (f: RawFormat) => f.ext === undefined || f.ext === null || PLAYABLE_EXT.includes(String(f.ext).toLowerCase())

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** 串流需要帶的請求標頭：只留 Referer、User-Agent（不帶 Cookie，R103 第 8 節） */
function headersOf(f: RawFormat, info: Record<string, unknown>): Record<string, string> | undefined {
  const raw = (typeof f.http_headers === 'object' && f.http_headers) || (typeof info.http_headers === 'object' && info.http_headers)
  if (!raw) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === 'string' && /^(referer|user-agent)$/i.test(k)) out[k] = v
  return Object.keys(out).length ? out : undefined
}

/** 一個網頁有多部影片（yt-dlp 回傳清單）時用第一部有格式的（R103） */
function firstVideo(info: Record<string, unknown>): Record<string, unknown> | null {
  if (info._type !== 'playlist') return info
  const entries = Array.isArray(info.entries) ? (info.entries as unknown[]) : []
  const e = entries.find((x) => typeof x === 'object' && x !== null && Array.isArray((x as Record<string, unknown>).formats))
  return (e as Record<string, unknown> | undefined) ?? null
}

/**
 * 從 yt-dlp -J 的結果選出要播的串流（R89、R103）：
 * - HLS：優先有主清單（manifest_url）的格式（影像、聲音分開的軌道都在主清單裡，hls.js 會自己組合，也能切換畫質）；
 *   其他網站沒有主清單時用 HLS 格式本身的網址（有影像的）
 * - 沒有 HLS：影音合一、播放器能播的容器（mp4、webm…）的 http(s) 格式，YouTube 用 360p（format 18），其他網站用畫質最高的。
 *   其他網站常常不標示編碼，只排除明確標示「沒有影像」或「沒有聲音」的格式
 * - 直播只用 HLS；還沒開始的直播、沒有可以播的格式回傳 null
 */
export function pickStream(info: unknown, now: number): YtStream | null {
  if (typeof info !== 'object' || info === null) return null
  const j = firstVideo(info as Record<string, unknown>)
  if (!j) return null
  const formats = (Array.isArray(j.formats) ? j.formats : []) as RawFormat[]
  const isLive = j.is_live === true || j.live_status === 'is_live'
  // 直播的 title 後面會加上日期時間，fulltitle 是原本的名稱
  const title = str(j.fulltitle) ?? str(j.title)
  const isHls = (f: RawFormat) => String(f.protocol ?? '').startsWith('m3u8')
  const hls =
    formats.find((f) => isHls(f) && str(f.manifest_url)) ??
    formats.filter((f) => isHls(f) && str(f.url) && f.vcodec !== 'none').at(-1)
  const make = (kind: YtStream['kind'], f: RawFormat, url: string): YtStream => {
    const headers = headersOf(f, j)
    return { kind, url, isLive, title, expiresAt: expiryOf(url, now), ...(headers ? { headers } : {}) }
  }
  const hlsStream = hls ? make('hls', hls, (str(hls.manifest_url) ?? str(hls.url))!) : null
  if (isLive) return hlsStream
  if (j.live_status === 'is_upcoming') return null
  if (hlsStream) return hlsStream
  const muxed = formats.filter(
    (f) => /^https?$/.test(String(f.protocol ?? '')) && str(f.url) && f.vcodec !== 'none' && f.acodec !== 'none' && playableExt(f)
  )
  const height = (f: RawFormat) => (typeof f.height === 'number' ? f.height : 0)
  const best = muxed.find((f) => f.format_id === '18') ?? [...muxed].sort((a, b) => height(b) - height(a))[0]
  return best ? make('mp4', best, best.url as string) : null
}

/** 看起來是 yt-dlp 太舊、無法解析 YouTube 頁面的錯誤（R92） */
const OUTDATED_PATTERNS = [
  /Unable to extract/i,
  /\bnsig\b/i,
  /n challenge/i,
  /Failed to extract any player response/i,
  /player response/i,
  /Signature extraction failed/i,
  /please report this issue/i,
  /Confirm you are on the latest version/i
]

/** 確定不是 yt-dlp 的問題（影片本身、登入、網路），不需要更新 */
const NOT_OUTDATED_PATTERNS = [
  /Private video/i,
  /Video unavailable/i,
  /has been removed/i,
  /not available/i,
  /Sign in to confirm/i,
  /members-only/i,
  /age[- ]restricted|confirm your age/i,
  /This live event will begin/i,
  /Premieres in/i,
  /getaddrinfo/i,
  /timed out/i,
  /Unable to download/i,
  // 其他網站：yt-dlp 不支援這個網址是正常的，不是太舊（R111）
  /Unsupported URL/i,
  // 網站的 Cloudflare 機器人驗證，不是 yt-dlp 的問題（R114）
  /Cloudflare/i
]

/** 網站用 Cloudflare 的機器人驗證擋下 yt-dlp（R114）：可以用模擬瀏覽器重試 */
export const isCloudflareChallenge = (stderr: string) => /Cloudflare anti-bot challenge/i.test(stderr)

export function isOutdatedError(stderr: string): boolean {
  const errors = stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ERROR:'))
    .join('\n')
  if (!errors) return false
  if (NOT_OUTDATED_PATTERNS.some((p) => p.test(errors))) return false
  return OUTDATED_PATTERNS.some((p) => p.test(errors))
}

export type UpdateOutcome = 'updated' | 'latest' | 'failed'

/** yt-dlp --update-to 的輸出判斷（R92）；以 2026-11-06 實際執行的輸出為準 */
export function parseUpdateOutput(output: string, exitCode: number | null): { result: UpdateOutcome; version: string | null } {
  if (exitCode === 0) {
    const updated = /Updated yt-dlp to \S*?@?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(output)
    if (updated) return { result: 'updated', version: updated[1]! }
    const latest = /yt-dlp is up to date \(\S*?@?(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(output)
    if (latest) return { result: 'latest', version: latest[1]! }
  }
  return { result: 'failed', version: null }
}

/** 日期格式的版本號（2026.10.26、2026.10.26.123456）：取出可比較的版本，不是時回傳 null */
export function parseVersion(text: string): string | null {
  const m = /(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d+))?/.exec(text.trim())
  if (!m) return null
  return [m[1], m[2]!.padStart(2, '0'), m[3]!.padStart(2, '0'), ...(m[4] ? [m[4]] : [])].join('.')
}

/** a 比 b 新回傳正數、一樣回傳 0、比較舊回傳負數 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 更新紀錄 update.json（R91、R92） */
export interface UpdateRecord {
  /** 上次自動更新檢查的時間（毫秒）；沒有時為 0 */
  lastCheck: number
  /** 上次開啟時的程式版本；沒有時為空字串 */
  appVersion: string
}

export function normalizeUpdateRecord(raw: unknown): UpdateRecord {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    lastCheck: typeof obj.lastCheck === 'number' && Number.isFinite(obj.lastCheck) ? obj.lastCheck : 0,
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : ''
  }
}

/** 開啟時的自動更新：距離上次檢查超過 24 小時（R92 時機 1） */
export const AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
export function shouldAutoUpdate(record: UpdateRecord, now: number): boolean {
  return now - record.lastCheck >= AUTO_UPDATE_INTERVAL_MS || record.lastCheck > now
}

/** 設定選單的 yt-dlp 狀態（R93） */
export type YtDlpState = 'checking' | 'latest' | 'available' | 'unknown' | 'updating' | 'missing'

export interface YtDlpStatus {
  state: YtDlpState
  /** 使用者的 yt-dlp 的版本；還不知道時為 null */
  version: string | null
  /** GitHub 上最新的穩定版；還不知道時為 null */
  latest: string | null
}

/** 由版本與查詢結果決定狀態（不含正在檢查、正在更新） */
export function statusOf(version: string | null, latest: string | null): YtDlpState {
  if (!version) return 'missing'
  if (!latest) return 'unknown'
  return compareVersion(latest, version) > 0 ? 'available' : 'latest'
}

/** 設定選單裡顯示的文字，以及能不能點擊（R93） */
export function statusLabel(s: YtDlpStatus): { label: string; clickable: boolean } {
  const v = s.version ?? ''
  switch (s.state) {
    case 'latest':
      return { label: `yt-dlp ${v}（已是最新版）`, clickable: false }
    case 'available':
      return { label: `yt-dlp ${v}：有新版 ${s.latest}，點這裡更新`, clickable: true }
    case 'checking':
      return { label: `yt-dlp ${v}（正在檢查更新…）`, clickable: false }
    case 'unknown':
      return { label: `yt-dlp ${v}（無法檢查更新）`, clickable: true }
    case 'updating':
      return { label: 'yt-dlp 正在更新…', clickable: false }
    case 'missing':
      return { label: '找不到 yt-dlp', clickable: false }
  }
}

/** 手動更新完成後的提示（R93） */
export function updateToast(result: UpdateOutcome, version: string | null): string {
  if (result === 'updated') return `yt-dlp 已更新到 ${version ?? '最新版'}`
  if (result === 'latest') return 'yt-dlp 已經是最新版'
  return 'yt-dlp 更新失敗'
}

/** 影片代碼：11 碼的英數、_、-（主程序不信任畫面傳來的值） */
export const isVideoId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v)

/** 設定視窗「yt-dlp」分類的版本列（R96）：狀態標籤與按鈕 */
export interface YtDlpRow {
  version: string
  chip: { text: string; tone: 'ok' | 'warn' | 'busy' | 'error' | 'muted' }
  button: { label: string; enabled: boolean }
}

export function ytdlpRow(s: YtDlpStatus): YtDlpRow {
  const version = s.version ?? '—'
  switch (s.state) {
    case 'latest':
      return { version, chip: { text: '已是最新版', tone: 'ok' }, button: { label: '檢查更新', enabled: false } }
    case 'available':
      return { version, chip: { text: `有新版 ${s.latest}`, tone: 'warn' }, button: { label: `更新到 ${s.latest}`, enabled: true } }
    case 'checking':
      return { version, chip: { text: '正在檢查更新…', tone: 'busy' }, button: { label: '正在檢查…', enabled: false } }
    case 'unknown':
      return { version, chip: { text: '無法檢查更新', tone: 'muted' }, button: { label: '檢查更新', enabled: true } }
    case 'updating':
      return { version, chip: { text: '正在更新…', tone: 'busy' }, button: { label: '正在更新…', enabled: false } }
    case 'missing':
      return { version, chip: { text: '找不到 yt-dlp', tone: 'error' }, button: { label: '檢查更新', enabled: false } }
  }
}

/**
 * 串流請求標頭依「網域」套用（R110）：例如 usher.ttvnw.net 和 aps12.playlist.ttvnw.net 都是 ttvnw.net，
 * 主清單與各畫質的清單、片段常常在同一個網域的不同主機上
 */
export function streamSite(hostname: string): string {
  return getDomain(hostname) ?? hostname
}

/** 其他網站的串流要帶的標頭：Referer 是原本的網頁網址，yt-dlp 有提供時用 yt-dlp 的（R110） */
export function webStreamHeaders(pageUrl: string, fromYtdlp: Record<string, string> | undefined): Record<string, string> {
  const hasReferer = !!fromYtdlp && Object.keys(fromYtdlp).some((k) => k.toLowerCase() === 'referer')
  return { ...(hasReferer ? {} : { Referer: pageUrl }), ...fromYtdlp }
}

/**
 * 程式畫面發出的串流請求最後送出的標頭（R103、R110）：
 * 不帶 Origin、Referer（程式畫面的網址 http://127.0.0.1 會被 Twitch 拒絕、被 Dailymotion 拒絕），
 * 也不帶 Sec-Fetch-*（影片網站 A 看到 Sec-Fetch-Site: cross-site 會換成禁止播放的影片，2026-11-07 實測），
 * 再補上這個網站要求的標頭
 */
export function streamRequestHeaders(
  headers: Record<string, string>,
  extra: Record<string, string> | undefined
): Record<string, string> {
  const own = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(origin|referer|sec-fetch-.*)$/i.test(k)))
  return extra ? { ...own, ...extra } : own
}
