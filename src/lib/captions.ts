// YouTube 字幕（R31）。不依賴 YouTube API，方便測試。

export interface CaptionTrack {
  /** 保存在設定檔的代碼：語言代碼；YouTube 自動產生的字幕前面加 asr: */
  key: string
  languageCode: string
  /** 選單顯示的名稱（YouTube 提供，繁體中文）；自動產生的加「（自動產生）」 */
  label: string
  auto: boolean
}

/** YouTube 播放器回報的字幕軌（只取用得到的欄位） */
export interface RawCaptionTrack {
  languageCode?: string
  languageName?: string
  displayName?: string
  kind?: string
}

export function toCaptionTracks(raw: RawCaptionTrack[] | null | undefined): CaptionTrack[] {
  if (!Array.isArray(raw)) return []
  const out: CaptionTrack[] = []
  for (const t of raw) {
    if (!t?.languageCode) continue
    const auto = t.kind === 'asr'
    const key = (auto ? 'asr:' : '') + t.languageCode
    if (out.some((x) => x.key === key)) continue
    const name = t.languageName || t.displayName || t.languageCode
    out.push({ key, languageCode: t.languageCode, label: auto ? `${name}（自動產生）` : name, auto })
  }
  return out
}

/**
 * 保存的選擇在這部影片要用哪一軌（R31）：先找完全相同的，再找同一種語言的（優先人工字幕）；
 * 沒有就回傳 null（關閉）。
 */
export function findCaptionTrack(tracks: CaptionTrack[], key: string | null): CaptionTrack | null {
  if (!key) return null
  const exact = tracks.find((t) => t.key === key)
  if (exact) return exact
  const code = key.replace(/^asr:/, '')
  return tracks.find((t) => t.languageCode === code && !t.auto) ?? tracks.find((t) => t.languageCode === code) ?? null
}
