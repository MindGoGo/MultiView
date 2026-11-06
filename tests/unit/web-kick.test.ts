// R113 自動按播放鈕的挑選、R114 Cloudflare 的判斷
import { describe, expect, it } from 'vitest'
import { MIN_BUTTON_PX, pickPlayButton, PLAY_BUTTON_SELECTORS, type ButtonCandidate } from '../../src/lib/webKick'
import { isCloudflareChallenge, isOutdatedError } from '../../src/lib/ytdlp'

const VIEW = { w: 1000, h: 600 }
const btn = (x: number, y: number, w: number, h: number, extra: Partial<ButtonCandidate> = {}): ButtonCandidate => ({
  rect: { x, y, w, h },
  inLink: false,
  shown: true,
  ...extra
})

describe('挑選播放鈕（R113）', () => {
  it('常見播放器的開始鈕都在選擇器裡', () => {
    for (const sel of ['.vjs-big-play-button', '.jw-display-icon-display', '.plyr__control--overlaid', '.mejs__overlay-button'])
      expect(PLAY_BUTTON_SELECTORS).toContain(sel)
  })
  it('越大越好；一樣大時靠近中央的勝出', () => {
    expect(pickPlayButton([btn(10, 10, 40, 40), btn(450, 250, 100, 100)], VIEW)).toBe(1)
    expect(pickPlayButton([btn(0, 0, 80, 80), btn(460, 260, 80, 80)], VIEW)).toBe(1)
  })
  it('連結裡的（廣告）、看不見的、太小的、在畫面外的不選', () => {
    expect(pickPlayButton([btn(450, 250, 100, 100, { inLink: true })], VIEW)).toBe(-1)
    expect(pickPlayButton([btn(450, 250, 100, 100, { shown: false })], VIEW)).toBe(-1)
    expect(pickPlayButton([btn(450, 250, MIN_BUTTON_PX - 1, 40)], VIEW)).toBe(-1)
    expect(pickPlayButton([btn(1200, 250, 100, 100)], VIEW)).toBe(-1)
    expect(pickPlayButton([btn(450, -200, 100, 100)], VIEW)).toBe(-1)
  })
  it('有合格的就選合格的：連結裡較大的不選', () => {
    expect(pickPlayButton([btn(300, 150, 400, 300, { inLink: true }), btn(480, 280, 40, 40)], VIEW)).toBe(1)
  })
  it('沒有候選 → -1', () => {
    expect(pickPlayButton([], VIEW)).toBe(-1)
  })
})

describe('Cloudflare 的機器人驗證（R114）', () => {
  // 2026-11-07 實際的錯誤訊息
  const CF = 'ERROR: [generic] Got HTTP Error 403 caused by Cloudflare anti-bot challenge; try again with  --extractor-args "generic:impersonate"'
  it('AC1：判斷為需要用模擬瀏覽器重試；其他錯誤不重試', () => {
    expect(isCloudflareChallenge(CF)).toBe(true)
    expect(isCloudflareChallenge('ERROR: Unsupported URL: https://www.example.org/videos/1/x/')).toBe(false)
    expect(isCloudflareChallenge('ERROR: [youtube] abc: Video unavailable')).toBe(false)
  })
  it('不算 yt-dlp 太舊，不觸發更新', () => {
    expect(isOutdatedError(CF)).toBe(false)
  })
})
