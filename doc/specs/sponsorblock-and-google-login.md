# SponsorBlock 與用 Edge 登入 Google（桌面版） 規格

- 功能代號：`sponsorblock-and-google-login`
- 狀態：已實作（桌面版 0.8.5，2026-11-18），**待實測**（Google 登入只能在 Windows 上實測，見第 3 節）
- 前置規格：[ytdlp-playback](ytdlp-playback.md)（R89–R95）、[youtube-companion-window](youtube-companion-window.md)（R78–R83）、[web-page-source](web-page-source.md)（R18）。
- 需求編號：R161 和手機版共用（規則與 `Phone` 分支 `doc/specs/android-app.md` 的 R161 相同）；R165 是新的編號（R119–R164 已經被手機版使用）。

## 1. 背景與目標

- **SponsorBlock**：手機版（Android 0.0.20、iOS）已經加入 R161，使用者要求桌面版也加入（2026-11-18）。
- **Google 登入**：Google 不讓程式裡的網頁登入（2026-10-10 實測「目前無法登入帳戶」，[youtube-browse-and-subscriptions](youtube-browse-and-subscriptions.md) 背景）。使用者想在 YouTube 小視窗以自己的帳號看觀看紀錄、個人化的推薦與訂閱（2026-11-18）。換掉 Electron 也解決不了（Google 擋所有內嵌的瀏覽器），所以改成在使用者電腦上的真正的瀏覽器登入，再把登入狀態帶回程式。

## 2. 範圍

**包含**：R161（yt-dlp 播放的 YouTube 一般影片跳過業配等片段）、R165（小視窗用 Microsoft Edge、Chrome 或 Brave 登入 Google、觀看紀錄、登出）、R166（用滑鼠貼上網址）。

**不包含**：
- R161：和手機版相同的「不做」（內嵌播放器、網頁格子、直播、`mute`／`poi`／`full`、送出或投票、統計）。背景只播聲音（手機版 R154）桌面版沒有，不適用。
- R165：主視窗格子裡的 YouTube 內嵌播放器（另一個資料區）不會變成登入狀態；用 OAuth、YouTube Data API；同時登入多個帳號；yt-dlp 使用登入的 cookie（會員限定影片）。

## 3. 需求清單

### R161：SponsorBlock（跳過業配等片段）

規則全部照手機版的 R161（API 與隱私、類別與顏色、解析、過濾與合併、自動跳過、使用者跳轉、從上次的進度開始、每格各自的狀態、設定檔格式），桌面版的差異與做法：

- **連線**：在主程序（`net.fetch`）連 SponsorBlock，畫面透過 `sponsorblock:segments` 拿片段；記憶體快取、失敗不留、逾時 5 秒、User-Agent `MultiView`，和手機版相同。
- **何時抓**：YouTube 格子建立時，設定開啟而且「一般影片的播放方式」是 yt-dlp，就和 yt-dlp 解析同時在背景抓。只有解析結果是一般影片（不是直播）、用 yt-dlp 播放時才交給播放器。
- **自動跳過**：播放器每 250 毫秒檢查一次；只在要播放而且沒有暫停時檢查。使用者跳轉＝拖曳或點進度條、← → 鍵、⏪ ⏩ 按鈕（都經過播放器的 `seek`）。
- **跳過提示**：格子右上角「● 已跳過<類別>　取消」，5 秒後收起；工具列顯示而且格子在最上面一列時往下移 40px。按「取消」跳回片段開頭（片段在影片結尾、已經播完時繼續播放），之後不再跳。
- **進度條**：一般影片的進度條用類別顏色畫出片段（最窄 2px，畫在已播放的部分上面）；游標在片段上時，時間提示上面多一行「● 類別」。
- **設定**：設定視窗「YouTube 播放」分類下方的「SponsorBlock（跳過業配）」：「自動跳過片段」開關（預設開啟）、開啟時列出 8 個類別的勾選框（預設只勾「業配」）、說明含資料來源與授權。改了馬上套用。保存在 `settings.json` 的 `sponsorBlock` 欄位，格式和手機版相同。
- 驗收條件：手機版 R161 的 AC1–AC5、AC7–AC10（AC6 背景播放不適用）。AC10 在桌面版是 `tests/unit/sponsor-block.test.ts`（照搬手機版 `SponsorBlockTest.kt` 的案例，另外加上請求與快取）。

