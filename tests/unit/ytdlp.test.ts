// R88–R93：yt-dlp 播放的設定、解析結果判讀、錯誤判斷、更新輸出、版本比較、快取與排隊
import { describe, expect, it } from 'vitest'
import {
  compareVersion,
  DEFAULT_METHODS,
  expiryOf,
  isOutdatedError,
  isVideoId,
  needsResolve,
  normalizeMethods,
  normalizeUpdateRecord,
  parseUpdateOutput,
  parseVersion,
  pickStream,
  shouldAutoUpdate,
  statusLabel,
  statusOf,
  updateToast,
  AUTO_UPDATE_INTERVAL_MS,
  type ResolveResult,
  type UpdateOutcome,
  type YtStream
} from '../../src/lib/ytdlp'
import { AUTO_UPDATE_COOLDOWN_MS, CACHE_MARGIN_MS, createResolver } from '../../src/lib/ytdlpResolver'
import { defaultSettings, parseSettings } from '../../src/lib/settings'

const NOW = 1_793_970_000_000
const EXPIRE_S = 1_793_991_606

// 2026-11-06 實際執行 yt-dlp 2026.10.26 的結果（只留用得到的欄位）
const LIVE_INFO = {
  id: '4t4AQ15yj1M',
  live_status: 'is_live',
  is_live: true,
  title: 'christmas lofi radio 🎄 cozy ambience to relax to 2026-11-06 21:00',
  fulltitle: 'christmas lofi radio 🎄 cozy ambience to relax to',
  formats: [
    { format_id: '233', protocol: 'm3u8_native', vcodec: 'none', manifest_url: `https://manifest.googlevideo.com/api/manifest/hls_variant/expire/${EXPIRE_S}/ei/x/file/index.m3u8`, url: 'https://manifest.googlevideo.com/a.m3u8' },
    { format_id: '270', protocol: 'm3u8_native', vcodec: 'avc1.640028', acodec: 'none', manifest_url: `https://manifest.googlevideo.com/api/manifest/hls_variant/expire/${EXPIRE_S}/ei/x/file/index.m3u8`, url: 'https://manifest.googlevideo.com/b.m3u8' }
  ]
}
const VOD_INFO = {
  id: 'dQw4w9WgXcQ',
  live_status: 'not_live',
  is_live: false,
  title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
  formats: [
    { format_id: '139', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.5', url: 'https://rr2---sn-x.googlevideo.com/videoplayback?a=1' },
    { format_id: '18', protocol: 'https', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', url: `https://rr2---sn-x.googlevideo.com/videoplayback?expire=${EXPIRE_S}&itag=18` },
    { format_id: '137', protocol: 'https', vcodec: 'avc1.640028', acodec: 'none', url: 'https://rr2---sn-x.googlevideo.com/videoplayback?itag=137' }
  ]
}

// 2026-11-06 實際執行 yt-dlp --update-to stable 的輸出
const UPDATE_UPDATED = `Current version: stable@2026.10.21 from yt-dlp/yt-dlp
Latest version: stable@2026.10.26 from yt-dlp/yt-dlp
Current Build Hash: 33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555
Updating to stable@2026.10.26 from yt-dlp/yt-dlp ...
Updated yt-dlp to stable@2026.10.26 from yt-dlp/yt-dlp`
const UPDATE_LATEST = `Latest version: stable@2026.10.26 from yt-dlp/yt-dlp
yt-dlp is up to date (stable@2026.10.26 from yt-dlp/yt-dlp)`

describe('播放方式的設定（R88）', () => {
  it('預設兩組都是內嵌播放器，不需要解析', () => {
    expect(DEFAULT_METHODS).toEqual({ live: 'embed', vod: 'embed' })
    expect(needsResolve(DEFAULT_METHODS)).toBe(false)
    expect(needsResolve({ live: 'ytdlp', vod: 'embed' })).toBe(true)
    expect(needsResolve({ live: 'embed', vod: 'ytdlp' })).toBe(true)
  })
  it('不合法的值視為內嵌播放器', () => {
    expect(normalizeMethods(undefined)).toEqual(DEFAULT_METHODS)
    expect(normalizeMethods({ live: 'ytdlp', vod: 'x' })).toEqual({ live: 'ytdlp', vod: 'embed' })
  })
  it('AC5：0.6.1 的設定檔沒有這個欄位 → 兩組都是內嵌播放器', () => {
    const old = { ...defaultSettings() } as Record<string, unknown>
    delete old.youtubeMethods
    const { settings, corrupt } = parseSettings(JSON.stringify(old))
    expect(corrupt).toBe(false)
    expect(settings.youtubeMethods).toEqual(DEFAULT_METHODS)
  })
  it('AC4：保存後再讀取，選擇不變', () => {
    const s = { ...defaultSettings(), youtubeMethods: { live: 'ytdlp' as const, vod: 'embed' as const } }
    expect(parseSettings(JSON.stringify(s)).settings.youtubeMethods).toEqual({ live: 'ytdlp', vod: 'embed' })
  })
})

describe('解析結果（R89）', () => {
  it('直播：HLS 主清單、直播、原本的影片名稱（不含日期時間）', () => {
    const s = pickStream(LIVE_INFO, NOW)!
    expect(s.kind).toBe('hls')
    expect(s.url).toContain('/hls_variant/')
    expect(s.isLive).toBe(true)
    expect(s.title).toBe('christmas lofi radio 🎄 cozy ambience to relax to')
    expect(s.expiresAt).toBe(EXPIRE_S * 1000)
  })
  it('一般影片有主清單 → HLS 主清單（可選畫質），不用 360p', () => {
    const info = { ...VOD_INFO, formats: [...VOD_INFO.formats, ...LIVE_INFO.formats] }
    const s = pickStream(info, NOW)!
    expect(s).toMatchObject({ kind: 'hls', isLive: false })
    expect(s.url).toContain('/hls_variant/')
  })
  it('一般影片沒有主清單：影音合一的 360p（format 18）', () => {
    const s = pickStream(VOD_INFO, NOW)!
    expect(s.kind).toBe('mp4')
    expect(s.url).toContain('itag=18')
    expect(s.isLive).toBe(false)
    expect(s.expiresAt).toBe(EXPIRE_S * 1000)
  })
  it('一般影片沒有 format 18 時用其他影音合一的格式', () => {
    const info = { ...VOD_INFO, formats: [VOD_INFO.formats[0], { ...VOD_INFO.formats[1], format_id: '22' }] }
    expect(pickStream(info, NOW)!.url).toContain('itag=18')
  })
  it('一般影片只有 HLS（剛結束的直播）→ HLS', () => {
    const info = { ...LIVE_INFO, live_status: 'post_live', is_live: false }
    const s = pickStream(info, NOW)!
    expect(s).toMatchObject({ kind: 'hls', isLive: false })
  })
  it('沒有可以播的格式、還沒開始的直播、不是物件 → null', () => {
    expect(pickStream({ ...VOD_INFO, formats: [VOD_INFO.formats[0]] }, NOW)).toBeNull()
    expect(pickStream({ live_status: 'is_upcoming', formats: VOD_INFO.formats }, NOW)).toBeNull()
    expect(pickStream({ is_live: true, formats: VOD_INFO.formats }, NOW)).toBeNull()
    expect(pickStream(null, NOW)).toBeNull()
  })
  it('有效期限：query 的 expire=、路徑的 /expire/、都沒有時 5 小時後', () => {
    expect(expiryOf(`https://x/videoplayback?expire=${EXPIRE_S}&a=1`, NOW)).toBe(EXPIRE_S * 1000)
    expect(expiryOf(`https://x/api/manifest/hls_variant/expire/${EXPIRE_S}/ei/x`, NOW)).toBe(EXPIRE_S * 1000)
    expect(expiryOf('https://x/a.mp4', NOW)).toBe(NOW + 5 * 60 * 60 * 1000)
  })
  it('影片代碼的檢查（主程序不信任畫面傳來的值）', () => {
    expect(isVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isVideoId('dQw4w9WgXc')).toBe(false)
    expect(isVideoId('dQw4w9WgXcQ&x')).toBe(false)
    expect(isVideoId(123)).toBe(false)
  })
})

describe('yt-dlp 太舊的錯誤（R92）', () => {
  it('無法解析頁面 → 太舊', () => {
    expect(isOutdatedError('ERROR: [youtube] abc: Unable to extract yt initial data; please report this issue')).toBe(true)
    expect(isOutdatedError('ERROR: [youtube] abc: Failed to extract any player response')).toBe(true)
    expect(isOutdatedError('WARNING: [youtube] nsig extraction failed\nERROR: [youtube] abc: nsig extraction failed: Some formats may be missing')).toBe(true)
  })
  it('影片本身、登入、網路的問題 → 不是太舊', () => {
    // 2026-11-06 實際的錯誤訊息
    expect(isOutdatedError('ERROR: [youtube] jfKfPfyJRdk: This live stream recording is not available.')).toBe(false)
    expect(isOutdatedError('ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access to this video')).toBe(false)
    expect(isOutdatedError('ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader')).toBe(false)
    expect(isOutdatedError('ERROR: [youtube] abc: Sign in to confirm you’re not a bot.')).toBe(false)
    expect(isOutdatedError('ERROR: [youtube] abc: This live event will begin in 3 hours.')).toBe(false)
    expect(isOutdatedError('ERROR: [youtube] abc: Unable to download API page: <urlopen error [Errno 11001] getaddrinfo failed>')).toBe(false)
  })
  it('只有警告、沒有錯誤 → 不是太舊', () => {
    expect(isOutdatedError('WARNING: [youtube] Unable to extract something')).toBe(false)
    expect(isOutdatedError('')).toBe(false)
  })
})

describe('更新的輸出與版本（R92、R93）', () => {
  it('已更新、已是最新版、失敗', () => {
    expect(parseUpdateOutput(UPDATE_UPDATED, 0)).toEqual({ result: 'updated', version: '2026.10.26' })
    expect(parseUpdateOutput(UPDATE_LATEST, 0)).toEqual({ result: 'latest', version: '2026.10.26' })
    expect(parseUpdateOutput('ERROR: Unable to obtain version info (<urlopen error>)', 1)).toEqual({ result: 'failed', version: null })
    expect(parseUpdateOutput('', null)).toEqual({ result: 'failed', version: null })
    // 結束碼不是 0 時，即使有文字也算失敗
    expect(parseUpdateOutput(UPDATE_UPDATED, 1).result).toBe('failed')
  })
  it('版本號的解析與比較', () => {
    expect(parseVersion('2026.10.26\n')).toBe('2026.10.26')
    expect(parseVersion('2026.1.5')).toBe('2026.01.05')
    expect(parseVersion('stable@2026.10.26.123456')).toBe('2026.10.26.123456')
    expect(parseVersion('abc')).toBeNull()
    expect(compareVersion('2026.10.26', '2026.10.21')).toBeGreaterThan(0)
    expect(compareVersion('2026.10.26', '2026.10.26')).toBe(0)
    expect(compareVersion('2026.09.30', '2026.10.01')).toBeLessThan(0)
    expect(compareVersion('2026.10.26.1', '2026.10.26')).toBeGreaterThan(0)
  })
  it('更新紀錄：讀不到或格式錯誤時當作從來沒檢查過、程式版本不同', () => {
    expect(normalizeUpdateRecord(null)).toEqual({ lastCheck: 0, appVersion: '' })
    expect(normalizeUpdateRecord({ lastCheck: 'x', appVersion: 1 })).toEqual({ lastCheck: 0, appVersion: '' })
    expect(normalizeUpdateRecord({ lastCheck: 5, appVersion: '0.7.0' })).toEqual({ lastCheck: 5, appVersion: '0.7.0' })
  })
  it('R92 AC1：開啟時的自動更新，24 小時內不重複', () => {
    const h = 60 * 60 * 1000
    expect(shouldAutoUpdate({ lastCheck: NOW - 23 * h, appVersion: '' }, NOW)).toBe(false)
    expect(shouldAutoUpdate({ lastCheck: NOW - 25 * h, appVersion: '' }, NOW)).toBe(true)
    expect(shouldAutoUpdate({ lastCheck: NOW - AUTO_UPDATE_INTERVAL_MS, appVersion: '' }, NOW)).toBe(true)
    expect(shouldAutoUpdate(normalizeUpdateRecord(null), NOW)).toBe(true)
    // 時間在未來（電腦時間被改過）也檢查
    expect(shouldAutoUpdate({ lastCheck: NOW + h, appVersion: '' }, NOW)).toBe(true)
  })
})

describe('設定選單的 yt-dlp 狀態（R93）', () => {
  it('狀態的判斷', () => {
    expect(statusOf(null, '2026.10.26')).toBe('missing')
    expect(statusOf('2026.10.26', null)).toBe('unknown')
    expect(statusOf('2026.10.21', '2026.10.26')).toBe('available')
    expect(statusOf('2026.10.26', '2026.10.26')).toBe('latest')
    // 使用者的比 GitHub 的新（例如 nightly）也算最新版
    expect(statusOf('2026.10.27', '2026.10.26')).toBe('latest')
  })
  it('每種狀態的文字與能不能點擊', () => {
    const v = { version: '2026.10.21', latest: '2026.10.26' }
    expect(statusLabel({ ...v, state: 'latest', version: '2026.10.26' })).toEqual({ label: 'yt-dlp 2026.10.26（已是最新版）', clickable: false })
    expect(statusLabel({ ...v, state: 'available' })).toEqual({ label: 'yt-dlp 2026.10.21：有新版 2026.10.26，點這裡更新', clickable: true })
    expect(statusLabel({ ...v, state: 'checking' })).toEqual({ label: 'yt-dlp 2026.10.21（正在檢查更新…）', clickable: false })
    expect(statusLabel({ ...v, state: 'unknown' })).toEqual({ label: 'yt-dlp 2026.10.21（無法檢查更新）', clickable: true })
    expect(statusLabel({ ...v, state: 'updating' })).toEqual({ label: 'yt-dlp 正在更新…', clickable: false })
    expect(statusLabel({ ...v, state: 'missing', version: null })).toEqual({ label: '找不到 yt-dlp', clickable: false })
  })
  it('手動更新的提示', () => {
    expect(updateToast('updated', '2026.10.26')).toBe('yt-dlp 已更新到 2026.10.26')
    expect(updateToast('latest', '2026.10.26')).toBe('yt-dlp 已經是最新版')
    expect(updateToast('failed', null)).toBe('yt-dlp 更新失敗')
  })
})

// ---- 快取、排隊與更新的協調 ----

const stream = (id: string, expiresAt = NOW + 6 * 60 * 60 * 1000): YtStream => ({
  kind: 'hls',
  url: `https://x/${id}`,
  isLive: true,
  title: id,
  expiresAt
})

/** 可以手動控制完成時間的假 yt-dlp */
function fakeDeps(opts: { results?: (id: string, call: number) => ResolveResult; update?: UpdateOutcome } = {}) {
  let now = NOW
  const runs: { id: string; finish: () => void }[] = []
  const calls: string[] = []
  let running = 0
  let maxRunning = 0
  const updates: { finish: () => void }[] = []
  const perId = new Map<string, number>()
  const deps = {
    now: () => now,
    run: (id: string) =>
      new Promise<ResolveResult>((resolve) => {
        calls.push(id)
        const n = (perId.get(id) ?? 0) + 1
        perId.set(id, n)
        running++
        maxRunning = Math.max(maxRunning, running)
        runs.push({
          id,
          finish: () => {
            running--
            resolve(opts.results ? opts.results(id, n) : { ok: true, stream: stream(id) })
          }
        })
      }),
    update: () =>
      new Promise<{ result: UpdateOutcome; version: string | null }>((resolve) => {
        updates.push({ finish: () => resolve({ result: opts.update ?? 'updated', version: '2026.10.26' }) })
      })
  }
  return {
    deps,
    calls,
    runs,
    updates,
    get maxRunning() {
      return maxRunning
    },
    get running() {
      return running
    },
    advance: (ms: number) => (now += ms)
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
/** 把目前所有在執行的 yt-dlp 結束，直到沒有新的 */
async function drain(f: ReturnType<typeof fakeDeps>) {
  for (let i = 0; i < 20; i++) {
    await tick()
    const r = f.runs.splice(0)
    const u = f.updates.splice(0)
    if (!r.length && !u.length) {
      await tick()
      if (!f.runs.length && !f.updates.length) return
    }
    r.forEach((x) => x.finish())
    u.forEach((x) => x.finish())
  }
}

describe('解析的快取與排隊（R89）', () => {
  it('AC8：同時解析 5 部 → 最多同時執行 3 個', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const all = Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => r.resolve(id)))
    await tick()
    expect(f.running).toBe(3)
    await drain(f)
    await all
    expect(f.maxRunning).toBe(3)
    expect(f.calls).toHaveLength(5)
  })
  it('AC7：同一部影片同時要求兩次 → 只執行一次', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const p = Promise.all([r.resolve('a'), r.resolve('a')])
    await drain(f)
    const [x, y] = await p
    expect(x).toEqual(y)
    expect(f.calls).toEqual(['a'])
  })
  it('快取到有效期限前 10 分鐘；refresh 不用快取', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const first = r.resolve('a')
    await drain(f)
    await first
    await r.resolve('a')
    expect(f.calls).toEqual(['a'])
    const refreshed = r.resolve('a', { refresh: true })
    await drain(f)
    await refreshed
    expect(f.calls).toEqual(['a', 'a'])
    f.advance(6 * 60 * 60 * 1000 - CACHE_MARGIN_MS)
    const expired = r.resolve('a')
    await drain(f)
    await expired
    expect(f.calls).toEqual(['a', 'a', 'a'])
  })
  it('失敗不快取：下次重新解析（R90 AC5：重試、重開時重新嘗試 yt-dlp）', async () => {
    const f = fakeDeps({ results: (_, n) => (n === 1 ? { ok: false, reason: 'failed' } : { ok: true, stream: stream('a') }) })
    const r = createResolver(f.deps)
    const p1 = r.resolve('a')
    await drain(f)
    expect((await p1).ok).toBe(false)
    const p2 = r.resolve('a')
    await drain(f)
    expect((await p2).ok).toBe(true)
  })
  it('準備好使用者的 yt-dlp 之前不執行（R91）', async () => {
    let ready!: () => void
    const f = fakeDeps()
    const r = createResolver({ ...f.deps, ready: new Promise<void>((res) => (ready = res)) })
    const p = r.resolve('a')
    await tick()
    expect(f.calls).toEqual([])
    ready()
    await drain(f)
    await p
    expect(f.calls).toEqual(['a'])
  })
  it('執行時丟出例外 → 視為失敗，不影響之後的解析', async () => {
    const f = fakeDeps()
    let first = true
    const r = createResolver({
      ...f.deps,
      run: (id) => {
        if (first) {
          first = false
          return Promise.reject(new Error('boom'))
        }
        return f.deps.run(id)
      }
    })
    expect(await r.resolve('a')).toEqual({ ok: false, reason: 'failed' })
    const p = r.resolve('b')
    await drain(f)
    expect((await p).ok).toBe(true)
  })
})

