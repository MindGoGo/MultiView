# Android 版 規格

- 功能代號：`android-app`
- Jira：無
- 狀態：草稿（待使用者確認）
- 最後更新：2026-11-14
- 前置規格：桌面版的所有規格（R1–R118）、[iOS 版](ios-app.md)（R119–R144）。本規格的需求編號從 R145 開始。
- 參考：iOS 版從 0.0.1 到 0.0.27 在 iPhone 14 Pro、iPad Pro M1 上的實測結果（[ios-app](ios-app.md) 第 11 節）。

## 0. 給接手的工作階段（先讀這一節）

這份文件寫成可以獨立閱讀：新的工作階段不需要看之前的對話，讀完這一節就能開始。

**專案是什麼**：MultiView 是在一個畫面裡分割顯示多個直播與影片的播放器。目前有兩個版本：

| 版本 | 位置 | 狀態 |
|---|---|---|
| 桌面版（Windows，Electron + React） | `electron/`、`src/` | 0.8.3，規格 R1–R118 |
| iOS 版（SwiftUI） | `ios/` | 0.0.27，規格 R119–R144，已在 iPhone、iPad 實測 |
| Android 版 | `android/`（還沒建立） | 本規格 |

**開工前要讀的檔案**（依順序；不用全部讀完，需要時再查）：

1. 本文件。
2. [ios-app.md](ios-app.md) 的第 4 節（需求）與第 11 節（實測紀錄）：Android 版大部分功能照 iOS 版的最終行為做，第 11 節記錄了每個問題的原因與修正，避免重踩。
3. 要對照實作時，看 iOS 版對應的程式（第 9 節列出對照表）。

**工作方式**（使用者的習慣，沿用）：

- 使用者用繁體中文溝通，文件、註解、提交訊息都用繁體中文，需求編號寫在提交訊息最後，例如 `[R150]`。
- 開發環境是雲端的 Linux 容器，**連不到 YouTube**，也沒有實體手機；能做的是寫程式、跑單元測試、在 GitHub Actions 上編譯。實際行為由使用者在自己的裝置上測，回報結果後修改。
- 每做完一批功能就升一個版本號、推上分支，等 GitHub Actions 編譯通過後請使用者更新測試。實測結果寫回本規格第 11 節。
- 發佈新版：使用者在 GitHub 網頁的 Releases 建立 `android-v<版本號>` 標籤（開發環境不能推送標籤），GitHub Actions 產生 APK 補到那個 Release。做法和 iOS 版的 `ios-v*` 相同（見 `.github/workflows/ios.yml`）。
- 分支：開發環境指定的分支（目前是 `claude/beautiful-babbage-1bur72`）；使用者說先不要合併到 `main`。

## 1. 背景與目標

使用者想在 Android 手機與平板上使用 MultiView，功能和 iOS 版相同：分割畫面同時看多場直播與影片、各格獨立的聲音、yt-dlp 播放（沒有 YouTube 的廣告，而且原生播放器可以多格同時出聲）、網頁來源與廣告阻擋、清單、訂閱、YouTube 小視窗。

和 iOS 版相比，Android 版有幾個有利的地方：

- **安裝簡單**：直接安裝 APK，不需要 SideStore、不用每 7 天重新簽章、不用 Apple ID。
- **編譯不需要 macOS**：GitHub Actions 的 Linux 機器就能編譯（比 macOS 機器便宜、排隊短）。
- **分享選單**：App 可以直接出現在其他 App 的分享選單（iOS 版要使用者自己做捷徑）。

需要重新做的地方：程式語言不同（Kotlin），iOS 版的 Swift 程式不能直接用；Android 的 WebView 沒有 iOS 那種內容阻擋規則；Python 與 JS 執行環境的做法不同。

## 2. 範圍

**包含**：iOS 版第一版的全部功能（R119–R144 中已經實作的部分），在 Android 上的對應做法見第 4 節。

**不包含（之後再評估）**：

