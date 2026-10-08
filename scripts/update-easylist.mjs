// 更新打包用的廣告清單（R17）：下載最新的 EasyList 主清單到 resources/easylist.txt。
// 程式執行時不下載清單；更新後要重新打包（npm run dist）才會生效。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://easylist.to/easylist/easylist.txt'
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'easylist.txt')

const res = await fetch(URL)
if (!res.ok) throw new Error(`下載失敗：${res.status} ${res.statusText}`)
const text = await res.text()
if (!text.startsWith('[Adblock Plus')) throw new Error('下載的內容不是廣告清單')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, text)
const version = /^! Version: (\S+)/m.exec(text)?.[1] ?? '未知'
console.log(`已更新 ${out}（版本 ${version}）`)
