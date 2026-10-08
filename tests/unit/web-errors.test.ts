// R16：網頁來源的錯誤判斷
import { describe, expect, it } from 'vitest'
import { isHttpFailure, isLoadFailure, LOAD_TIMEOUT_MS, WEB_FAILURE_TEXT } from '../../src/lib/webErrors'

describe('isLoadFailure（R16）', () => {
  it.each([
    [-105, 'ERR_NAME_NOT_RESOLVED：找不到網站（AC1）'],
    [-102, 'ERR_CONNECTION_REFUSED'],
    [-118, 'ERR_CONNECTION_TIMED_OUT'],
    [-200, 'ERR_CERT_COMMON_NAME_INVALID：憑證錯誤'],
    [-202, 'ERR_CERT_AUTHORITY_INVALID：憑證錯誤']
  ])('主框架 %i 算載入失敗（%s）', (code) => {
    expect(isLoadFailure(code, true)).toBe(true)
  })

  it('ERR_ABORTED（-3，被新的導覽取代）不算', () => {
    expect(isLoadFailure(-3, true)).toBe(false)
  })

  it('AC7：子框架（圖片、廣告等）失敗不算', () => {
    expect(isLoadFailure(-105, false)).toBe(false)
  })

  it('沒有錯誤碼不算', () => {
    expect(isLoadFailure(0, true)).toBe(false)
  })
})

describe('isHttpFailure（R16 AC2）', () => {
  it.each([400, 403, 404, 500, 503])('%i 算載入失敗', (status) => {
    expect(isHttpFailure(status)).toBe(true)
  })

  it.each([200, 204, 301, 304])('%i 不算', (status) => {
    expect(isHttpFailure(status)).toBe(false)
  })

  it('拿不到狀態碼時不算', () => {
    expect(isHttpFailure(null)).toBe(false)
    expect(isHttpFailure(undefined)).toBe(false)
  })
})

describe('錯誤訊息與逾時（R16）', () => {
  it('訊息文字和規格一致', () => {
    expect(WEB_FAILURE_TEXT.load).toBe('無法載入網頁')
    expect(WEB_FAILURE_TEXT.drm).toBe('這個影片有版權保護，無法播放')
  })

  it('AC6：逾時是 30 秒', () => {
    expect(LOAD_TIMEOUT_MS).toBe(30000)
  })
})
