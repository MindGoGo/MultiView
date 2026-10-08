// 網頁來源的廣告阻擋（R17）：擋下 EasyList 中的廣告請求，並隱藏清單中的廣告元素。
// 清單隨程式打包（resources/easylist.txt），啟動時解析，不在執行時下載。
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, type Session } from 'electron'
import { FiltersEngine, Request } from '@ghostery/adblocker'
import { parse } from 'tldts-experimental'
import { isYouTubeFrame, shouldCheck, toFilterType } from '../src/lib/adblockRules'

let engine: FiltersEngine | null = null
/** 關閉廣告阻擋的網頁（webContents id） */
const disabled = new Set<number>()

function listFile(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'easylist.txt')
    : path.join(app.getAppPath(), 'resources', 'easylist.txt')
}

/** 解析打包的清單；讀不到時不阻擋，程式照常運作 */
export function loadAdblockList() {
  try {
    engine = FiltersEngine.parse(fs.readFileSync(listFile(), 'utf8'), {
      loadCosmeticFilters: true,
      loadNetworkFilters: true
    })
  } catch (err) {
    console.error('無法載入廣告清單', err)
  }
}

/** 每個網頁開始載入前由畫面設定（R17 AC2） */
export function setAdblockEnabled(webContentsId: number, enabled: boolean) {
  if (enabled) disabled.delete(webContentsId)
  else disabled.add(webContentsId)
}

export function forgetWebContents(webContentsId: number) {
  disabled.delete(webContentsId)
}

/** 只裝在網頁來源的網站資料區，YouTube 來源用的是另一個，不會經過這裡（R17 AC4） */
export function installAdblock(ses: Session) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const frameUrl = details.frame?.url
    if (!engine || !shouldCheck({ webContentsId: details.webContentsId, resourceType: details.resourceType, frameUrl }, disabled)) {
      callback({})
      return
    }
    const { match } = engine.match(
      Request.fromRawDetails({
        url: details.url,
        sourceUrl: frameUrl || details.referrer,
        type: toFilterType(details.resourceType) as Parameters<typeof Request.fromRawDetails>[0]['type']
      })
    )
    callback(match ? { cancel: true } : {})
  })

  // 網頁中的偵測程式依頁面上出現的 class / id 來要隱藏廣告元素的樣式
  ipcMain.handle('adblock:cosmetics', (event, dom: { url: string; classes: string[]; ids: string[]; hrefs: string[] }) => {
    const frameUrl = event.senderFrame?.url ?? dom.url
    if (!engine || disabled.has(event.sender.id) || isYouTubeFrame(frameUrl)) return ''
    const { hostname, domain } = parse(dom.url)
    if (!hostname) return ''
    const { styles } = engine.getCosmeticsFilters({
      url: dom.url,
      hostname,
      domain: domain ?? '',
      classes: dom.classes,
      ids: dom.ids,
      hrefs: dom.hrefs,
      getBaseRules: false,
      getInjectionRules: false,
      getExtendedRules: false
    })
    return styles
  })
}
