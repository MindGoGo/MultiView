// 設定視窗（R96）：置中的視窗，左側分類、右側每一列是標題＋說明＋控制項。改了立即生效。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ytdlpRow,
  updateToast,
  YTDLP_CHANNELS,
  type PlayMethod,
  type WebMethod,
  type YouTubeMethods,
  type YtDlpChannel,
  type YtDlpStatus
} from '../lib/ytdlp'
import { LOGIN_BROWSERS, type LoginBrowser } from '../lib/googleLogin'
import { SPONSOR_CATEGORIES, type SponsorBlockSettings } from '../lib/sponsorBlock'
import { CloseIcon, DownloadToolIcon, GlobeIcon, InfoIcon, YouTubeIcon } from './icons'

export type SettingsCategory = 'youtube' | 'web' | 'ytdlp' | 'about'

const CATEGORIES: { id: SettingsCategory; label: string; icon: ReactNode }[] = [
  { id: 'youtube', label: 'YouTube 播放', icon: <YouTubeIcon /> },
  { id: 'web', label: '其他網站', icon: <GlobeIcon /> },
  { id: 'ytdlp', label: 'yt-dlp', icon: <DownloadToolIcon /> },
  { id: 'about', label: '關於', icon: <InfoIcon /> }
]

/** 上次的分類：只在這次執行期間記住，重開程式回到「YouTube 播放」（R96 AC7） */
let lastCategory: SettingsCategory = 'youtube'

interface Props {
  onClose(): void
  autoYoutubeWeb: boolean
  onAutoYoutubeWeb(on: boolean): void
  youtubeMethods: YouTubeMethods
  onYoutubeMethods(methods: YouTubeMethods): void
  /** 其他網站的播放方式（R102） */
  webMethod: WebMethod
  onWebMethod(method: WebMethod): void
  /** SponsorBlock（R161） */
  sponsorBlock: SponsorBlockSettings
  onSponsorBlock(settings: SponsorBlockSettings): void
  /** 登入 Google 用的瀏覽器（R165） */
  loginBrowser: LoginBrowser
  onLoginBrowser(browser: LoginBrowser): void
  /** 手動更新 yt-dlp 的結果（R93） */
  onToast(message: string): void
}

export function SettingsDialog(props: Props) {
  const { onClose } = props
  const [category, setCategory] = useState<SettingsCategory>(lastCategory)
  const choose = (c: SettingsCategory) => {
    lastCategory = c
    setCategory(c)
  }
  const panelRef = useRef<HTMLDivElement>(null)

  // 開著時按鍵只給設定視窗：Esc 關閉，其他快捷鍵不作用（Tab 等預設行為照常）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      if (e.key === 'Escape') onClose()
      if (e.key === 'F11') e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="settings-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={panelRef} tabIndex={-1}>
        <header className="settings-head">
          <h1 id="settings-title">設定</h1>
          <button className="settings-close" title="關閉 (Esc)" aria-label="關閉" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>
        <nav className="settings-nav" aria-label="設定分類">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`settings-nav-item ${c.id === category ? 'active' : ''}`}
              aria-current={c.id === category ? 'page' : undefined}
              onClick={() => choose(c.id)}
            >
              {c.icon}
              <span>{c.label}</span>
            </button>
          ))}
        </nav>
        <main className="settings-body">
          {category === 'youtube' && <YouTubeSection {...props} />}
          {category === 'web' && <WebSection {...props} />}
          {category === 'ytdlp' && <YtDlpSection onToast={props.onToast} />}
          {category === 'about' && <AboutSection />}
        </main>
      </div>
    </div>
  )
}

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </div>
  )
}

