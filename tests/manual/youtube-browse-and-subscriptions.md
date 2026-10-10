# YouTube 網站瀏覽、訂閱清單、清單分邊：手動驗收步驟

對應規格：`doc/specs/youtube-browse-and-subscriptions.md`（R57–R62）。單元測試見 `tests/unit/youtube-feed.test.ts`、`tests/unit/lists.test.ts`、`tests/unit/source.test.ts`。

## 驗收用的頻道與網址

- YouTube 首頁：`https://www.youtube.com/`
- 一般頻道：`https://www.youtube.com/@TED`
- 24 小時直播的頻道：`https://www.youtube.com/@LofiGirl`
- 用影片網址加入頻道：`https://www.youtube.com/watch?v=jfKfPfyJRdk`

## 驗收步驟

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R57 AC1、AC5 | 空白格貼上 YouTube 首頁，在搜尋框輸入並搜尋 | 整頁模式、沒有「只顯示影片」按鈕、廣告阻擋關閉；可以搜尋；歷史沒有新增首頁 |
| R57 AC2 | 點搜尋結果的一部影片 | 這一格換成那部影片的一般 YouTube 播放；歷史（YouTube）多一筆 |
| R57 AC3 | 貼上 `@TED` 頻道頁 | 整頁模式顯示頻道頁 |
| R57 AC4 | 清單 → YouTube → 「開啟 YouTube」 | 第一個空格開啟 YouTube 首頁 |
| R58 AC1 | 升級前的清單有 YouTube 影片和 Twitch 網址 | 自動分到 YouTube／其他網站 |
| R58 AC3 | YouTube 的歷史按「全部清除」 | 只清除 YouTube 的歷史 |
| R58 AC5 | 在 YouTube 的最愛新增 Twitch 網址 | 加到其他網站的最愛，並提示 |
| R58 AC6 | 選其他網站的歷史，關閉再開啟 | 面板停在其他網站的歷史 |
| R59 AC1–AC3 | 訂閱分頁加入 `@TED`、影片網址；再加一次 TED；加入 `https://example.com` | 出現 TED 與 Lofi Girl；重複與不是頻道時顯示錯誤 |
| R59 AC1、AC4 | 展開 TED；點一下第一部影片；按 ☆ | 最多 15 部、新的在上面；影片放進空格；加到 YouTube 的最愛 |
| R59 AC5 | 移除一個頻道，關閉再開啟 | 移除的消失，其他保留 |
| R60 AC1–AC2 | 訂閱 Lofi Girl | 顯示「● 直播中」並排在最上面；按下播放直播；TED 沒有標示 |
| R61 AC1–AC3 | 按「匯入…」選擇 Google Takeout 的 subscriptions.csv；再選其他 CSV | 匯入並提示數量；其他 CSV 提示不是訂閱清單 |
| R62 | 安裝後看 MultiView.exe 的內容 → 詳細資料 | 版本 0.5.0 |

## 2026-10-10 驗收紀錄

| 需求 | 結果 | 說明 |
|---|---|---|
| R57 AC1–AC3、AC5 | ✅ | 搜尋「TED talk」有 21 筆結果；點第一部影片約 0.7 秒後換成嵌入播放（網頁在換頁時先靜音），歷史只多了這部影片 |
| R57 AC4 | ✅ | 第 0 格開啟 `https://www.youtube.com/` |
| R58 AC1、AC3、AC5、AC6 | ✅ | 確認文字「確定要清除全部 YouTube 的歷史紀錄？」；重開後停在「其他網站／歷史」 |
| R58 AC2、AC4 | ✅（單元測試） | 依網址分類、每一邊各自的 200 筆上限 |
| R59 AC1–AC5 | ✅ | TED 最新 15 部影片，第一部「1 小時前」、最後一部「8 天前」；點一下放進第 1 格（第 0 格不是空格）並嵌入播放 |
| R59 AC6 | ✅（程式判斷、單元測試） | 讀取失敗時顯示「無法取得最新影片」；無法在不影響使用者電腦的情況下中斷網路 |
| R60 AC1–AC2 | ✅ | Lofi Girl 顯示「● 直播中」並排在 TED 上面；按下後第 0 格播放直播（YouTube 回報是直播、正在播放） |
| R61 AC1–AC3 | ✅（單元測試）／未測（選檔視窗） | 中英文欄位、BOM、Windows 換行、名稱有逗號與引號、重複與不是訂閱檔都以單元測試驗證；Windows 選檔視窗需要真實滑鼠，請使用者實際匯入一次 |
| R62 | ✅（打包）／未安裝 | 打包的程式版本 0.5.0；使用者的 MultiView 正在執行，沒有安裝 |