- 上架 Google Play（yt-dlp、YouTube 廣告阻擋很可能不能過審核；先用 APK 自行安裝）
- Chromecast（對應 iOS 版的 AirPlay，之後再評估）
- 音量、亮度超過 100%（和 iOS 版相同）
- 字幕選單、接實體鍵盤的快捷鍵、多視窗（iOS 版也還沒做）
- Android TV

## 3. 共用定義

沿用桌面版與 iOS 版的定義（[multiview-player](multiview-player.md) 第 3 節、[ios-app](ios-app.md) 第 3 節）。另外：

- **原生播放器**：AndroidX Media3 的 ExoPlayer，播 mp4、m3u8 和 yt-dlp 解析出來的串流。對應 iOS 版的 AVPlayer。
- **網頁格子**：用 Android WebView 顯示的格子（YouTube 內嵌播放器、網頁來源、整頁模式）。
- **大螢幕／小螢幕**：寬度和高度都至少 600dp 是大螢幕（平板、摺疊機展開），其他是小螢幕（和 iOS 版的 600pt 相同）。

## 4. 需求清單

每一條都註明對應的 iOS 版需求；沒有特別說明的行為和 iOS 版相同。

### 第一階段：建置與技術驗證

### R145：建置與安裝流程（對應 R119）
- 描述：
  - 程式放在 `android/`，用 Gradle（Kotlin DSL）建置；畫面用 Jetpack Compose；最低支援 Android 8.0（API 26，待確認，見第 12 節）。
  - 和畫面無關的邏輯放在獨立的 Kotlin 模組 `android/core/`（純 Kotlin，不依賴 Android），有自己的單元測試，可以在開發環境的 Linux 上直接跑（`./gradlew :core:test`）。
  - GitHub Actions（`.github/workflows/android.yml`，Ubuntu）：改到 `android/` 或共用檔案（`electron/webPreload.ts`、`src/lib/**`、`resources/easylist.txt`）時跑單元測試並編譯；推送 `android-v*` 標籤時產生簽章的 APK（`MultiView-Android-<版本號>.apk`），補到同名的 Release，不標成最新版本。
  - **簽章**：Android 的 APK 一定要簽章，而且更新時簽章要相同，否則不能覆蓋安裝。簽章金鑰存在 GitHub 的 Secrets（使用者建立，見第 12 節），不放進 repo。
  - **更新**：使用者可以用 Obtainium 之類的 App 追蹤 GitHub Releases 自動提示更新（對應 iOS 版的 SideStore 來源），或直接下載 APK 安裝。
- 驗收條件：
  - AC1：推送改到 `android/` 的提交 → Actions 的測試與編譯成功。
  - AC2：建立 `android-v0.0.1` 標籤 → Release 出現 APK，可以在手機上安裝、開啟。
  - AC3：安裝 0.0.2 → 覆蓋安裝，資料保留。

### R146：技術驗證：多格原生播放（對應 R120）
- 描述：4 格 ExoPlayer 同時播放、同時出聲。Android 的音訊焦點（audio focus）預設會讓一個播放器出聲時其他的暫停，所以每個 ExoPlayer 都要設定成**不處理音訊焦點**（`setAudioAttributes(…, handleAudioFocus = false)`），改由 App 自己處理來電等中斷（R153）。記錄 `2×2`、`3×3` 的效能（使用者的裝置）。
- 驗收條件：
  - AC1：4 格 m3u8 同時播放 10 分鐘，4 格都有聲音。
  - AC2：第 11 節記錄效能結果。

### R147：技術驗證：多格網頁播放（對應 R121）
- 描述：多個 WebView 同時放 YouTube 內嵌播放器，確認能不能同時出聲。iOS 的 WKWebView 同一時間只能一格網頁出聲（第二格出聲時系統暫停第一格）；**Android 可能沒有這個限制，要實測**。結果決定 R153 的網頁聲音規則。
  - 內嵌播放器需要 http(s) 的頁面來源：用 `loadDataWithBaseURL("https://local.multiview.android/", …)`（iOS 版用 `https://local.multiview.ios`）。
  - 要設定 `mediaPlaybackRequiresUserGesture = false` 才能自動播放。
