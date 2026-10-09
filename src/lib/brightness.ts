// 每格亮度與總亮度（R40、R41）。不依賴 DOM，方便測試。

export const BRIGHTNESS_MIN = 20
export const BRIGHTNESS_MAX = 150
export const BRIGHTNESS_STEP = 5
export const BRIGHTNESS_DEFAULT = 100

/** 設定檔中的亮度：限制在 20–150、以 5 為單位；不合法或沒有欄位時為 100（R40 AC7、R41 AC3） */
export function normalizeBrightness(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return BRIGHTNESS_DEFAULT
  const stepped = Math.round(raw / BRIGHTNESS_STEP) * BRIGHTNESS_STEP
  return Math.min(Math.max(stepped, BRIGHTNESS_MIN), BRIGHTNESS_MAX)
}

/** 實際亮度（%）＝ 格子亮度 × 總亮度，不另外設上限（共用定義） */
export function effectiveBrightness(cell: number, master: number): number {
  return (cell * master) / 100
}

/** 套在格子播放器容器上的 CSS 濾鏡；100% 時不套用 */
export function brightnessFilter(cell: number, master: number): string | undefined {
  const e = effectiveBrightness(cell, master)
  return e === 100 ? undefined : `brightness(${e / 100})`
}
