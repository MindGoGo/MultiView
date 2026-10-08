// 設定檔讀寫（R10）。寫入先寫暫存檔再改名，避免寫到一半當掉造成檔案損毀。
import fs from 'node:fs'
import path from 'node:path'
import { defaultSettings, parseSettings, type Settings } from '../src/lib/settings'

export const SAVE_DELAY_MS = 300

export function loadSettings(file: string): Settings {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return defaultSettings()
  }
  const { settings, corrupt } = parseSettings(text)
  if (corrupt) {
    try {
      fs.renameSync(file, `${file}.bak`)
    } catch {
      // 改名失敗也不影響啟動，下次寫入會覆蓋
    }
  }
  return settings
}

export function writeSettings(file: string, settings: Settings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 延遲寫入：短時間內的多次變更合併成一次寫入，最晚 SAVE_DELAY_MS 後寫出。 */
export function createSaver(file: string, delay = SAVE_DELAY_MS) {
  let pending: Settings | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending) {
      writeSettings(file, pending)
      pending = null
    }
  }

  const schedule = (settings: Settings) => {
    pending = settings
    if (!timer) timer = setTimeout(flush, delay)
  }

  return { schedule, flush }
}