- 驗收條件：
  - AC1：4 格 YouTube 內嵌播放器同時播放。
  - AC2：第 11 節記錄能不能同時出聲。

### R148：技術驗證：內嵌 Python 與 yt-dlp（對應 R122）
- 描述：
  - 用 **Chaquopy**（Gradle 外掛，開源）把 Python 3.13 和 yt-dlp、yt-dlp-ejs、certifi 包進 App。版本和 iOS 版相同（`ios/scripts/fetch-python.sh` 裡固定的版本）。
  - **直接重用 iOS 版的 `ios/MultiView/YtDlp/mv_bridge.py`**（解析、頻道影片列表、更新用的版本資訊），只把 JS 執行的部分換掉。
  - yt-dlp 解析 YouTube 需要 JS 執行環境。iOS 版寫了一個 yt-dlp 外掛（`ios/MultiView/YtDlp/mv_jsc.py`）把 JS 交給 JavaScriptCore。Android 有兩個選項，技術驗證時兩個都試：
    1. **QuickJS**：yt-dlp 本身就支援（`--js-runtimes quickjs`）。把編譯好的 Android 版 QuickJS 執行檔放在 App 的 native library 資料夾（Android 允許執行 `nativeLibraryDir` 裡的檔案），告訴 yt-dlp 它的路徑。不用寫外掛。
    2. **WebView 的 JS**：照 iOS 版的 `mv_jsc.py` 寫一個外掛，把 JS 交給一個不顯示的 WebView 執行（`evaluateJavascript`）。WebView 要在主執行緒操作，要注意不要卡住畫面。
  - 解析要在背景執行緒；Python 同一時間只能跑一段程式（GIL），同時最多解析 2 個（和 iOS 版相同）。
- 驗收條件：
  - AC1：貼上 YouTube 直播 → 用 yt-dlp 解析，原生播放器開始播放。
  - AC2：第 11 節記錄用哪一種 JS 執行環境、解析時間、APK 大小。

### 第二階段：核心功能

以下照 iOS 版的最終行為（含第 11 節的修正）實作。

### R149：主畫面、版型、分隔線與換位（對應 R123–R125）
- 描述：
  - 只有影片格子，影片畫到螢幕邊緣（隱藏狀態列與導覽列，沉浸模式）；操作列、按鈕、輸入框避開瀏海與手勢導覽列的範圍。**注意**：iOS 版曾經在「已經忽略安全區域」的地方量安全區域，量到 0，結果下方的按鈕落在系統手勢範圍裡按不到（iOS 0.0.16）。Android 要用 `WindowInsets`（`systemBars`、`displayCutout`）在根畫面量，再傳給格子。
  - 版型：大螢幕 `1`、`2`、`2×2`、`3×3`、`1+3`；小螢幕只有 `1`、`2`，`2` 在畫面比較高時上下排列。版型按鈕是依格子位置畫的圖示。
  - 分隔線看起來 2dp、手指可以按的範圍 24dp；雙擊回到平均分配。格子之間有間隔，貼著螢幕邊緣的那一側沒有（不要有外框線，iOS 0.0.2 的問題）。
  - 換位：長按影片約 0.5 秒（或操作列的「移動」）後拖到另一格放開。
  - 播放中不自動關螢幕（`FLAG_KEEP_SCREEN_ON`）。
  - 旋轉按鈕：關了自動旋轉也能切換橫向、直向（`requestedOrientation`），長按「跟著裝置旋轉」；手機直向時進入單格全螢幕自動轉橫向，離開後轉回來。
- 驗收條件：同 R123–R125，加上旋轉的 AC（iOS 0.0.26 的測試項目）。

