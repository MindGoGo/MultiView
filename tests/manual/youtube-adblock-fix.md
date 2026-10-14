# YouTube 網頁的廣告阻擋實際作用：手動驗收步驟

對應規格：`doc/specs/youtube-adblock-fix.md`（R73–R74）。單元測試見 `tests/unit/adblock.test.ts`（R73）。測試網頁：`tests/manual/web-pages/embed.html`（一般網頁裡內嵌 YouTube 播放器）。

## 驗收步驟

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R73 AC1–AC2 | YouTube 格子切到網頁模式（廣告阻擋開），再關掉 | 開著時擋下廣告請求；關掉後不擋 |
| R73 AC3 | 格子放 `http://127.0.0.1:8701/embed.html`（`node tests/manual/web-pages/server.mjs`） | 內嵌的 YouTube 播放器沒有請求被擋 |
| R73 AC4 | 一般 YouTube 播放 | 不受影響 |
| R73 AC5 | 連續切換到網頁模式數次 | 記錄是否出現片頭廣告 |
| R74 | 安裝後看版本 | 0.5.4 |

## 2026-10-14 驗收紀錄

驗收時在主程序暫時印出被擋下的請求（驗收後已移除，沒有提交）。

| 需求 | 結果 | 說明 |
|---|---|---|
| R73 AC1 | ✅ | 網頁模式、廣告阻擋開，30 秒內擋下 7 個：`google.com/pagead`、`googleads.g.doubleclick.net/pagead`、`youtube.com/pagead`、`google.com.tw/pagead`、`static.doubleclick.net/instream` |
| R73 AC2 | ✅ | 關閉後 30 秒內新增 0 個 |
| R73 AC3 | ✅ | embed.html 裡內嵌的 YouTube 播放器沒有請求被擋 |
| R73 AC4 | ✅（程式判斷） | 一般 YouTube 播放用的是另一個網站資料區，不經過廣告阻擋 |
| R73 AC5 | ✅（有限） | 廣告阻擋開著時連續 3 次切到網頁模式，都沒有出現片頭廣告；YouTube 的廣告不一定每次出現，不能保證完全沒有 |
| R74 | ✅ | 安裝後版本 0.5.4 |

## 排查紀錄

- 原因：第二版 R17 AC4 以「發出請求的框架是 youtube.com」判斷不阻擋，YouTube 網頁類格子整個都是 youtube.com，所有請求都被放行，按鈕顯示「開」但沒有作用。使用者看到「之後沒有廣告」是 YouTube 自己控制廣告頻率。
- 測試工具的副作用：用開發工具對網頁下「重新載入」會讓網頁模式的格子變回播放器，這是測試工具的操作，使用者一般不會遇到，因此改用主程序紀錄計數。
