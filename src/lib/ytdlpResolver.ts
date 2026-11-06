// yt-dlp 解析的快取、排隊與更新協調（R89、R92）。執行 yt-dlp 與更新由外部注入，方便測試。
import type { ResolveResult, UpdateOutcome, YtStream } from './ytdlp'

export interface ResolverDeps {
  /** 執行一次 yt-dlp 解析 */
  run(videoId: string): Promise<ResolveResult>
  /** 執行一次 yt-dlp 更新 */
  update(): Promise<{ result: UpdateOutcome; version: string | null }>
  /** 解析前要等的準備（R91：準備使用者的 yt-dlp） */
  ready?: Promise<unknown>
  now(): number
  /** 同時執行的 yt-dlp 數（R89） */
  concurrency?: number
}

/** 快取到網址有效期限前 10 分鐘（R89） */
export const CACHE_MARGIN_MS = 10 * 60 * 1000
/** 自動更新之後這段時間內，再遇到太舊的錯誤不再自動更新（R92） */
export const AUTO_UPDATE_COOLDOWN_MS = 10 * 60 * 1000

export function createResolver(deps: ResolverDeps) {
  const limit = deps.concurrency ?? 3
  const cache = new Map<string, YtStream>()
  const inflight = new Map<string, Promise<ResolveResult>>()
  let running = 0
  /** 等著開始的解析 */
  const waiting: (() => void)[] = []
  /** 正在進行的更新；更新期間新的解析排隊（R92） */
  let updating: Promise<{ result: UpdateOutcome; version: string | null }> | null = null
  /** 更新等正在執行的解析結束後才開始 */
  let idleWaiters: (() => void)[] = []
  /** 每次更新成功加一：解析開始後 yt-dlp 換過版本，太舊的錯誤直接用新版重試 */
  let generation = 0
  let lastAutoUpdate = -Infinity

  const pump = () => {
    while (!updating && running < limit && waiting.length) {
      running++
      waiting.shift()!()
    }
  }

  const finish = () => {
    running--
    if (running === 0) {
      const w = idleWaiters
      idleWaiters = []
      w.forEach((f) => f())
    }
    pump()
  }

  /** 排隊取得執行的位置，執行一次 yt-dlp */
  const runQueued = async (videoId: string): Promise<{ result: ResolveResult; generation: number }> => {
    await deps.ready
    await new Promise<void>((resolve) => {
      waiting.push(resolve)
      pump()
    })
    const gen = generation
    try {
      return { result: await deps.run(videoId), generation: gen }
    } catch {
      return { result: { ok: false, reason: 'failed' }, generation: gen }
    } finally {
      finish()
    }
  }

  /** 同一時間只進行一個更新；開始前等正在執行的解析結束（R92） */
  const update = () => {
    if (updating) return updating
    updating = (async () => {
      try {
        if (running > 0) await new Promise<void>((resolve) => idleWaiters.push(resolve))
        const r = await deps.update()
        if (r.result === 'updated') {
          generation++
          cache.clear()
        }
        return r
      } catch {
        return { result: 'failed' as const, version: null }
      } finally {
        updating = null
        pump()
      }
    })()
    return updating
  }

  const resolveOnce = async (videoId: string): Promise<ResolveResult> => {
    let { result, generation: gen } = await runQueued(videoId)
    if (!result.ok && result.reason === 'outdated') {
      if (gen !== generation) {
        // 這次解析開始後 yt-dlp 已經更新過，用新版再試一次就好
        result = (await runQueued(videoId)).result
      } else if (updating || deps.now() - lastAutoUpdate >= AUTO_UPDATE_COOLDOWN_MS) {
        if (!updating) lastAutoUpdate = deps.now()
        const r = await update()
        if (r.result === 'updated') result = (await runQueued(videoId)).result
      }
    }
    if (result.ok) cache.set(videoId, result.stream)
    return result
  }

  return {
    resolve(videoId: string, opts: { refresh?: boolean } = {}): Promise<ResolveResult> {
      const cached = cache.get(videoId)
      if (!opts.refresh && cached && deps.now() < cached.expiresAt - CACHE_MARGIN_MS) {
        return Promise.resolve({ ok: true, stream: cached })
      }
      if (opts.refresh) cache.delete(videoId)
      const pending = inflight.get(videoId)
      if (pending) return pending
      const p = resolveOnce(videoId).finally(() => inflight.delete(videoId))
      inflight.set(videoId, p)
      return p
    },
    update,
    get updating() {
      return updating !== null
    }
  }
}