### R150：加入來源（對應 R126）
- 描述：
  - 空白格：網址輸入框（有清除按鈕）、「貼上」按鈕。網址判斷和桌面版、iOS 版相同（共用測試案例）。
  - **分享選單**：App 在 `AndroidManifest.xml` 宣告接收 `ACTION_SEND`（`text/plain`），從其他 App 分享網址時出現在分享選單；從分享的文字裡找出第一個 http(s) 網址。也支援 `multiview://open?url=`（和 iOS 版相同，`ExternalLink` 的規則與測試照搬）。
  - 放進第一個顯示中的空格；沒有空格時詢問要取代哪一格。
  - 更換網址：小視窗，有清除、貼上。
- 驗收條件：
  - AC1：在 Chrome 或 YouTube App 按分享選 MultiView → 網址放進空格。
  - AC2：其他同 R126。

### R151：工具列與操作列（對應 R127）
- 描述：照 iOS 版的最終行為：
  - 點一下影片 → 只聽這一格，出現操作列與工具列；這一格的操作列顯示時再點一下就收起來；3 秒沒有操作自動收起；彈出的滑桿、選單開著時不自動收起（iOS 版曾經發生「⋯」選單被自動收起關掉，iOS 0.0.16）。
  - 工具列顯示時，每一格左上角有喇叭按鈕（只切換這一格的聲音），旁邊是「yt-dlp」小標示（不要蓋住喇叭，iOS 0.0.16 的問題）。
  - 操作列：播放／暫停、喇叭、音量、亮度、畫質、移動、全螢幕、子母畫面、網頁的「顯示整個網頁」與廣告阻擋、最愛、更換網址、移除；放不下的收進「⋯」選單（用系統的彈出選單，使用者覺得比底部對話框好看）。
  - 播放中點一下時中央顯示暫停鈕，暫停時一直顯示播放鈕。
  - 讀取動畫：彈跳的小生物（桌面版 R99 的圖案，iOS 版 `ios/MultiView/Cell/LoadingCritter.swift` 用程式畫的，座標可以照抄）。
  - 整頁模式的網頁格子：手指直接操作網頁，用格子下緣的小把手叫出操作列。
- 驗收條件：同 R127，加上 iOS 0.0.13、0.0.26 的測試項目。

### R152：聲音（對應 R128）
- 描述：
  - 點一下格子 → 獨占聲音；喇叭按鈕 → 只切換這一格；每格音量 0–100%。
  - 原生播放器（ExoPlayer）的格子可以多格同時出聲（R146）。網頁格子依 R147 的結果：如果 Android 也不能多格同時出聲，照 iOS 版的規則（網頁格子同一時間只有一格有聲音，被系統暫停的格子自動繼續播放）。
  - 自己處理音訊焦點：其他 App 開始播放（來電等）時全部暫停，結束後恢復原本在播的格子；拔掉耳機（`ACTION_AUDIO_BECOMING_NOISY`）時全部暫停。
- 驗收條件：同 R128。

### R153：播放控制、亮度、畫質（對應 R129–R131）
- 描述：
  - 全部播放／暫停、全部靜音、進度條、雙擊左右 1/3 倒轉／快轉 10 秒、單格全螢幕（按鈕或兩指張開／捏合）。
  - 亮度 20–100%（黑色遮罩），每格與總亮度相乘。
  - 畫質（ExoPlayer 播 HLS 時）：自動、1080p、720p、480p、360p，用 `TrackSelectionParameters.setMaxVideoSize`。
- 驗收條件：同 R129–R131。

### R154：背景播放、子母畫面（對應 R132）
- 描述：
  - 回到主畫面或關螢幕時，原生播放器中有聲音、正在播放的格子繼續播聲音（`MediaSessionService` 前景服務與通知），其他格子暫停；回來時恢復。
  - 子母畫面：只有一格有聲音而且是原生播放器時，回到主畫面自動進入子母畫面（`setAutoEnterEnabled`，Android 12 以上）。Android 的子母畫面是整個 Activity 縮小，畫面要切換成只顯示那一格。
  - 通知與鎖定畫面顯示正在播放的影片名稱，可以播放／暫停。
- 驗收條件：同 R132。

