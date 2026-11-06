// 下載打包用的 yt-dlp（R91）到 vendor/yt-dlp.exe，用固定的 SHA-256 檢查。
// 已存在而且雜湊正確就略過。升級內附的版本時改下面兩個常數。
// 程式執行時用的是 %APPDATA%\MultiView\bin 裡的那一份，會自己更新（R92），不必為此重新打包。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const VERSION = '2026.10.26'
const SHA256 = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'

const URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp.exe`
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'yt-dlp.exe')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

if (fs.existsSync(out) && sha256(fs.readFileSync(out)) === SHA256) {
  console.log(`yt-dlp ${VERSION} 已存在，略過下載`)
} else {
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`下載失敗：${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== SHA256) {
    fs.rmSync(out, { force: true })
    throw new Error('下載的 yt-dlp 雜湊不符')
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buf)
  console.log(`已下載 ${out}（版本 ${VERSION}）`)
}