const outdatedFirst = (id: string, n: number): ResolveResult =>
  n === 1 ? { ok: false, reason: 'outdated' } : { ok: true, stream: stream(id) }

describe('太舊時自動更新再試一次（R92）', () => {
  it('AC2：太舊 → 更新成功 → 重新解析成功', async () => {
    const f = fakeDeps({ results: outdatedFirst })
    const r = createResolver(f.deps)
    const p = r.resolve('a')
    await drain(f)
    expect((await p).ok).toBe(true)
    expect(f.calls).toEqual(['a', 'a'])
  })
  it('已經是最新版或更新失敗 → 回傳太舊（由畫面退回內嵌），不重新解析', async () => {
    for (const update of ['latest', 'failed'] as const) {
      const f = fakeDeps({ results: () => ({ ok: false, reason: 'outdated' }), update })
      const r = createResolver(f.deps)
      const p = r.resolve('a')
      await drain(f)
      expect(await p).toEqual({ ok: false, reason: 'outdated' })
      expect(f.calls).toEqual(['a'])
    }
  })
  it('更新後仍然太舊 → 不再更新第二次', async () => {
    let updates = 0
    const f = fakeDeps({ results: () => ({ ok: false, reason: 'outdated' }) })
    const r = createResolver({ ...f.deps, update: () => (updates++, f.deps.update()) })
    const p = r.resolve('a')
    await drain(f)
    expect(await p).toEqual({ ok: false, reason: 'outdated' })
    expect(updates).toBe(1)
    expect(f.calls).toEqual(['a', 'a'])
  })
  it('AC3：3 部同時太舊 → 只更新一次，3 部都重新解析', async () => {
    let updates = 0
    const f = fakeDeps({ results: outdatedFirst })
    const r = createResolver({ ...f.deps, update: () => (updates++, f.deps.update()) })
    const p = Promise.all(['a', 'b', 'c'].map((id) => r.resolve(id)))
    await drain(f)
    const results = await p
    expect(results.every((x) => x.ok)).toBe(true)
    expect(updates).toBe(1)
    expect(f.calls.filter((x) => x === 'a')).toHaveLength(2)
    expect(f.calls.filter((x) => x === 'b')).toHaveLength(2)
    expect(f.calls.filter((x) => x === 'c')).toHaveLength(2)
  })
  it('自動更新之後 10 分鐘內再遇到太舊 → 不再自動更新', async () => {
    let updates = 0
    const f = fakeDeps({ results: () => ({ ok: false, reason: 'outdated' }), update: 'latest' })
    const r = createResolver({ ...f.deps, update: () => (updates++, f.deps.update()) })
    const p1 = r.resolve('a')
    await drain(f)
    await p1
    f.advance(AUTO_UPDATE_COOLDOWN_MS - 1)
    const p2 = r.resolve('b')
    await drain(f)
    expect(await p2).toEqual({ ok: false, reason: 'outdated' })
    expect(updates).toBe(1)
    f.advance(1)
    const p3 = r.resolve('c')
    await drain(f)
    await p3
    expect(updates).toBe(2)
  })
  it('解析開始後 yt-dlp 已經更新過 → 太舊時直接用新版再試，不再更新', async () => {
    let updates = 0
    const f = fakeDeps({ results: outdatedFirst })
    const r = createResolver({ ...f.deps, update: () => (updates++, f.deps.update()) })
    const pa = r.resolve('a')
    await tick()
    // a 執行中，使用者按了更新：更新等 a 結束才開始
    const up = r.update()
    f.runs.splice(0).forEach((x) => x.finish())
    await tick()
    await tick()
    f.updates.splice(0).forEach((x) => x.finish())
    await up
    await drain(f)
    expect((await pa).ok).toBe(true)
    expect(updates).toBe(1)
  })
})