### R155：保存與還原（對應 R134）
- 描述：`settings.json`、`lists.json` 的格式和桌面版、iOS 版相同，存在 App 的資料夾（`filesDir`）；變更後 300 毫秒寫入、切到背景時立刻寫入；損毀時改名 `.bak`。觀看進度、只在第一次播放過後才更新進度的規則和 iOS 版相同。
- 驗收條件：同 R134。

### 第三階段：進階功能

### R156：yt-dlp 播放與更新（對應 R135、R136）
- 描述：
  - YouTube 直播、一般影片預設用 yt-dlp（使用者可以在設定改成內嵌播放器）；失敗或播放中斷 3 次退回內嵌播放器；串流網址過期時重新解析。其他網站的播放方式預設是網頁，可以改成 yt-dlp。
  - 自動更新：每 24 小時檢查一次 GitHub 上 yt-dlp 的最新穩定版，下載 `yt-dlp`（zip 格式的 Python 程式）並用官方的 `SHA2-256SUMS` 驗證，存在 App 資料夾，**下次開啟 App 生效**；App 版本換了時刪掉下載的那一份。下載的那一份載入失敗時改用內附的。解析失敗、看起來是 yt-dlp 太舊時在背景更新（10 分鐘內一次）。這些規則和 `mv_bridge.py` 的 `use_update_archive`、iOS 版 `YtDlpUpdater.swift` 相同。
- 驗收條件：同 R135、R136。

### R157：網頁來源與廣告阻擋（對應 R137、R138）
- 描述：
  - **注入網頁的程式重用桌面版的 `electron/webPreload.ts`**，和 iOS 版相同的做法：寫一個 Android 版的 shim（對應 `ios/web/electron-shim.ts`）取代 `ipcRenderer`，訊息走 `addJavascriptInterface`（或 `WebMessageListener`），App 用 `evaluateJavascript("__multiViewReceive(…)")` 送狀態；用 esbuild 打包（`ios/scripts/build-web.sh` 的做法）。注意 Android WebView 的注入要在每個框架執行：用 AndroidX WebKit 的 `addDocumentStartJavaScript`（可以指定所有框架）。
  - 影片模式、整頁模式、找不到影片時按網站的播放鈕、15 秒後切整頁、YouTube 網站頁面點影片換成那部影片、其他網站用 yt-dlp：和 iOS 版相同。
  - **iOS 版踩過的坑（直接照最終做法）**：
    1. 找影片時，網頁要用比較寬的版面排版（桌面版是至少 1280×720），否則手機上網站用窄版面，影片在畫面外找不到。但**不能把網頁畫成很大一張再縮小**（iOS 0.0.19 這樣做，記憶體不夠，網頁程序被系統結束）。iOS 版最後用網頁縮放（`pageZoom`，最小 50%）；Android 用 WebView 的 `setInitialScale`、`settings.useWideViewPort`／`loadWithOverviewMode` 或 `zoomBy` 做到同樣的效果，要實測。
    2. **寬版面只在找影片的期間使用**，找到影片後恢復原本的大小，否則注入的程式把影片設成「填滿畫面寬度」時，寬度是縮放後的寬度，影片只露出一半（iOS 0.0.22）。
    3. 找到影片前用黑色蓋住網頁，中間顯示讀取動畫（iOS 0.0.20）。
    4. **網頁開始顯示就算載入成功**（`onPageCommitVisible`），不要等「載入完成」：新聞網站一直在載入廣告，永遠等不到（iOS 0.0.21，news.tvbs.com.tw）。
    5. 載入成功過之後，網站自己的跳轉失敗不算錯誤；顯示錯誤後網頁又回報找到影片時，取消錯誤。
    6. 網頁程序被系統結束（`onRenderProcessGone`）時重新載入一次，還是不行才顯示「網頁停止運作」。
    7. 切換廣告阻擋而重新載入時，保留原本的顯示方式（不要回到影片模式）。
  - **廣告阻擋**：Android 的 WebView 沒有 iOS 的內容阻擋規則，要在 `shouldInterceptRequest` 裡比對每一個請求，擋下的回傳空的回應。
    - 規則來源：直接用 iOS 版的轉換結果（`ios/scripts/easylist-to-webkit.mjs` 產生的 JSON：`url-filter` 正規表示式、`if-domain`、`unless-domain`、`resource-type`、`load-type`、`ignore-previous-rules`）。這樣兩個平台擋的範圍一樣。
    - 比對要快：約 5 萬條網路規則，不能每個請求都跑 5 萬個正規表示式。做法：依規則網址裡的網域（`||網域^` 開頭的規則占大多數）建索引，請求只比對它的網域對得上的規則，加上少數沒有網域的規則。要寫單元測試與效能測試（`android/core`）。
    - 元素隱藏規則（`css-display-none`）：由注入的程式把對應網域的樣式加進網頁。
    - 其他網站裡內嵌的 YouTube 播放器（`youtube.com`、`youtube-nocookie.com` 的框架）發出的請求不擋（桌面版 R17 AC4）。
    - 設定畫面顯示規則數量。
