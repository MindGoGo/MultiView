// YouTube 播放器裡會開新視窗的連結（R45）。不依賴 DOM，方便測試。
import { parseSource } from './source'

export type LinkAction =
  /** 在直接操作中的那一格播放這部影片 */
  | { kind: 'play'; index: number; url: string }
  /** 用系統預設的瀏覽器開啟 */
  | { kind: 'external'; url: string }
  /** 不處理（不是 http／https） */
  | { kind: 'ignore' }

/** 放入格子的 YouTube 網址：去掉播放清單、開始時間等參數，歷史紀錄才不會重複 */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/**
 * 決定連結的處理方式。
 * @param direct 直接操作中的格子；沒有時為 null
 * @param currentVideoId 那一格目前的 YouTube 影片代碼
 */
export function classifyLink(url: string, direct: number | null, currentVideoId: string | null): LinkAction {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'ignore' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'ignore' }
  const source = parseSource(url)
  if (source?.kind === 'youtube' && direct !== null && source.videoId !== currentVideoId) {
    return { kind: 'play', index: direct, url: canonicalYouTubeUrl(source.videoId) }
  }
  return { kind: 'external', url: parsed.href }
}