describe('更新與解析的協調（R92）', () => {
  it('AC5：更新進行中送出的解析，等更新完成後才執行', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const up = r.update()
    await tick()
    expect(r.updating).toBe(true)
    const p = r.resolve('a')
    await tick()
    expect(f.calls).toEqual([])
    f.updates.splice(0).forEach((x) => x.finish())
    await up
    await drain(f)
    await p
    expect(f.calls).toEqual(['a'])
    expect(r.updating).toBe(false)
  })
  it('更新等正在執行的解析結束後才開始', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const p = r.resolve('a')
    await tick()
    const up = r.update()
    await tick()
    expect(f.updates).toHaveLength(0)
    f.runs.splice(0).forEach((x) => x.finish())
    await p
    await tick()
    await tick()
    expect(f.updates).toHaveLength(1)
    f.updates.splice(0).forEach((x) => x.finish())
    await up
  })
  it('同時要求更新（開啟時、手動）→ 共用同一次', async () => {
    let updates = 0
    const f = fakeDeps()
    const r = createResolver({ ...f.deps, update: () => (updates++, f.deps.update()) })
    const a = r.update()
    const b = r.update()
    expect(a).toBe(b)
    await drain(f)
    await a
    expect(updates).toBe(1)
  })
  it('更新成功後清掉快取（舊版解析的網址不再沿用）', async () => {
    const f = fakeDeps()
    const r = createResolver(f.deps)
    const p = r.resolve('a')
    await drain(f)
    await p
    const up = r.update()
    await drain(f)
    await up
    const p2 = r.resolve('a')
    await drain(f)
    await p2
    expect(f.calls).toEqual(['a', 'a'])
  })
})
