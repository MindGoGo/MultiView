// YouTube 預覽縮圖（R50）。不依賴 DOM，方便測試。
// YouTube 網頁裡的縮圖資訊（非公開介面）格式：
//   <網址樣板>|<等級 0>|<等級 1>|…
//   每個等級：寬#高#張數#每列張數#每頁列數#每張間隔毫秒#頁面名稱樣板#簽章
//   網址樣板裡的 $L 換成等級編號，$N 換成頁面名稱（名稱裡的 $M 換成第幾頁），最後加上 &sigh=簽章

export interface StoryboardLevel {
  width: number
  height: number
  count: number
  cols: number
  rows: number
  intervalMs: number
  name: string
  sigh: string
}

export interface Storyboard {
  base: string
  /** 選用的等級編號與資訊 */
  level: number
  info: StoryboardLevel
}

/** 一張縮圖：在哪一頁圖片的哪個位置 */
export interface StoryboardFrame {
  url: string
  x: number
  y: number
  width: number
  height: number
  sheetWidth: number
  sheetHeight: number
}

/** 縮圖寬度不超過這個值的等級中選最大的（顯示時縮放成 160px 寬） */
const MAX_WIDTH = 320

/** 從 YouTube 網頁的 HTML 取出縮圖資訊；直播或找不到時回傳 null */
export function extractStoryboardSpec(html: string): string | null {
  const m = html.match(/"playerStoryboardSpecRenderer":\{"spec":"([^"]+)"/)
  return m ? m[1].replace(/\\u0026/g, '&') : null
}

export function parseStoryboard(spec: string): Storyboard | null {
  const [base, ...parts] = spec.split('|')
  if (!base || !base.startsWith('https://')) return null
  let best: Storyboard | null = null
  parts.forEach((part, level) => {
    const f = part.split('#')
    if (f.length < 8) return
    const [width, height, count, cols, rows, intervalMs] = f.slice(0, 6).map(Number)
    const info: StoryboardLevel = { width, height, count, cols, rows, intervalMs, name: f[6], sigh: f[7] }
    const valid = [width, height, count, cols, rows].every((n) => Number.isInteger(n) && n > 0) && intervalMs > 0
    if (!valid || width > MAX_WIDTH) return
    if (!best || width > best.info.width) best = { base, level, info }
  })
  return best
}

/** 秒數對應的縮圖；duration 是影片長度（秒） */
export function storyboardFrame(sb: Storyboard, seconds: number, duration: number): StoryboardFrame {
  const { info } = sb
  const t = Math.min(Math.max(seconds, 0), Math.max(duration, 0))
  const index = Math.min(info.count - 1, Math.floor((t * 1000) / info.intervalMs))
  const perSheet = info.cols * info.rows
  const sheet = Math.floor(index / perSheet)
  const pos = index % perSheet
  const name = info.name.replace('$M', String(sheet))
  return {
    url: `${sb.base.replace('$L', String(sb.level)).replace('$N', name)}&sigh=${info.sigh}`,
    x: (pos % info.cols) * info.width,
    y: Math.floor(pos / info.cols) * info.height,
    width: info.width,
    height: info.height,
    sheetWidth: info.cols * info.width,
    sheetHeight: info.rows * info.height
  }
}
