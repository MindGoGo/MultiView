// 正式版用本機 http 提供畫面檔案。
// YouTube 內嵌播放器需要正常的來源網址，用 file:// 載入會出現錯誤 153。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

export function startStaticServer(root: string): Promise<string> {
  const base = path.resolve(root)
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = path.resolve(base, '.' + (urlPath === '/' ? '/index.html' : urlPath))
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403).end()
      return
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(data)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}/`)
    })
  })
}
