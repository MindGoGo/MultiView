// 網頁找不到影片時自動按播放鈕（R113）：挑選播放鈕。不依賴 DOM，方便測試。
import type { Rect } from './webVideo'

/** 常見播放器的開始鈕，以及名稱或說明含「play」「播放」的按鈕 */
export const PLAY_BUTTON_SELECTORS = [
  '.vjs-big-play-button',
  '.jw-display-icon-display',
  '.jw-icon-display',
  '.plyr__control--overlaid',
  '.fp-play',
  '.fp-ui',
  '.mejs__overlay-button',
  '.mejs-overlay-button',
  '.clappr-big-play-button',
  '.play-wrapper',
  '[class*="big-play" i]',
  '[class*="play-button" i]',
  '[class*="playbutton" i]',
  '[class*="play-btn" i]',
  '[class*="btn-play" i]',
  '[id*="play-button" i]',
  'button[aria-label*="play" i]',
  'button[title*="play" i]',
  'button[aria-label*="播放"]',
  '[role="button"][aria-label*="play" i]'
].join(',')

/** 太小的元素不是播放鈕 */
export const MIN_BUTTON_PX = 16

export interface ButtonCandidate {
  rect: Rect
  /** 是連結或在連結裡（按下去會換頁，常見於廣告），不選 */
  inLink: boolean
  /** 看得見（不是隱藏、透明） */
  shown: boolean
}

/**
 * 挑一個播放鈕：看得見、不是連結、在畫面內、至少 16×16 像素；
 * 越大越好，一樣大時越靠近畫面中央越好。沒有時回傳 -1。
 */
export function pickPlayButton(cands: ButtonCandidate[], viewport: { w: number; h: number }): number {
  let best = -1
  let bestScore = -Infinity
  cands.forEach((c, i) => {
    const { x, y, w, h } = c.rect
    if (!c.shown || c.inLink || w < MIN_BUTTON_PX || h < MIN_BUTTON_PX) return
    const visibleW = Math.min(x + w, viewport.w) - Math.max(x, 0)
    const visibleH = Math.min(y + h, viewport.h) - Math.max(y, 0)
    if (visibleW <= 0 || visibleH <= 0) return
    const cx = x + w / 2 - viewport.w / 2
    const cy = y + h / 2 - viewport.h / 2
    const dist = Math.hypot(cx, cy) / Math.hypot(viewport.w / 2, viewport.h / 2)
    // 面積為主，距離中央為輔（距離最多扣掉 30% 的分數）
    const score = visibleW * visibleH * (1 - 0.3 * Math.min(dist, 1))
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
