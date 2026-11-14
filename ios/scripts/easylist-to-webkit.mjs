#!/usr/bin/env node
// 把 EasyList 轉成 WebKit 的內容阻擋規則（WKContentRuleList，規格 ios-app R138）。
// 在編譯時執行，App 裡只放轉好的規則。執行：node ios/scripts/easylist-to-webkit.mjs <easylist.txt> <輸出資料夾>
//
// WebKit 的規則有限制：網址比對只支援簡單的正規表示式（不能用 |、{n}），網域必須是小寫英數，
// 一份清單編譯失敗時整份都不能用。所以只轉換有把握的規則，其他的略過，並且分成幾份清單，
// 一份失敗時其他的照常使用（App 會略過編譯失敗的那一份）。
import fs from 'node:fs'
import path from 'node:path'

const NETWORK_CHUNK = 10000
const SELECTORS_PER_RULE = 100
const COSMETIC_CHUNK = 10000

/** EasyList 的請求類型 → WebKit 的 resource-type */
const TYPES = {
  script: 'script',
  image: 'image',
  stylesheet: 'style-sheet',
  subdocument: 'document',
  xmlhttprequest: 'fetch',
  media: 'media',
  font: 'font',
  ping: 'ping',
  websocket: 'websocket',
  other: 'other',
  object: 'other'
}
/** 不影響比對、可以忽略的選項 */
const IGNORED_OPTIONS = new Set(['match-case', 'important'])
/** WebKit 做不到的 CSS 選擇器（擴充語法） */
const UNSUPPORTED_SELECTOR = /:-abp-|:has-text|:contains|:xpath|:upward|:remove|:style|:matches-css|:matches-path|:min-text-length|:watch-attr|:others|:if\(|:if-not|:nth-ancestor|:matches-attr|:matches-prop/

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s)

/** EasyList 的網域（a.com、~b.com）→ WebKit 的網域；不支援的（例如 google.*）回傳 null */
function webkitDomain(domain) {
  const d = domain.toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(d) || d.startsWith('.') || d.endsWith('.') || !d.includes('.')) return null
  // * 開頭表示也包括子網域
  return `*${d}`
}

/** 把 domain=… 或 a.com,~b.com 拆成要套用與要排除的網域；有不支援的網域時回傳 null */
function splitDomains(list, separator) {
  const include = []
  const exclude = []
  for (const raw of list.split(separator)) {
    if (!raw) continue
    const negated = raw.startsWith('~')
    const d = webkitDomain(negated ? raw.slice(1) : raw)
    if (!d) return null
    ;(negated ? exclude : include).push(d)
  }
  return { include, exclude }
}

/** EasyList 的網址樣式 → WebKit 的 url-filter；不支援時回傳 null */
export function urlFilter(pattern) {
  if (!pattern || !isAscii(pattern)) return null
  let p = pattern
  let prefix = ''
  let suffix = ''
  if (p.startsWith('||')) {
    prefix = '^[a-z][a-z0-9+.-]*://([^/]*\\.)?'
    p = p.slice(2)
  } else if (p.startsWith('|')) {
    prefix = '^'
    p = p.slice(1)
  }
  if (p.endsWith('|')) {
    suffix = '$'
    p = p.slice(0, -1)
  }
  // 結尾的 ^ 也可以是網址的結尾，WebKit 不能寫「或」，所以直接拿掉（範圍稍微大一點）
  while (p.endsWith('^')) p = p.slice(0, -1)
  if (!p && !prefix) return null
  let out = ''
  for (const ch of p) {
    if (ch === '*') out += '.*'
    else if (ch === '^') out += '[/:?=&]'
    else if ('.+?$()[]{}\\|'.includes(ch)) out += '\\' + ch
    else out += ch
  }
  // 太短、太寬的樣式容易誤擋
  if (!prefix && out.replace(/\.\*/g, '').length < 4) return null
  return prefix + out + suffix
}

/** 一條網路規則 → WebKit 規則；不支援時回傳 null */
export function networkRule(line) {
  let text = line
  const exception = text.startsWith('@@')
  if (exception) text = text.slice(2)
  // 正規表示式的規則：WebKit 的語法不同，略過
  if (text.startsWith('/') && text.endsWith('/')) return null

  let options = []
  const dollar = text.lastIndexOf('$')
  if (dollar >= 0 && !text.slice(dollar).includes('/')) {
    options = text.slice(dollar + 1).split(',')
    text = text.slice(0, dollar)
  }

  const trigger = {}
  const types = new Set()
  const notTypes = new Set()
  let caseSensitive = false
  for (const raw of options) {
    const option = raw.trim()
    const negated = option.startsWith('~')
    const name = negated ? option.slice(1) : option
    if (name === 'third-party' || name === '3p') {
      trigger['load-type'] = [negated ? 'first-party' : 'third-party']
    } else if (name === 'first-party' || name === '1p') {
      trigger['load-type'] = [negated ? 'third-party' : 'first-party']
    } else if (name.startsWith('domain=')) {
      const domains = splitDomains(name.slice(7), '|')
      if (!domains) return null
      // WebKit 的一條規則不能同時有套用與排除的網域
      if (domains.include.length && domains.exclude.length) return null
      if (domains.include.length) trigger['if-domain'] = domains.include
      if (domains.exclude.length) trigger['unless-domain'] = domains.exclude
    } else if (name === 'match-case') {
      caseSensitive = true
    } else if (TYPES[name]) {
      ;(negated ? notTypes : types).add(TYPES[name])
    } else if (IGNORED_OPTIONS.has(name)) {
      // 不影響
    } else if (exception && name === 'document') {
      // 整個網站不阻擋：交給下面的 document 例外處理
      if (!text.startsWith('||')) return null
      const host = text.slice(2).replace(/\^.*$/, '').replace(/\/.*$/, '')
      const d = webkitDomain(host)
      if (!d) return null
      return { trigger: { 'url-filter': '.*', 'if-domain': [d] }, action: { type: 'ignore-previous-rules' } }
    } else {
      // popup、csp、redirect、removeparam、elemhide 等 WebKit 做不到的選項
      return null
    }
  }
  if (notTypes.size) {
    const all = new Set(Object.values(TYPES))
    for (const t of notTypes) all.delete(t)
    for (const t of all) types.add(t)
  }

  const filter = urlFilter(text)
  if (!filter) return null
  trigger['url-filter'] = filter
  if (caseSensitive) trigger['url-filter-is-case-sensitive'] = true
  if (types.size) trigger['resource-type'] = [...types].sort()
  return { trigger, action: { type: exception ? 'ignore-previous-rules' : 'block' } }
}