/** 兩段的選擇按鈕（R88 的播放方式） */
function Choice<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange(v: T): void
  label: string
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={`choice-btn ${o.value === value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange(on: boolean): void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}

const METHOD_OPTIONS: { value: PlayMethod; label: string }[] = [
  { value: 'embed', label: '內嵌播放器' },
  { value: 'ytdlp', label: 'yt-dlp' }
]

function YouTubeSection(props: Props) {
  const m = props.youtubeMethods
  return (
    <section>
      <h2 className="set-heading">YouTube 播放</h2>
      <Row
        title="直播的播放方式"
        desc="內嵌播放器是 YouTube 官方的播放器；yt-dlp 由程式直接播放，沒有廣告和 YouTube 的按鈕。"
      >
        <Choice label="直播的播放方式" value={m.live} options={METHOD_OPTIONS} onChange={(live) => props.onYoutubeMethods({ ...m, live })} />
      </Row>
      <Row title="一般影片的播放方式" desc="yt-dlp 播放時可以選畫質與語音，但不支援字幕。">
        <Choice label="一般影片的播放方式" value={m.vod} options={METHOD_OPTIONS} onChange={(vod) => props.onYoutubeMethods({ ...m, vod })} />
      </Row>
      <Row title="無法嵌入時自動改用網頁播放" desc="影片不允許在其他網站播放時，直接改用 YouTube 網頁播放。">
        <Switch label="無法嵌入時自動改用網頁播放" on={props.autoYoutubeWeb} onChange={props.onAutoYoutubeWeb} />
      </Row>
      <SponsorBlockRows settings={props.sponsorBlock} onChange={props.onSponsorBlock} />
      <LoginBrowserRow value={props.loginBrowser} onChange={props.onLoginBrowser} />
    </section>
  )
}

/** 登入 Google 用的瀏覽器（R165）：只列出電腦上有安裝的 */
function LoginBrowserRow({ value, onChange }: { value: LoginBrowser; onChange(b: LoginBrowser): void }) {
  const [installed, setInstalled] = useState<LoginBrowser[] | null>(null)
  useEffect(() => {
    void window.multiview.loginBrowsers().then((r) => setInstalled(r.installed))
  }, [])
  const options = LOGIN_BROWSERS.filter((b) => installed?.includes(b.id)).map((b) => ({ value: b.id, label: b.short }))
  // 選的瀏覽器沒有安裝時，實際用第一個有安裝的（和登入時的規則相同）
  const shown = installed?.includes(value) ? value : (options[0]?.value ?? value)
  return (
    <>
      <h2 className="set-heading set-subheading">Google 登入</h2>
      <Row
        title="登入用的瀏覽器"
        desc={
          installed === null
            ? '讀取中…'
            : options.length === 0
              ? '找不到 Microsoft Edge、Google Chrome 或 Brave，YouTube 小視窗無法登入。'
              : 'YouTube 小視窗按「登入」時開啟這個瀏覽器（全新的視窗，不會用到你平常在這個瀏覽器的帳號和資料），登入完成後自動關閉。'
        }
      >
        {options.length > 1 && <Choice label="登入用的瀏覽器" value={shown} options={options} onChange={onChange} />}
        {options.length === 1 && <span className="set-desc">{LOGIN_BROWSERS.find((b) => b.id === options[0].value)!.label}</span>}
      </Row>
    </>
  )
}

/** SponsorBlock（R161）：改了馬上套用到每一格 */
function SponsorBlockRows({ settings, onChange }: { settings: SponsorBlockSettings; onChange(s: SponsorBlockSettings): void }) {
  const toggle = (id: (typeof SPONSOR_CATEGORIES)[number]['id'], on: boolean) => {
    const set = new Set(settings.categories)
    if (on) set.add(id)
    else set.delete(id)
    onChange({ ...settings, categories: SPONSOR_CATEGORIES.map((c) => c.id).filter((c) => set.has(c)) })
  }
  return (
    <>
      <h2 className="set-heading set-subheading">SponsorBlock（跳過業配）</h2>
      <Row
        title="自動跳過片段"
        desc={
          <>
            只處理用 yt-dlp 播放的 YouTube 一般影片。每部影片只向 SponsorBlock 要一次資料（幾 KB），而且只送出影片代碼雜湊的前 4 碼，伺服器不知道你在看哪一部。
            片段資料來自 SponsorBlock（sponsor.ajay.app）的社群標記，授權 CC BY-NC-SA 4.0。
          </>
        }
      >
        <Switch label="自動跳過片段" on={settings.enabled} onChange={(enabled) => onChange({ ...settings, enabled })} />
      </Row>
      {settings.enabled && (
        <div className="set-categories" role="group" aria-label="要跳過的片段">
          {SPONSOR_CATEGORIES.map((c) => (
            <label key={c.id} className="set-check">
              <input type="checkbox" checked={settings.categories.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
              <span className="skip-dot" style={{ background: c.color }} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </>
  )
}

const WEB_OPTIONS: { value: WebMethod; label: string }[] = [
  { value: 'web', label: '網頁' },
  { value: 'ytdlp', label: 'yt-dlp' }
]

function WebSection(props: Props) {
  return (
    <section>
      <h2 className="set-heading">其他網站</h2>
      <Row
        title="其他網站的播放方式"
        desc="yt-dlp 支援上千個影音網站（例如 Twitch、Vimeo、新聞台），播放時可以選畫質、語音、音量 200%；不支援或需要登入的網站會自動改用網頁。"
      >
        <Choice label="其他網站的播放方式" value={props.webMethod} options={WEB_OPTIONS} onChange={props.onWebMethod} />
      </Row>
    </section>
  )
}

function YtDlpSection({ onToast }: { onToast(message: string): void }) {
  const [status, setStatus] = useState<YtDlpStatus | null>(null)
  useEffect(() => {
    void window.multiview.ytdlpStatus().then(setStatus)
    // 打開這個分類時查詢最新版（1 小時內查過就不查，R93）
    window.multiview.ytdlpCheck()
    return window.multiview.onYtdlpStatus(setStatus)
  }, [])
  const row = status && ytdlpRow(status)
  const update = () => void window.multiview.ytdlpUpdate().then((r) => onToast(updateToast(r.result, r.version)))
  const changeChannel = (channel: YtDlpChannel) =>
    void window.multiview.ytdlpSetChannel(channel).then((r) => onToast(updateToast(r.result, r.version)))
  return (
    <section>
      <h2 className="set-heading">yt-dlp</h2>
      <Row
        title="版本"
        desc={
          row ? (
            <span className="set-version">
              {row.version}
              <span className={`chip chip-${row.chip.tone}`}>{row.chip.text}</span>
            </span>
          ) : (
            '讀取中…'
          )
        }
      >
        {row && (
          <button className="set-button" disabled={!row.button.enabled} onClick={update}>
            {row.button.label}
          </button>
        )}
      </Row>
      <Row
        title="更新來源"
        desc="正式版：yt-dlp 的正式發佈。最新版：每天建置的版本，YouTube 改版時通常先在這裡修好。切換後馬上換成那個版本。"
      >
        {status && (
          <Choice label="更新來源" value={status.channel} options={YTDLP_CHANNELS} onChange={changeChannel} />
        )}
      </Row>
      <Row
        title="自動更新"
        desc="程式會在開啟時自動更新（一天一次），YouTube 改版造成無法播放時也會自動更新。yt-dlp 播不了的影片會自動改用內嵌播放器。"
      />
    </section>
  )
}

function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.multiview.getVersion().then(setVersion)
  }, [])
  return (
    <section>
      <h2 className="set-heading">關於</h2>
      <Row title="MultiView 版本" desc={version || '讀取中…'} />
    </section>
  )
}
