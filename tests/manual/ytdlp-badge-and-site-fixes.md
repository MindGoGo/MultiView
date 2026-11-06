# 播放方式的小標示、其他網站串流的修正：手動驗收步驟

對應規格：`doc/specs/ytdlp-badge-and-site-fixes.md`（R109–R112）。單元測試見 `tests/unit/badge-and-headers.test.ts`。

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R109 AC1 | 滑鼠移到 yt-dlp 播放的 YouTube 格子；移開 | 左上角綠色「yt-dlp」；移開後消失 |
| R109 AC2 | 內嵌播放器的 YouTube 格子 | 「內嵌播放器」 |
| R109 AC3 | 其他網站 yt-dlp／網頁／退回 | 「yt-dlp」／「網頁」／「網頁（yt-dlp 無法播放）」 |
| R109 AC4 | mp4、m3u8 網址 | 沒有小標示 |
| R109 AC5 | 有聲音的格子 | 小標示在 🔊 右邊 |
| R110 AC1 | Twitch 正在直播的頻道 | 程式的播放器播放、有畫質選單、標示 yt-dlp |
| R110 AC2 | 影片網站 A 影片 | 播放影片本身，沒有轉到 `na.mp4` |
| R110 AC3 | YouTube、TED、Dailymotion、archive.org | 仍然正常 |
| R111 AC1 | 貼 yt-dlp 不支援的網站 | 退回網頁，沒有更新 yt-dlp |
| R112 | `npm run dist`、安裝 | `MultiView-Setup-0.8.1.exe`，「關於」顯示 0.8.1 |

## 2026-11-07 驗收紀錄

以 build 後的開發版、獨立的測試資料夾、`3×3` 版型執行，透過開發工具（CDP）讀取畫面、記錄網路請求與實際送出的標頭。部分網站只確認網路請求與播放狀態，不看、不截圖影片內容。

| 需求 | 結果 | 說明 |
|---|---|---|
| R109 AC1 | ✅ | Twitch 格子滑鼠移上去：左上角綠色「yt-dlp」 |
| R109 AC2 | ✅ | 一般影片改成內嵌播放器後，YouTube 格子的標示是「內嵌播放器」，說明「用 YouTube 官方的內嵌播放器播放」 |
| R109 AC3、AC5 | ✅ | example.com：「🔊 網頁（yt-dlp 無法播放）」並排 |
| R109 AC4 | ✅（單元測試） | |
| R110 AC1 | ✅ | Twitch（kaicenat 直播中）：用程式的播放器播放（3×3 小格子自動畫質 256×144）。修正前各畫質清單全部 403 |
| R110 AC2 | ✅ | 影片網站 A：1280×720、長度約 2 小時，沒有 `na.mp4` 的請求。實際送出的標頭：沒有 Origin、Sec-Fetch，Referer 是影片頁網址 |
| R110 AC3 | ✅ | YouTube（yt-dlp）、TED、Dailymotion、archive.org 同時播放正常 |
| R111 AC1 | ✅（單元測試） | 「Unsupported URL」判斷為一般失敗 |
| 整頁模式的小標示 | ⏳ | 整頁模式由真實游標位置顯示操作區，開發工具的模擬滑鼠無法觸發，待使用者確認 |

### 實作時發現

- 影片網站 A 除了 Origin，還會看 `Sec-Fetch-Site: cross-site`（瀏覽器自動加上），一律換成禁止播放的影片；送出前拿掉 Sec-Fetch-* 後正常。
- Twitch 直播沒有登入時會插入廣告（畫面顯示「Commercial break in progress」），這是 Twitch 的行為。
