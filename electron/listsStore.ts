// 最愛與歷史清單檔的讀寫（R21）。和設定檔分開存放，其中一個損毀不影響另一個。
// 寫入先寫暫存檔再改名，避免寫到一半當掉造成檔案損毀。
import fs from 'node:fs'
import path from 'node:path'
import { emptyLists, parseLists, type Lists } from '../src/lib/lists'
import { SAVE_DELAY_MS } from './store'

export function loadLists(file: string): Lists {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return emptyLists()
  }
  const { lists, corrupt } = parseLists(text)
  // 損毀的檔案改名保留，清單從空的開始（R21 AC11）
  if (corrupt) {
    try {
      fs.renameSync(file, `${file}.bak`)
    } catch {
      // 改名失敗也不影響啟動，下次寫入會覆蓋
    }
  }
  return lists
}

export function writeLists(file: string, lists: Lists): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(lists, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 延遲寫入：短時間內的多次變更合併成一次，最晚 SAVE_DELAY_MS 後寫出（R21：1 秒內） */
export function createListsSaver(file: string, delay = SAVE_DELAY_MS) {
  let pending: Lists | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending) {
      writeLists(file, pending)
      pending = null
    }
  }
  const schedule = (lists: Lists) => {
    pending = lists
    if (!timer) timer = setTimeout(flush, delay)
  }
  return { schedule, flush }
}
