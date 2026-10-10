# YouTube 選單文字、網頁模式的廣告阻擋、空格開啟 YouTube 規格

- 功能代號：`youtube-menu-tweaks`
- Jira：無
- 狀態：已確認、已複查、已實作
- 最後更新：2026-10-11
- 前置規格：[multiview-player](multiview-player.md)（R1–R11）、[web-page-source](web-page-source.md)（R12–R18）、[player-controls-and-lists](player-controls-and-lists.md)（R19–R25）、[cell-play-and-page-menu](cell-play-and-page-menu.md)（R26–R29）、[captions-and-quality-menu](captions-and-quality-menu.md)（R30–R33）、[brightness-and-volume-popup](brightness-and-volume-popup.md)（R40–R43）、[installer-and-youtube-fixes](installer-and-youtube-fixes.md)（R44–R47）、[youtube-web-and-seek](youtube-web-and-seek.md)（R48–R52）、[resume-and-play-fixes](resume-and-play-fixes.md)（R53–R56）、[youtube-browse-and-subscriptions](youtube-browse-and-subscriptions.md)（R57–R62）、[youtube-back-to-page](youtube-back-to-page.md)（R63–R65）、[youtube-page-mode](youtube-page-mode.md)（R66–R68）。本規格的需求編號從 R69 開始；R34–R39 仍保留給本機播放與下載功能。

## 1. 背景與目標

2026-10-11 使用者回饋：

1. 「YouTube ▾」選單的「看這部影片的網頁（留言、推薦）」太長，改成「回到網頁」。
2. YouTube 網頁模式的廣告阻擋預設關閉；打開後回到播放器、再切回網頁，又變回關閉。希望預設開啟。
3. 開啟 YouTube 要到清單面板按，希望空白格子直接有「開啟 YouTube」按鈕。

## 2. 範圍

**包含：**
- 選單文字（R69）
- YouTube 網頁模式的廣告阻擋預設開啟並記住選擇（R70）
- 空白格子的「開啟 YouTube」按鈕（R71）
- 版本號更新並打包（R72）

**不包含：**
- 改用 YouTube 網頁播放的格子（第九版 R48）、在格子裡逛 YouTube 網站的格子（第十二版 R57）的廣告阻擋預設值：維持關閉
- 一般網頁來源的廣告阻擋：維持預設開啟（第二版 R17）

## 3. 共用定義

- **YouTube 網頁模式：** 第十四版 R66 的網頁模式。

## 4. 需求清單

### R69：選單文字
- 描述：「YouTube ▾」選單的「看這部影片的網頁（留言、推薦）」改成「回到網頁」。按鈕的滑鼠提示改成「YouTube：回到網頁（留言、推薦）、回到播放器、回到剛才的 YouTube 頁面」。其他項目不變。
- 驗收條件：
  - AC1：YouTube 格子按「YouTube ▾」→ 第一項是「回到網頁」，按下後切換到 YouTube 網頁模式（和第十四版 R66 相同）。

### R70：YouTube 網頁模式的廣告阻擋
- 描述：
  - 切換到 YouTube 網頁模式時，廣告阻擋預設開啟（第十四版 R66 原本是關閉）。
  - 在網頁模式中切換廣告阻擋後，這一格記住這個選擇：回到播放器、再切回網頁時沿用；換位時跟著移動；「更換網址」、移除後回到預設（開啟）。這個選擇保存在設定檔，重開程式後仍然沿用。
  - 在網頁模式中切換廣告阻擋時，網頁重新載入（第二版 R17），從網頁上目前的影片和時間接著播（原本會回到切換到網頁時的時間）；原本暫停時重新載入後也維持暫停（和第十四版 R66 AC4 相同，網頁剛載入時暫停一次）。重新載入不記錄歷史。
  - 從 YouTube 網站開啟的影片（第十三版 R63），背景保留的 YouTube 網站頁面的廣告阻擋不受影響（維持第十二版 R57 的關閉）。
  - YouTube 可能偵測到廣告阻擋而顯示警告或限制播放（2026-10-10 討論），使用者已知悉並選擇預設開啟。
