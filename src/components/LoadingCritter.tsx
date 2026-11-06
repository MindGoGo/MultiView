// 讀取動畫（R99）：原創的小生物「麻糬」在格子中央彈跳，下方是「解析中…」或「載入中…」。
// 只用向量圖與 CSS 動畫，不載入外部檔案；不攔截點擊。
import { useEffect, useState } from 'react'
import { LOADING_DELAY_MS, LOADING_TEXT, type LoadingKind } from '../lib/loading'
// 主畫面與 YouTube 小視窗都會用到，樣式跟著元件（R99、R106）
import './critter.css'

/** 解析中立即顯示；載入中、緩衝中超過 0.5 秒才顯示 */
export function useLoadingVisible(kind: LoadingKind | null): LoadingKind | null {
  const [shown, setShown] = useState<LoadingKind | null>(kind === 'resolving' ? kind : null)
  useEffect(() => {
    if (kind === null) return setShown(null)
    if (kind === 'resolving') return setShown(kind)
    const timer = setTimeout(() => setShown(kind), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [kind])
  return kind === null ? null : shown
}

/** label：取代預設的「解析中…」「載入中…」（小視窗是「讀取中…」，R106） */
export function LoadingCritter({ kind, label }: { kind: LoadingKind; label?: string }) {
  const text = label ?? LOADING_TEXT[kind]
  return (
    <div className="critter" role="status" aria-label={text}>
      <svg className="critter-svg" viewBox="10 18 80 80" aria-hidden="true">
        <ellipse className="critter-shadow" cx="50" cy="93" rx="22" ry="4.5" />
        <g className="critter-body">
          {/* 圓滾滾的麻糬身體與左上的光澤 */}
          <path
            d="M50 38c19 0 32 13 32 29 0 14-12 22-32 22S18 81 18 67c0-16 13-29 32-29z"
            fill="#9fe7cb"
            stroke="#6fcfa9"
            strokeWidth="1.5"
          />
          <ellipse cx="37" cy="50" rx="8" ry="4.5" fill="#fff" opacity="0.55" transform="rotate(-25 37 50)" />
          <g className="critter-eyes">
            <circle cx="41" cy="62" r="3.4" fill="#21302b" />
            <circle cx="59" cy="62" r="3.4" fill="#21302b" />
            <circle cx="42.2" cy="60.8" r="1" fill="#fff" />
            <circle cx="60.2" cy="60.8" r="1" fill="#fff" />
          </g>
          <ellipse cx="33" cy="69" rx="4.6" ry="2.8" fill="#ff9fb3" opacity="0.75" />
          <ellipse cx="67" cy="69" rx="4.6" ry="2.8" fill="#ff9fb3" opacity="0.75" />
          <path d="M47 68.5q3 2.6 6 0" fill="none" stroke="#21302b" strokeWidth="1.6" strokeLinecap="round" />
          {/* 肚子上的播放符號 */}
          <path d="M46.5 75.5v8l7-4z" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" opacity="0.9" />
        </g>
      </svg>
      <div className="critter-label">{text}</div>
    </div>
  )
}
