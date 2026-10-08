// 產生程式圖示 build/icon.png（256×256）：深色圓角底，四個彩色格子，左上格有播放符號。
// 不依賴繪圖套件：用 4×4 超取樣畫出 RGBA，再自行編碼成 PNG。執行：node scripts/make-icon.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 256
const SS = 4 // 超取樣倍數（反鋸齒）

const BG = [24, 24, 28]
const TILES = [
  [61, 139, 253], // 藍
  [38, 186, 160], // 綠
  [245, 176, 65], // 黃
  [232, 93, 117] // 紅
]
const WHITE = [255, 255, 255]

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry)
  const d1 = s(x, y, ax, ay, bx, by)
  const d2 = s(x, y, bx, by, cx, cy)
  const d3 = s(x, y, cx, cy, ax, ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

const PAD = 16
const GAP = 12
const INNER = 28
const tile = (SIZE - 2 * PAD - 2 * INNER - GAP) / 2
const tiles = [0, 1, 2, 3].map((i) => {
  const x0 = PAD + INNER + (i % 2) * (tile + GAP)
  const y0 = PAD + INNER + Math.floor(i / 2) * (tile + GAP)
  return { x0, y0, x1: x0 + tile, y1: y0 + tile, color: TILES[i] }
})
const t0 = tiles[0]
const cx = (t0.x0 + t0.x1) / 2 + 3
const cy = (t0.y0 + t0.y1) / 2
const tri = [
  [cx - 13, cy - 17],
  [cx - 13, cy + 17],
  [cx + 17, cy]
]

/** 回傳某個點的顏色與不透明度 */
function sample(x, y) {
  if (!inRoundRect(x, y, PAD, PAD, SIZE - PAD, SIZE - PAD, 44)) return null
  if (inTriangle(x, y, ...tri)) return WHITE
  for (const t of tiles) if (inRoundRect(x, y, t.x0, t.y0, t.x1, t.y1, 12)) return t.color
  return BG
}

const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
        if (c) {
          r += c[0]
          g += c[1]
          b += c[2]
          a++
        }
      }
    const o = (py * SIZE + px) * 4
    if (a) {
      rgba[o] = Math.round(r / a)
      rgba[o + 1] = Math.round(g / a)
      rgba[o + 2] = Math.round(b / a)
    }
    rgba[o + 3] = Math.round((a / (SS * SS)) * 255)
  }
}

// ---- PNG 編碼 ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.resolve('build/icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log('已產生', out, png.length, 'bytes')