- 驗收條件：
  - AC1：YouTube 格子切到網頁模式 → 廣告阻擋顯示「開」。
  - AC2：網頁模式下把廣告阻擋關掉 → 回到播放器 → 再切回網頁 → 廣告阻擋仍是「關」。
  - AC3：網頁模式播放到 5:00 時切換廣告阻擋 → 網頁重新載入，從 5:00 附近接著播。
  - AC4：AC2 的狀態下關閉再開啟程式，再切到網頁 → 廣告阻擋仍是「關」。
  - AC5：AC2 的格子「更換網址」成其他 YouTube 影片，再切到網頁 → 廣告阻擋是「開」。
  - AC6：改用 YouTube 網頁播放的格子、在格子裡逛 YouTube 網站的格子 → 廣告阻擋預設仍是「關」。

### R71：空白格子的「開啟 YouTube」按鈕
- 描述：
  - 空白格子在網址輸入框下方多一個「開啟 YouTube」按鈕，按下後這一格開啟 YouTube 首頁（和第十二版 R57 在格子貼上 YouTube 首頁相同）。
  - 「更換網址」時出現的輸入框不顯示這個按鈕（只在空白格子）。
  - 格子太小、放不下時（格子高度小於 120px）不顯示，仍可以從清單面板開啟。
  - 網址輸入框的操作不變（Enter 放入、Esc 取消）；按「開啟 YouTube」時不需要先在輸入框輸入。
- 驗收條件：
  - AC1：空白格子有「開啟 YouTube」按鈕，按下 → 這一格以整頁模式開啟 YouTube 首頁。
  - AC2：有影片的格子按「更換網址」→ 輸入框下方沒有「開啟 YouTube」。
  - AC3：`3×3` 且視窗縮到最小時，空白格子的輸入框仍然可以使用（按鈕放不下時不顯示）。

### R72：版本號
- 描述：程式版本號從 0.5.2 更新為 0.5.3，並打包。
- 驗收條件：
  - AC1：`npm run dist` → 產生 `release/MultiView-Setup-0.5.3.exe`；安裝後程式的版本是 0.5.3。

## 5. 對前置規格的影響

| 前置需求 | 變更 |
|---|---|
| 第十四版 R66（YouTube ▾ 選單、網頁模式的廣告阻擋關閉） | 選單文字改成「回到網頁」；網頁模式的廣告阻擋預設開啟並記住選擇 |
| 第二版 R17（切換廣告阻擋時重新載入） | YouTube 網頁模式重新載入時接續目前的影片與時間 |
| 第一版 R2（空白格子的輸入框） | 多一個「開啟 YouTube」按鈕 |
| 第一版 R10（設定檔） | 來源多一個「網頁模式的廣告阻擋」選擇 |

## 6. API 變更

無。

## 7. 資料表變更

無。設定檔的來源多一個「網頁模式的廣告阻擋」（舊檔相容：沒有時視為開啟）。

## 8. 非功能需求

- **測試：** 設定檔相容寫成單元測試；畫面以手動驗收。

## 9. 預計影響的檔案

- `src/lib/slots.ts`、`src/lib/settings.ts`：網頁模式的廣告阻擋（R70）
- `src/components/Cell.tsx`、`src/App.tsx`：選單文字、空格按鈕、切換廣告阻擋（R69–R71）
- `src/styles.css`：空格按鈕（R71）
- `package.json`、`package-lock.json`：版本號（R72）
- `tests/unit/`、`tests/manual/`：測試

## 10. 未決事項

- [x] 分支：從 `youtube-page-mode` 開出 `youtube-menu-tweaks`（2026-10-11）。
- [ ] R72：打包完成（0.5.3），使用者的 MultiView 正在執行，尚未安裝。
- [x] 版本號：0.5.3（2026-10-11 確認）。
- [ ] 第十四版 R67（工具列全螢幕文字）仍待驗收：需要實際切換視窗全螢幕，等使用者同意或手動確認。

## 變更紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-10-11 | 初版 | 依 2026-10-11 使用者回饋 |
| 2026-10-11 | 重新載入時暫停的處理與不記錄歷史；背景的 YouTube 網站頁面不受影響；輸入框操作不變；版本號確定 0.5.3 | 第 2 步複查 |
| 2026-10-11 | 實作完成；驗收：選單「回到網頁」；網頁模式廣告阻擋預設「開」，關掉後網頁從 7:02 接著播、回到播放器再切回仍是「關」；空格的「開啟 YouTube」開啟首頁 | 實作完成 |