- 驗收條件：同 R137、R138，加上 iOS 0.0.19–0.0.23 用 news.tvbs.com.tw 測的項目。

### R158：YouTube 小視窗、清單、訂閱、設定（對應 R139–R144）
- 描述：
  - 登入狀態：WebView 的 Cookie 保存在 App 裡（`CookieManager`）；設定可以清除網站資料。
  - YouTube 小視窗：右側面板（小螢幕占滿寬度），分頁「搜尋、推薦、留言、聊天室」；跟著最後點過的 YouTube 格子；面板裡的網頁不自動播放。注入的程式照抄 `ios/MultiView/Panels/CompanionPanel.swift` 裡的 JS（只顯示推薦區或留言區、攔下影片連結）。
  - 最愛、歷史：清單面板（YouTube／其他網站、最愛／歷史），點一筆放進空格，往左滑編輯、刪除；操作列的星號加入最愛。
  - 訂閱：加入頻道（貼頻道或影片網址）、從 Google Takeout 的 `subscriptions.csv` 匯入、最新影片、直播中的標示。**YouTube 的 RSS 摘要對 App 回傳 404（2026-11-14 實測）**，最新影片要用 yt-dlp 讀頻道的影片頁（`mv_bridge.py` 的 `channel_videos`），一次一個頻道，展開的頻道優先。直播狀態讀頻道的 `/live` 頁（這個可以用）。
  - 設定畫面：播放方式、yt-dlp 版本與更新、廣告阻擋的狀態、匯入桌面版的 `settings.json`／`lists.json`（Android 的檔案選擇器）、清除網站資料、版本號。
- 驗收條件：同 R139–R144。

### R159：版本號
- 描述：Android 版的版本號從 `0.0.1` 開始，和桌面版、iOS 版分開；設定畫面顯示「MultiView Android 0.0.1（yt-dlp 版本）」。
- 驗收條件：AC1：設定畫面看得到版本號。

## 5. 對前置規格的影響

桌面版、iOS 版的程式與行為不變。共用的檔案（`electron/webPreload.ts`、`resources/easylist.txt`、`ios/MultiView/YtDlp/mv_bridge.py`、`ios/scripts/easylist-to-webkit.mjs`）修改時，三個版本都會受影響，要分別確認。之後可以把共用的部分搬到 `shared/` 資料夾。

## 6. API 變更

無。

## 7. 資料表變更

無。設定檔與清單檔的格式和桌面版、iOS 版相同。

## 8. 非功能需求

- **測試**：`android/core` 的單元測試照搬 iOS 版 `ios/MultiViewCore/Tests/` 的測試案例（它們又是從桌面版 `tests/unit/` 來的），這是確認三個版本行為一致的主要方式。
- **安全**：yt-dlp 的更新檔必須通過雜湊值驗證；APK 的簽章金鑰只放在 GitHub Secrets。
- **效能**：`2×2` 播 4 路 1080p 直播 30 分鐘不當掉；廣告阻擋的比對每個請求平均 1 毫秒以內。

## 9. 預計影響的檔案與 iOS 版的對照

