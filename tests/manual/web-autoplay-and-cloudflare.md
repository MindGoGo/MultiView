# 網頁找不到影片時自動按播放、yt-dlp 遇到 Cloudflare 時重試：手動驗收步驟

對應規格：`doc/specs/web-autoplay-and-cloudflare.md`（R113–R115）。單元測試見 `tests/unit/web-kick.test.ts`。

測試網頁：`node tests/manual/web-pages/server.mjs` 啟動本機伺服器（`http://127.0.0.1:8701/`，跨網域的子框架用 `http://localhost:8702/`）。

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R113 AC1 | 其他網站選「網頁」→ 貼 `http://127.0.0.1:8701/click-to-play.html`、`click-to-play-frame.html` | 幾秒內自動開始，只顯示影片，不切換成整頁模式 |
| R113 AC2 | 貼 `click-to-play.html?b=2`，馬上切到「顯示整個網頁」，之後按「只顯示影片」 | 「正在找影片…」後只顯示影片 |
| R113 AC3 | 貼 `play-in-link.html`（播放鈕在連結裡）、example.com | 不按連結，15 秒後切成整頁模式；按「只顯示影片」→「正在找影片…」→「找不到影片」 |
| R113 AC4 | 一般有影片的網頁 | 和 0.8.1 相同 |
| R114 AC2 | 其他網站選 yt-dlp → 貼 影片網站 C 的外連網址 | 重試後退回網頁，小標示「網頁（yt-dlp 無法播放）」 |
| R115 | `npm run dist`、安裝 | `MultiView-Setup-0.8.2.exe`，「關於」顯示 0.8.2 |

## 2026-11-07 驗收紀錄

以 build 後的開發版、獨立的測試資料夾執行，透過開發工具（CDP）讀取格子狀態。部分網站只讀取網頁的標題、元素結構與播放狀態，不截圖內容。

| 需求 | 結果 | 說明 |
|---|---|---|
| R113 AC1 | ✅ | `click-to-play.html` 3 秒內開始播放（操作區出現「暫停這一格」）；播放器在跨網域子框架的 `click-to-play-frame.html` 6 秒內開始播放；兩格都維持影片模式 |
| R113 AC2 | ✅ | 整頁模式按「只顯示影片」→ 0.5 秒內切到影片模式 |
| R113 AC3 | ✅ | `play-in-link.html`：沒有按（網址仍是原本的頁面，沒有跳到連結），15 秒後切成整頁模式；按「只顯示影片」→「正在找影片…」約 6 秒後「找不到影片」。example.com 15 秒後切成整頁模式（和原本相同） |
| R113 AC1（實際網站） | ⏳ | 影片網站 B 驗收時顯示「This site is now under maintenance」（curl 也是 403），無法驗證，待網站恢復後由使用者確認 |
| R114 AC1 | ✅（單元測試） | |
| R114 AC2 | ✅ | 影片網站 C 的外連網址：Cloudflare 重試後 yt-dlp 回報不支援，退回網頁，小標示「網頁（yt-dlp 無法播放）」 |
| R113 AC4 | ⏳ | 未另外測（找得到影片時不會進入自動按播放的流程） |
