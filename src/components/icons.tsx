// 工具列與設定視窗的圖示（R96、R97）：16×16 的線條圖示，顏色跟著文字，不從網路載入
import type { ReactNode } from 'react'
import type { LayoutId } from '../lib/layout'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 版型的格子排列（R97） */
export function LayoutIcon({ id }: { id: LayoutId }) {
  const frame = <rect x="1.5" y="2.5" width="13" height="11" rx="1.8" />
  const lines: Record<LayoutId, ReactNode> = {
    '1': null,
    '2': <path d="M8 2.5v11" />,
    '2x2': <path d="M8 2.5v11M1.5 8h13" />,
    '3x3': <path d="M5.83 2.5v11M10.17 2.5v11M1.5 6.17h13M1.5 9.83h13" />,
    '1+3': <path d="M10 2.5v11M10 6.17h4.5M10 9.83h4.5" />
  }
  return (
    <Icon>
      {frame}
      {lines[id]}
    </Icon>
  )
}

export const PlayIcon = () => (
  <Icon>
    <path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor" />
  </Icon>
)

export const PauseIcon = () => (
  <Icon>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2.2" />
  </Icon>
)

export const MuteIcon = () => (
  <Icon>
    <path d="M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5z" fill="currentColor" />
    <path d="M10.8 6.2l3.4 3.6M14.2 6.2l-3.4 3.6" />
  </Icon>
)

export const SunIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </Icon>
)

export const ListIcon = () => (
  <Icon>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <circle cx="2.6" cy="4" r=".6" fill="currentColor" />
    <circle cx="2.6" cy="8" r=".6" fill="currentColor" />
    <circle cx="2.6" cy="12" r=".6" fill="currentColor" />
  </Icon>
)

export const PinIcon = () => (
  <Icon>
    <path d="M6 2.5h4M6.8 2.5v4L4.5 9.2h7L9.2 6.5v-4M8 9.2v4.3" />
  </Icon>
)

export const FullscreenIcon = () => (
  <Icon>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
)

export const ExitFullscreenIcon = () => (
  <Icon>
    <path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />
  </Icon>
)

export const GearIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="4.3" />
    <circle cx="8" cy="8" r="1.7" />
    <path d="M13.10 8.00L14.60 8.00M11.61 11.61L12.67 12.67M8.00 13.10L8.00 14.60M4.39 11.61L3.33 12.67M2.90 8.00L1.40 8.00M4.39 4.39L3.33 3.33M8.00 2.90L8.00 1.40M11.61 4.39L12.67 3.33" strokeWidth="2" />
  </Icon>
)

export const MinimizeIcon = () => (
  <Icon size={14}>
    <path d="M3 8h10" strokeWidth="1.1" />
  </Icon>
)

export const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeWidth="1.1" />
  </Icon>
)

/** 設定視窗左側的分類圖示（R96） */
export const YouTubeIcon = () => (
  <Icon>
    <rect x="1.5" y="3.5" width="13" height="9" rx="2.6" />
    <path d="M6.7 6v4L10.2 8z" fill="currentColor" stroke="none" />
  </Icon>
)

export const GlobeIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8z" />
  </Icon>
)

export const DownloadToolIcon = () => (
  <Icon>
    <path d="M8 2v7.5M4.8 6.6L8 9.8l3.2-3.2M2.5 11.5v2h11v-2" />
  </Icon>
)

export const InfoIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.2v4M8 4.8v.2" />
  </Icon>
)

/** 清單的圖示（R105） */
export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
)

export const PencilIcon = () => (
  <Icon>
    <path d="M10.5 2.8l2.7 2.7-7.6 7.6H2.9v-2.7z" />
    <path d="M9 4.3l2.7 2.7" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M2.8 4.3h10.4M6.3 4.3V2.8h3.4v1.5M4 4.3l.7 8.9h6.6l.7-8.9M6.6 6.8v4M9.4 6.8v4" />
  </Icon>
)

export const RefreshIcon = () => (
  <Icon>
    <path d="M13.2 6.5A5.3 5.3 0 1 0 13 10" />
    <path d="M13.4 2.8v3.8H9.6" />
  </Icon>
)

export const ImportIcon = () => (
  <Icon>
    <path d="M8 2v7.5M4.8 6.6L8 9.8l3.2-3.2M2.5 11.5v2h11v-2" />
  </Icon>
)

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon size={14}>
    <path d={open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
  </Icon>
)

export const StarIcon = ({ filled }: { filled: boolean }) => (
  <Icon>
    <path
      d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
)

export const UnsubscribeIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.2 8h5.6" />
  </Icon>
)

/** YouTube 的紅色標誌樣式（R107）：紅色圓角長方形＋白色播放三角形，顏色固定不跟著文字 */
export const YouTubeLogo = ({ size = 18 }: { size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <rect x="0.8" y="3" width="14.4" height="10" rx="3" fill="#ff0033" />
    <path d="M6.6 5.7v4.6L10.6 8z" fill="#fff" />
  </svg>
)