/** 解析 EasyList，回傳各類規則 */
export function parseEasyList(text) {
  const block = []
  const exceptions = []
  const generic = []
  /** 網域 → 選擇器（同樣網域組合的合成一條規則） */
  const byDomains = new Map()
  /** 某些網域不隱藏的通用選擇器（#@#） */
  const genericExceptions = new Map()
  let skipped = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) continue
    const cosmetic = line.match(/^([^#]*)(##|#@#|#\?#|#\$#|#%#|#@\$#|#@\?#)(.+)$/)
    if (cosmetic) {
      const [, domainList, marker, selector] = cosmetic
      if ((marker !== '##' && marker !== '#@#') || !isAscii(selector) || UNSUPPORTED_SELECTOR.test(selector)) {
        skipped++
        continue
      }
      if (marker === '#@#') {
        const domains = domainList ? splitDomains(domainList, ',') : null
        if (!domains || !domains.include.length) {
          skipped++
          continue
        }
        const list = genericExceptions.get(selector) ?? []
        list.push(...domains.include)
        genericExceptions.set(selector, list)
        continue
      }
      if (!domainList) {
        generic.push(selector)
        continue
      }
      const domains = splitDomains(domainList, ',')
      if (!domains || (domains.include.length && domains.exclude.length) || (!domains.include.length && !domains.exclude.length)) {
        skipped++
        continue
      }
      const key = JSON.stringify(domains)
      const entry = byDomains.get(key) ?? { domains, selectors: [] }
      entry.selectors.push(selector)
      byDomains.set(key, entry)
      continue
    }
    const rule = networkRule(line)
    if (!rule) {
      skipped++
      continue
    }
    ;(rule.action.type === 'block' ? block : exceptions).push(rule)
  }

  const cosmetic = []
  // 通用的隱藏規則：沒有例外的合成一條，有例外的各自一條並排除那些網域
  const plain = generic.filter((s) => !genericExceptions.has(s))
  for (let i = 0; i < plain.length; i += SELECTORS_PER_RULE) {
    cosmetic.push({
      trigger: { 'url-filter': '.*' },
      action: { type: 'css-display-none', selector: plain.slice(i, i + SELECTORS_PER_RULE).join(', ') }
    })
  }
  for (const selector of generic.filter((s) => genericExceptions.has(s))) {
    cosmetic.push({
      trigger: { 'url-filter': '.*', 'unless-domain': [...new Set(genericExceptions.get(selector))] },
      action: { type: 'css-display-none', selector }
    })
  }
  for (const { domains, selectors } of byDomains.values()) {
    for (let i = 0; i < selectors.length; i += SELECTORS_PER_RULE) {
      const trigger = { 'url-filter': '.*' }
      if (domains.include.length) trigger['if-domain'] = domains.include
      else trigger['unless-domain'] = domains.exclude
      cosmetic.push({ trigger, action: { type: 'css-display-none', selector: selectors.slice(i, i + SELECTORS_PER_RULE).join(', ') } })
    }
  }
  return { block, exceptions, cosmetic, skipped }
}

/** 分成幾份清單。例外規則（ignore-previous-rules）只對同一份清單裡前面的規則有效，所以每一份網路規則後面都附上。 */
export function chunk({ block, exceptions, cosmetic }) {
  const lists = []
  for (let i = 0; i < block.length; i += NETWORK_CHUNK) {
    lists.push({ name: `network-${lists.length + 1}`, rules: [...block.slice(i, i + NETWORK_CHUNK), ...exceptions] })
  }
  const documentExceptions = exceptions.filter((r) => r.trigger['url-filter'] === '.*')
  for (let i = 0; i < cosmetic.length; i += COSMETIC_CHUNK) {
    lists.push({ name: `cosmetic-${lists.length + 1}`, rules: [...cosmetic.slice(i, i + COSMETIC_CHUNK), ...documentExceptions] })
  }
  return lists
}

function main() {
  const [input, outDir] = process.argv.slice(2)
  if (!input || !outDir) {
    console.error('用法：node easylist-to-webkit.mjs <easylist.txt> <輸出資料夾>')
    process.exit(1)
  }
  const text = fs.readFileSync(input, 'utf8')
  const version = text.match(/^! Version: (\S+)/m)?.[1] ?? 'unknown'
  const parsed = parseEasyList(text)
  const lists = chunk(parsed)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const manifest = { version, lists: [] }
  for (const list of lists) {
    const file = `${list.name}.json`
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(list.rules))
    manifest.lists.push({ name: list.name, file, rules: list.rules.length })
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(
    `EasyList ${version}：網路規則 ${parsed.block.length}、例外 ${parsed.exceptions.length}、隱藏 ${parsed.cosmetic.length}、略過 ${parsed.skipped}；分成 ${lists.length} 份清單`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