### R165：用 Microsoft Edge 登入 Google（YouTube 小視窗）

- 描述：
  - 小視窗上方、置頂按鈕的左邊：沒有登入時是「登入」；登入後是「紀錄」「登出」。
  - **登入**：
    1. 按「登入」→ 程式用一個全新的暫存資料夾開啟登入用的瀏覽器（設定 →「YouTube 播放」→「Google 登入」→「登入用的瀏覽器」：Edge｜Chrome｜Brave，只列出有安裝的，預設 Edge，存在 `settings.json` 的 `loginBrowser`；選的沒有安裝時依 Edge、Chrome、Brave 的順序用有安裝的），打開 Google 的登入頁（登入後回到 YouTube）。使用者平常用的 Edge 和它的資料不受影響。
    2. 小視窗顯示「請在開啟的 Microsoft Edge 視窗登入 Google…」，按鈕變成「登入中…」。
    3. 使用者在 Edge 登入。偵錯連線最多等 90 秒（電腦慢時 Edge 要一陣子才開好）。程式透過 Edge 的偵錯連線（Chrome DevTools Protocol，只聽本機）每 1.5 秒檢查一次，YouTube 有 `LOGIN_INFO` 與 `SID`（或 `__Secure-1PSID`、`__Secure-3PSID`）時算登入完成；再等 2 秒讓 Google 補完其他網域的 cookie。
    4. 每個步驟寫進 `%APPDATA%\MultiView\login.log`（每次登入重寫），登入不了時用來查原因。
    5. 只取 Google（`google.com` 與各地的 `google.xx`）與 YouTube 網域的 cookie，放進網頁來源與小視窗共用的資料區（`persist:web`，R18），然後透過偵錯連線關掉這個 Edge，等它真的關掉再刪暫存資料夾。
    6. 小視窗的每個網頁重新載入，換成登入的樣子；提示「已登入 Google」。
  - **取消與失敗**：使用者關掉 Edge 的視窗（偵錯連線中斷；或 Edge 在背景繼續執行，但已經出現過的分頁連續 3 次檢查都沒有了）。不看程式啟動的那個程序有沒有結束：Edge 可能把視窗交給另一個程序開、自己先結束（0.8.5 實測，按登入後馬上顯示「已取消登入」）→「已取消登入」；15 分鐘沒有完成 →「太久沒有完成登入，已取消」；找不到 Edge 與 Chrome →「找不到 Microsoft Edge 或 Google Chrome，無法登入」；其他 →「登入失敗，請再試一次」。都會關掉 Edge、刪掉暫存資料夾。
  - 登入中的說明與按鈕提示用實際開啟的瀏覽器名稱。
  - **紀錄**：切到「搜尋」分頁並打開手機版 YouTube 的觀看紀錄（`m.youtube.com/feed/history`）。點影片和搜尋結果一樣放進格子（R82）。
  - **登出**：先跳出確認「要登出 Google 嗎？」（取消／登出，Esc 或點旁邊也是取消），按「登出」才刪掉資料區裡 Google 與 YouTube 的 cookie，小視窗的網頁重新載入；提示「已登出 Google」。
  - 登入狀態和格子的網頁模式共用（R18），所以格子裡的 YouTube 網頁也會是登入的。
- 已知風險（只能在 Windows 上實測）：
  - Google 可能擋開著偵錯連線的瀏覽器登入（「這個瀏覽器或應用程式可能不安全」）。
  - 新版 Chromium 的裝置綁定登入（DBSC）可能讓帶回來的登入狀態更新不了，幾天後被登出；這時重新按「登入」。
- 驗收條件：
  - AC1：小視窗沒有登入時有「登入」；按下後開啟一個新的 Edge 視窗，畫面是 Google 的登入頁（沒有 Edge 平常的分頁和帳號），小視窗顯示登入說明。
  - AC2：在 Edge 登入後幾秒內 Edge 自動關閉，小視窗提示「已登入 Google」，按鈕變成「紀錄」「登出」；推薦、搜尋分頁右上角是自己的大頭貼。
  - AC3：按「紀錄」→ 搜尋分頁顯示自己的觀看紀錄；點一部影片放進格子。
  - AC4：重新開啟 MultiView → 小視窗仍然是登入的。
  - AC5：登入中關掉 Edge 視窗 → 「已取消登入」，按鈕回到「登入」。
  - AC6：按「登出」→ 網頁換成沒有登入的樣子，按鈕回到「登入」。
  - AC7：`%TEMP%` 裡沒有留下 `multiview-login-` 開頭的資料夾；平常用的 Edge 照常開啟、帳號不變。
  - AC8：`tests/unit/google-login.test.ts` 全部通過（找瀏覽器、偵錯連線的位置、登入完成的判斷、cookie 的網域與轉換、登出的網址）。