| Android 版 | 內容 | 對照的 iOS 版 |
|---|---|---|
| `android/core/` | 網址判斷、版型、格位與聲音規則、設定與清單、匯入合併、進度、yt-dlp 結果判讀與更新判斷、訂閱解析、分享連結、廣告規則比對 | `ios/MultiViewCore/Sources/MultiViewCore/*.swift` 與測試 |
| `android/app/.../AppModel.kt` | App 的狀態、播放器管理、保存 | `ios/MultiView/App/AppModel.swift` |
| `android/app/.../ui/` | 格子、分隔線、操作列、工具列、讀取動畫、面板、設定 | `ios/MultiView/Grid/`、`Cell/`、`Panels/` |
| `android/app/.../player/` | ExoPlayer、YouTube 內嵌、網頁格子、yt-dlp 包裝 | `ios/MultiView/Players/`、`Web/` |
| `android/app/src/main/python/` | `mv_bridge.py`（共用）、JS 執行環境的外掛 | `ios/MultiView/YtDlp/` |
| `android/web/` | 注入網頁的 shim | `ios/web/electron-shim.ts` |
| `.github/workflows/android.yml` | 測試、編譯、發佈 | `.github/workflows/ios.yml` |
| `doc/features/android-app.md`、`tests/manual/android-app.md` | 安裝說明、手動驗收 | `doc/features/ios-app.md`、`tests/manual/ios-app.md` |

## 10. 開發順序

| 步驟 | 內容 | 版本 |
|---|---|---|
| 1 | R145 建置流程、空的 App 能安裝 | `android-v0.0.1` |
| 2 | R146–R148 技術驗證 | `android-v0.0.2` 起 |
| 3 | `android/core` 的邏輯與單元測試（可以和步驟 2 同時進行，不需要實機） | — |
| 4 | R149–R155 核心功能 | `android-v0.1.0` |
| 5 | R156 yt-dlp | |
| 6 | R157 網頁來源與廣告阻擋 | |
| 7 | R158 小視窗、清單、訂閱、設定 | |

## 11. 技術驗證紀錄

（實測後填寫）

| 項目 | 裝置／版本 | 結果 | 對規格的影響 |
|---|---|---|---|
| | | | |

## 12. 未決事項

- [x] 裝置：POCO F6 Pro（1TB），Xiaomi HyperOS 3.0.303.0（以 Android 16 為基礎）（2026-11-14）。測試以這支手機為準；最低支援版本維持 Android 8.0（API 26），目標版本用 Android 16（API 36）。HyperOS 有比較積極的省電與背景限制，R154 的背景播放要特別測（可能要請使用者把 MultiView 的省電設定改成「無限制」）。
- [x] APK 的簽章金鑰：由使用者在自己的 Windows 電腦用 `keytool` 產生（PKCS12，金鑰庫與金鑰用同一個密碼），存成 GitHub 的 Actions Secrets，名稱固定為 `ANDROID_KEYSTORE_BASE64`（金鑰檔的 base64）、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`（`multiview`）、`ANDROID_KEY_PASSWORD`（和金鑰庫密碼相同）。開發環境不經手金鑰內容。workflow 在沒有這些 Secrets 時（例如分支的測試）只編譯 debug 版，不簽發佈用的 APK。使用者 2026-11-14 回報已經建立好這四個 Secrets（金鑰檔與密碼由使用者自行備份）。
- [ ] 更新方式：Obtainium 或直接下載 APK。
- [ ] yt-dlp 的 JS 執行環境：QuickJS 或 WebView（R148 驗證後決定）。
- [ ] 共用檔案要不要搬到 `shared/`。

## 變更紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-11-14 | 初版草稿 | 使用者要求準備 Android 版的文件；iOS 版 0.0.27 已穩定 |
| 2026-11-14 | 記錄裝置（POCO F6 Pro、HyperOS 3）與簽章金鑰的 Secrets 名稱 | 使用者回覆未決事項 |
| 2026-11-14 | 簽章金鑰的 Secrets 已建立 | 使用者回報 |
