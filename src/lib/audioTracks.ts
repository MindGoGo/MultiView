// yt-dlp 播放的聲音軌（R95）：語言比對、預設選擇、選單名稱。不依賴 DOM，方便測試。

/** 播放器提供的聲音軌（hls.js 的 audioTracks：主清單 EXT-X-MEDIA 的 LANGUAGE 與 NAME） */
export interface RawAudioTrack {
  lang?: string
  name: string
}

/** YouTube 在 NAME 結尾標示的種類，例如「zh-Hant - original」「American English - dubbed-auto」 */
export type AudioKind = 'original' | 'dubbed-auto' | 'dubbed' | null

export function audioKind(name: string): AudioKind {
  const m = / - (original|dubbed-auto|dubbed)\b/i.exec(name)
  return m ? (m[1]!.toLowerCase() as AudioKind) : null
}

const HANT_REGIONS = ['tw', 'hk', 'mo']
const HANS_REGIONS = ['cn', 'sg', 'my']

/** 比對用的語言：中文分繁體、簡體；其他語言只看主要語言（R95） */
export function langKey(lang: string | undefined | null): string {
  const parts = (lang ?? '').toLowerCase().split(/[-_]/).filter(Boolean)
  const base = parts[0] ?? ''
  if (base !== 'zh') return base
  if (parts.includes('hant') || parts.some((p) => HANT_REGIONS.includes(p))) return 'zh-hant'
  if (parts.includes('hans') || parts.some((p) => HANS_REGIONS.includes(p))) return 'zh-hans'
  return 'zh'
}

const sameLang = (a: string, b: string) => a !== '' && (a === b || (a === 'zh' && b.startsWith('zh')) || (b === 'zh' && a.startsWith('zh')))

/** 選單裡的一條聲音軌：index 是播放器聲音軌的位置 */
export interface AudioOption {
  index: number
  lang: string
  kind: AudioKind
  label: string
}

const KIND_LABEL: Record<NonNullable<AudioKind>, string> = {
  original: '（原本的聲音）',
  'dubbed-auto': '（AI 配音）',
  dubbed: '（配音）'
}

function languageName(lang: string): string {
  if (!lang) return '未知語言'
  try {
    return new Intl.DisplayNames(['zh-Hant'], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

/** 不同的聲音軌（語言＋種類相同的只列一次，取第一條），依播放器的順序 */
export function audioOptions(tracks: RawAudioTrack[]): AudioOption[] {
  const seen = new Set<string>()
  const out: AudioOption[] = []
  tracks.forEach((t, index) => {
    const lang = t.lang ?? ''
    const kind = audioKind(t.name)
    const key = `${lang.toLowerCase()}|${kind ?? t.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ index, lang, kind, label: `${languageName(lang)}${kind ? KIND_LABEL[kind] : ''}` })
  })
  return out
}

/** 播放器目前用的聲音軌對應到選單的哪一項（語言＋種類相同的算同一項） */
export function currentOption(tracks: RawAudioTrack[], options: AudioOption[], current: number): number {
  const t = tracks[current]
  if (!t) return -1
  const o = options.find((x) => x.lang === (t.lang ?? '') && x.kind === audioKind(t.name))
  return o ? o.index : current
}

/**
 * 要用哪一條聲音軌（R95）：這一格記住的語言 → 系統語言 → 原本的聲音 → 第一條。
 * 同一種語言有原本的聲音和配音時，優先原本的聲音。沒有聲音軌時回傳 -1。
 */
export function pickAudioTrack(tracks: RawAudioTrack[], saved: string | null, system: string): number {
  if (tracks.length === 0) return -1
  const byLang = (lang: string | null) => {
    const key = langKey(lang)
    const matches = tracks.map((t, i) => ({ t, i })).filter(({ t }) => sameLang(langKey(t.lang), key))
    if (matches.length === 0) return -1
    return (matches.find(({ t }) => audioKind(t.name) === 'original') ?? matches[0]!).i
  }
  if (saved) {
    const i = byLang(saved)
    if (i >= 0) return i
  }
  const i = byLang(system)
  if (i >= 0) return i
  const original = tracks.findIndex((t) => audioKind(t.name) === 'original')
  return original >= 0 ? original : 0
}
