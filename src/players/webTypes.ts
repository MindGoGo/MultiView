// 程式和注入網頁的程式之間傳遞的資料（R13–R16、R19）
import type { Progress } from '../lib/progress'

/** 影片模式 / 整頁模式（R13、R14） */
export type WebMode = 'video' | 'page'

export type WebVideoStatus = 'loading' | 'playing' | 'paused' | 'ended'

/** 程式送給網頁的狀態；v 每次改變都加一，網頁用來判斷要不要往子框架傳 */
export interface WebState {
  v: number
  mode: WebMode
  /** 播放意圖（R15 共用定義） */
  intent: 'play' | 'pause'
  /** 0–100，套用在主要影片（R15） */
  volume: number
  /** 靜音由程式對整個網頁設定；取消靜音時也解除主要影片本身的靜音（R15） */
  muted: boolean
  /** YouTube 網站頁面：攔截影片連結的點擊，不換頁，交給程式在這一格播放（R57、R63） */
  interceptYouTube?: boolean
  /** 每次加一時，每一層框架各自找網站的播放鈕按一次（R113：找不到影片時） */
  kick?: number
  /** 網頁剛載入、主要影片第一次開始播放時立即暫停（R75）；暫停後由程式關掉 */
  pauseOnStart?: boolean
  /**
   * YouTube 小視窗的影片網頁（R79、R80）：只顯示推薦區或留言區，網頁裡的影片不播放。
   * 推薦和留言共用一個網頁，切換分頁時只換顯示的區域
   */
  section?: CompanionSection
}

/** 小視窗影片網頁顯示的區域（R79、R80） */
export type CompanionSection = 'related' | 'comments'

/**
 * 小視窗影片網頁回報：推薦區、留言區是否已經有內容（R86）；
 * commentsOff：YouTube 把留言區藏起來了（例如直播中只有聊天室）
 */
export type SectionsReady = Record<CompanionSection, boolean> & { commentsOff?: boolean }

/** 網頁最上層框架每秒回報給程式 */
export interface WebReport {
  /** 是否找到主要影片 */
  found: boolean
  /** 主要影片的狀態；沒有找到時為 null */
  status: WebVideoStatus | null
  /** 回報時網頁收到的狀態版本，用來忽略比使用者操作還舊的回報 */
  v: number
  /** 主要影片觸發過加密媒體事件，表示需要 DRM（R16） */
  drm: boolean
  /** 主文件的 HTTP 狀態碼；拿不到時為 null（R16 AC2） */
  http: number | null
  /** 主要影片的進度；沒有主要影片或還不知道長度時為 null（R19） */
  progress: Progress | null
}

/**
 * 網頁來源共用的網站資料區（R18）：persist: 開頭會存到磁碟（%APPDATA%\MultiView\Partitions\web），
 * 關閉程式後保留登入狀態與 cookie；和 YouTube 播放器使用的預設資料區分開。
 */
export const WEB_PARTITION = 'persist:web'
