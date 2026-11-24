// R166（桌面版）：左下角的時間膠囊
import { describe, expect, it } from 'vitest'
import { timeChip } from '../../src/lib/progress'

const vod = { current: 15, start: 0, end: 798, live: false }
const dvr = (behind: number) => ({ current: 3600 - behind, start: 0, end: 3600, live: true })
const liveOnly = { current: 30, start: 20, end: 40, live: true }

describe('時間膠囊（R166）', () => {
  it('一般影片：目前 / 長度；拖曳中顯示拖到的位置', () => {
    expect(timeChip(vod)).toEqual({ text: '0:15 / 13:18', toLive: false })
    expect(timeChip(vod, 0.5).text).toBe('6:39 / 13:18')
  })
  it('可回放的直播：距離最新位置多久，按一下回到直播', () => {
    expect(timeChip(dvr(83))).toEqual({ text: '-1:23', toLive: true })
  })
  it('可回放的直播：接近最新位置時顯示「直播」', () => {
    expect(timeChip(dvr(3))).toEqual({ text: '直播', toLive: false })
  })
  it('可回放的直播：拖曳中顯示拖到的位置，不能按', () => {
    expect(timeChip(dvr(3), 0.5)).toEqual({ text: '-30:00', toLive: false })
  })
  it('沒有回放範圍的直播：只顯示「直播」', () => {
    expect(timeChip(liveOnly)).toEqual({ text: '直播', toLive: false })
  })
})
