// 左上角「這一格有聲音」的標示（R173）：樣式與顏色。主程序與畫面共用，不依賴 DOM。

/** wave-animated：跳動的音波；wave：音波（不動）；speaker：喇叭 🔊；none：不顯示 */
export type IndicatorStyle = 'wave-animated' | 'wave' | 'speaker' | 'none'
/** 音波的顏色；gradient 是上粉下紫的漸層 */
export type IndicatorColor = 'white' | 'gradient' | 'green' | 'blue' | 'orange' | 'custom'

export interface AudioIndicator {
  style: IndicatorStyle
  color: IndicatorColor
  /** 自訂的顏色（R174，`#rrggbb`）：選色器選的，color 是 custom 時使用；換回其他顏色時仍記住 */
  custom: string
}

export const INDICATOR_STYLES: { value: IndicatorStyle; label: string }[] = [
  { value: 'wave-animated', label: '跳動的音波' },
  { value: 'wave', label: '音波（不動）' },
  { value: 'speaker', label: '喇叭' },
  { value: 'none', label: '不顯示' }
]

/** 顏色的選項；css 是設定頁色塊用的背景 */
export const INDICATOR_COLORS: { value: IndicatorColor; label: string; css: string }[] = [
  { value: 'white', label: '白', css: '#ffffff' },
  { value: 'gradient', label: '粉紫漸層', css: 'linear-gradient(#ff4fa3, #7b5cff)' },
  { value: 'green', label: '綠', css: '#34c759' },
  { value: 'blue', label: '藍', css: '#4da3ff' },
  { value: 'orange', label: '橘', css: '#f5a524' }
]

/** 漸層的兩個顏色（上、下） */
export const GRADIENT_STOPS = ['#ff4fa3', '#7b5cff'] as const

/** 自訂顏色還沒選過時的顏色 */
export const DEFAULT_CUSTOM_COLOR = '#ff3b30'

export const DEFAULT_AUDIO_INDICATOR: AudioIndicator = { style: 'wave-animated', color: 'white', custom: DEFAULT_CUSTOM_COLOR }

const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** 音波的填色：單色回傳顏色，漸層回傳 null（由畫面用 SVG 的漸層） */
export function indicatorFill(setting: Pick<AudioIndicator, 'color' | 'custom'>): string | null {
  if (setting.color === 'gradient') return null
  if (setting.color === 'custom') return setting.custom
  return INDICATOR_COLORS.find((c) => c.value === setting.color)!.css
}

/** 設定檔的 audioIndicator；沒有這個欄位（舊的設定檔）或不認得的值用預設值 */
export function normalizeAudioIndicator(raw: unknown): AudioIndicator {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    style: INDICATOR_STYLES.some((s) => s.value === r.style) ? (r.style as IndicatorStyle) : DEFAULT_AUDIO_INDICATOR.style,
    color:
      INDICATOR_COLORS.some((c) => c.value === r.color) || r.color === 'custom' ? (r.color as IndicatorColor) : DEFAULT_AUDIO_INDICATOR.color,
    custom: isHexColor(r.custom) ? r.custom.toLowerCase() : DEFAULT_CUSTOM_COLOR
  }
}
