// 手動驗收用的本機測試伺服器（R13–R18）。
// 同時開兩個連接埠，用來模擬跨網域的子框架：
//   http://127.0.0.1:8701/  （網域 A）
//   http://localhost:8702/  （網域 B）
// 特殊路徑：/slow 35 秒後才回應（R16 AC6）、/missing 回應 404（R16 AC2）
// mp4 支援 Range 請求，進度條才能跳轉（R19）
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp4': 'video/mp4' }

function handler(req, res) {
  const { pathname } = new URL(req.url, 'http://x')
  if (pathname === '/slow') {
    setTimeout(() => res.writeHead(200, { 'Content-Type': MIME['.html'] }).end('<h1>slow</h1>'), 35000)
    return
  }
  if (pathname === '/missing') {
    res.writeHead(404, { 'Content-Type': MIME['.html'] }).end('<h1>404</h1>')
    return
  }
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end()
    return
  }
  const type = MIME[path.extname(file)] ?? 'application/octet-stream'
  const size = fs.statSync(file).size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 })
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size })
  fs.createReadStream(file).pipe(res)
}

http.createServer(handler).listen(8701, '127.0.0.1')
http.createServer(handler).listen(8702, 'localhost')
console.log('測試頁：http://127.0.0.1:8701/ 、 http://localhost:8702/')