### R166：用滑鼠貼上網址

- 背景：使用者回報（0.8.6）：貼上網址、更換網址只能用鍵盤貼上，滑鼠沒辦法貼上（Electron 的輸入框預設沒有右鍵選單）。
- 描述：
  - 格子的網址輸入框右邊多一個「貼上並開啟」：讀剪貼簿的文字，直接開啟；剪貼簿沒有文字時顯示「剪貼簿裡沒有網址」，網址不合法時顯示原本的錯誤訊息。格子太窄時按鈕排到輸入框下面。
  - 程式畫面（主視窗、YouTube 小視窗）的輸入框按右鍵有「剪下、複製、貼上、全選」（清單面板、訂閱的輸入框也有）；選取了文字時有「複製」。
- 驗收條件：
  - AC1：複製一個 YouTube 網址 → 空白格子按「貼上並開啟」→ 開始播放。
  - AC2：在輸入框按右鍵 →「貼上」→ 網址貼進輸入框；剪下、複製、全選照常。
  - AC3：剪貼簿是空的時按「貼上並開啟」→ 顯示「剪貼簿裡沒有網址」。

### R162（桌面版）：只有一格時不顯示小喇叭

- 背景：手機版的 R162（`Phone` 分支）已經有這一條；使用者要求桌面版也一樣（2026-11-18）。只做小喇叭這一部分（上下排的小視窗是手機版才有的）。
- 描述：版型 `1`、單格全螢幕時，格子左上角不顯示「有聲音」的小喇叭（R7 AC5 的例外：畫面上只有一格，看得到也聽得到）。播放方式的小標示（R109）照常顯示。
- 驗收條件：AC1：版型 `1` 與單格全螢幕時，有聲音的格子左上角沒有小喇叭；版型 `2` 時照常顯示。

## 4. 實作

- R161：`src/lib/sponsorBlock.ts`（規則）、`electron/sponsorBlock.ts`（雜湊前綴、請求與快取）、`electron/main.ts`／`electron/preload.ts`（`sponsorblock:segments`）、`src/players/YouTubeSource.tsx`（抓片段）、`src/players/VideoPlayer.tsx`（檢查、跳過、取消）、`src/components/Cell.tsx`（提示）、`ProgressBar.tsx`／`ProgressPreview.tsx`（色塊、預覽）、`SettingsDialog.tsx`（設定）、`src/lib/settings.ts`（`sponsorBlock` 欄位）。
- R165：`src/lib/googleLogin.ts`（規則）、`electron/googleLogin.ts`（啟動 Edge、偵錯連線、關閉與清理；在開發環境用 Chromium 測過登入完成、取消、逾時與暫存資料夾的清理）、`electron/main.ts`（`google:login`、`google:status`、`google:logout`）、`electron/companionPreload.ts`、`src/companion/Companion.tsx`、`CompanionWeb.tsx`（`reloadKey`）。
- R166：`src/components/Cell.tsx`（「貼上並開啟」）、`electron/main.ts`（`installEditMenu`、`clipboard:readText`）。
- R162（桌面版）：`src/components/Grid.tsx`、`Cell.tsx`（`singleView`）。
- 手動驗收：`tests/manual/sponsorblock-and-google-login.md`。

## 5. 變更紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-11-18 | 0.8.7：登入用的瀏覽器可以選 Edge、Chrome、Brave；R166 用滑鼠貼上網址；R162 只有一格時不顯示小喇叭 | 使用者要求 |
| 2026-11-18 | 登出前先確認 | 使用者實測 0.8.6 登入成功；登出按鈕容易誤觸 |
| 2026-11-18 | 0.8.6：取消的判斷改看偵錯連線與分頁，不看啟動的程序；等偵錯連線 90 秒；login.log；等 Edge 關掉才刪暫存資料夾 | 使用者實測 0.8.5：按登入後馬上顯示「已取消登入」 |
| 2026-11-18 | 初版，實作於 0.8.5 | 使用者要求（手機版已經有 SponsorBlock；小視窗想登入看自己的紀錄） |
