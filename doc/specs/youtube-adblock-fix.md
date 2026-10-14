# YouTube 網頁的廣告阻擋實際作用 規格

- 功能代號：`youtube-adblock-fix`
- Jira：無
- 狀態：已確認、已複查、已實作
- 最後更新：2026-10-14
- 前置規格：[web-page-source](web-page-source.md)（R12–R18）、[youtube-web-and-seek](youtube-web-and-seek.md)（R48–R52）、[youtube-browse-and-subscriptions](youtube-browse-and-subscriptions.md)（R57–R62）、[youtube-page-mode](youtube-page-mode.md)（R66–R68）、[youtube-menu-tweaks](youtube-menu-tweaks.md)（R69–R72）。本規格的需求編號從 R73 開始。

## 1. 背景與目標

2026-10-14 使用者回報：YouTube 網頁模式開著廣告阻擋，第一次切到網頁時仍然播放廣告。

排查結果：第二版 R17 AC4 為了合規，規定「YouTube 來源與網頁中內嵌的 YouTube 播放器框架發出的請求不阻擋」，程式以「發出請求的框架是不是 youtube.com」判斷。之後的 YouTube 網頁播放（R48）、逛 YouTube（R57）、YouTube 網頁模式（R66）整個格子都是 youtube.com 的網頁，所有請求都落在這條例外裡，廣告阻擋從來沒有作用（按鈕顯示「開」）。之後看起來沒有廣告，是 YouTube 自己控制廣告頻率。這是先前規格沒有發現的矛盾。

使用者選擇：讓 YouTube 網頁類格子的廣告阻擋真的作用（已知效果有限、YouTube 可能偵測，2026-10-10 討論）。

## 2. 範圍

**包含：**
- YouTube 網頁類格子開啟廣告阻擋時，網頁本身套用阻擋（R73）
- 版本號更新並打包（R74）

**不包含：**
- 一般 YouTube 播放（嵌入播放器）：不經過網頁來源的廣告阻擋，維持不阻擋（第一版）
- 其他網站裡內嵌的 YouTube 播放器：維持不阻擋（第二版 R17 AC4）
- 保證擋掉所有 YouTube 廣告：YouTube 的部分廣告和影片走同一個伺服器，網路層擋不乾淨

## 3. 共用定義

- **YouTube 網頁類格子：** 整個格子顯示的網頁是 youtube.com：YouTube 網頁播放（第九版 R48）、逛 YouTube（第十二版 R57）、YouTube 網頁模式（第十四版 R66）。

## 4. 需求清單

### R73：YouTube 網頁類格子的廣告阻擋實際作用
- 描述：
  - 廣告阻擋的例外規則改成：發出請求的框架是 YouTube，而且格子最上層的網頁**不是** YouTube 時（其他網站裡內嵌的 YouTube 播放器），才不阻擋。
  - 格子最上層的網頁是 YouTube、而且這一格的廣告阻擋開啟時，網路請求與廣告元素的隱藏都照常套用（和一般網頁來源相同，第二版 R17）。
  - 「格子最上層的網頁」以發出請求的框架所屬的最上層框架網址判斷（不用整個網頁目前的網址：換頁時會有短暫的落差，可能讓新網頁一開始的請求判斷錯誤）。廣告元素的隱藏也用同樣的判斷。
  - 廣告阻擋關閉時和現在相同，完全不阻擋。
  - 各種格子的廣告阻擋預設值不變（網頁模式開啟，R70；網頁播放、逛 YouTube 關閉）。
- 驗收條件：
  - AC1：YouTube 網頁模式、廣告阻擋開啟，載入影片網頁 → 程式擋下 YouTube 網頁發出的廣告請求（以開發工具記錄被擋下的請求數，大於 0）。
  - AC2：同一部影片、廣告阻擋關閉 → 沒有任何請求被擋下。
  - AC3：一般網頁來源裡內嵌的 YouTube 播放器（例如本機測試網頁）→ 播放器發出的請求不被擋下（第二版 R17 AC4）。
  - AC4：一般 YouTube 播放（嵌入播放器）→ 不受影響。
  - AC5：連續多次切換到網頁模式（含第一次），記錄是否出現片頭廣告；實測結果記錄在驗收紀錄（YouTube 的廣告不一定每次出現，且可能有擋不掉的廣告）。

### R74：版本號
- 描述：程式版本號從 0.5.3 更新為 0.5.4，並打包。
- 驗收條件：
  - AC1：`npm run dist` → 產生 `release/MultiView-Setup-0.5.4.exe`；安裝後程式的版本是 0.5.4。

## 5. 對前置規格的影響

| 前置需求 | 變更 |
|---|---|
| 第二版 R17 AC4（YouTube 框架的請求不阻擋） | 只在其他網站內嵌的 YouTube 播放器時不阻擋；YouTube 網頁類格子依廣告阻擋開關阻擋 |

## 6. API 變更

無。

## 7. 資料表變更

無。

## 8. 非功能需求

- **技術風險：** YouTube 的片頭廣告有一部分和影片走同一個伺服器（googlevideo），EasyList 的網路規則不一定擋得掉；YouTube 可能偵測到阻擋而顯示警告、限制播放。實作時實測並如實記錄效果。
- **測試：** 例外規則（框架與最上層網頁的組合）寫成單元測試；阻擋效果以手動驗收。

## 9. 預計影響的檔案

- `src/lib/adblockRules.ts`：例外規則（R73）
- `tests/manual/web-pages/embed.html`（新）：內嵌 YouTube 播放器的一般網頁（R73 AC3）
- `electron/adblock.ts`：取得格子最上層的網頁網址（R73）
- `package.json`、`package-lock.json`：版本號（R74）
- `tests/unit/`、`tests/manual/`：測試

## 10. 未決事項

- [x] 分支：從 `youtube-menu-tweaks` 開出 `youtube-adblock-fix`（2026-10-14）。
- [ ] 實際效果依 YouTube 而定：開著時擋下廣告投放與片頭廣告的請求（實測 30 秒 7 個），但 YouTube 可能改用擋不掉的方式播放廣告，或偵測到阻擋。
- [x] 版本號：0.5.4（2026-10-14 確認）。

## 變更紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-10-14 | 初版 | 使用者回報與排查結果，使用者選擇讓廣告阻擋實際作用 |
| 2026-10-14 | 以請求所屬的最上層框架網址判斷；新增內嵌 YouTube 的測試網頁；版本號確定 0.5.4 | 第 2 步複查 |
| 2026-10-14 | 實作完成；驗收結果見 tests/manual/youtube-adblock-fix.md | 實作完成 |
