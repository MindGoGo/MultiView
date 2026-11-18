// 向 SponsorBlock 要片段（R161），對照手機版的 SponsorBlockClient。不直接依賴 Electron（fetch 由主程序傳入），方便測試。
import { createHash } from 'node:crypto'
import { parseSegments, sponsorRequestUrl, SPONSOR_TIMEOUT_MS, type SponsorSegment } from '../src/lib/sponsorBlock'

/** 影片 ID 的 SHA-256（十六進位小寫）的前 4 碼：隱私版 API 只送前綴，不讓伺服器知道在看哪一部。 */
export const hashPrefix = (videoId: string) => createHash('sha256').update(videoId, 'utf8').digest('hex').slice(0, 4)

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number
  text(): Promise<string>
}>

/**
 * 同一部影片在程式執行期間只抓一次（記憶體快取，好幾格同一部影片也共用同一個請求）；
 * 成功的結果（包含 404 的「沒有片段」）留在快取，失敗、逾時當作沒有片段、不放進快取（下次建立播放器時再試）。
 * 一律要全部的類別，依設定過濾在畫面那一側。
 */
export function createSponsorClient(fetch: Fetch, timeoutMs = SPONSOR_TIMEOUT_MS) {
  const requests = new Map<string, Promise<SponsorSegment[] | null>>()

  const load = async (videoId: string): Promise<SponsorSegment[] | null> => {
    try {
      const res = await fetch(sponsorRequestUrl(hashPrefix(videoId)), {
        headers: { 'User-Agent': 'MultiView' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.status === 404) return []
      if (res.status !== 200) return null
      return parseSegments(await res.text(), videoId)
    } catch {
      return null
    }
  }

  return {
    /** 這部影片的片段（還沒依設定過濾）；沒有、失敗或逾時時是空的。 */
    async segments(videoId: string): Promise<SponsorSegment[]> {
      let request = requests.get(videoId)
      if (!request) {
        request = load(videoId)
        requests.set(videoId, request)
        void request.then((r) => r === null && requests.get(videoId) === request && requests.delete(videoId))
      }
      return (await request) ?? []
    }
  }
}
