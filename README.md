# MultiView

在一個視窗裡分割顯示多個直播與影片的 Windows 桌面程式。

想同時看好幾場直播時，不用再開一堆瀏覽器視窗：MultiView 把一個視窗切成 2、4 或 9 格，每格放一個影片，畫面上只有影片本身，哪一格出聲音、要不要全部暫停都能集中控制。

## 功能

- **分割版型**：1、2、2×2、3×3、1+3（左邊大畫面、右邊三個小畫面），可拖曳分隔線調整大小、拖曳交換格子位置，換位不中斷播放。
- **支援的來源**：YouTube 影片與直播、`.mp4`、`.m3u8`（HLS），以及 Twitch、新聞台官網等一般影片網頁。
- **聲音控制**：點一下畫面就只聽那一格；也可以多格同時出聲、各自調整音量（最高 200%，並防止爆音）。
- **每格亮度與總亮度**、畫質選擇、字幕、進度條預覽縮圖、←／→ 快轉倒轉 5 秒、記住觀看進度。
- **yt-dlp 播放（選用）**：用內附的 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 取得影片串流，以程式自己的播放器播放，畫面上沒有 YouTube 的按鈕與廣告。播不了時自動退回內嵌播放器或網頁。yt-dlp 會每天自動更新。
- **網頁模式**：在格子裡直接逛 YouTube 或其他網站，可以只顯示網頁中的影片，內建廣告阻擋。
- **YouTube 小視窗**：另開一個視窗看推薦影片、留言、直播聊天室，或用手機版 YouTube 搜尋。
- **程式內的訂閱清單**：可從 Google Takeout 匯入訂閱頻道，顯示最新影片與直播中的頻道。
- **最愛與歷史**、置頂、全螢幕、單格全螢幕、快捷鍵。
- 關閉後會記住版型、比例、影片清單與聲音設定。

## 安裝

到 [Releases](https://github.com/MindGoGo/MultiView/releases) 下載 `MultiView-Setup-版本號.exe`，雙擊執行即可安裝，不需要系統管理員權限。

- 支援 Windows 10、11（64 位元）。
- 程式沒有數位簽章，第一次執行時 Windows 可能顯示「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。

## 快捷鍵

| 按鍵 | 作用 |
|---|---|
| 空白鍵 | 有任何一格在播放就全部暫停，否則全部播放 |
| M | 全部靜音 |
| 1～9 | 只聽第幾格（由左到右、由上到下編號） |
| F11 | 切換全螢幕 |
| Esc | 離開全螢幕；單格全螢幕時回到分割畫面 |
| ← / → | 滑鼠所在的格子倒轉／快轉 5 秒 |
| Backspace | 從 YouTube 網站開啟的影片回到原本的頁面 |

## 從原始碼建置

需要 [Node.js](https://nodejs.org/) 20.19 以上與 Windows。

```sh
npm install
npm run dev        # 開發模式（第一次會自動下載 yt-dlp 到 vendor/）
npm test           # 單元測試
npm run typecheck  # 型別檢查
npm run dist       # 打包成安裝檔，輸出到 release/
```

其他指令：

- `npm run ytdlp`：下載打包用的 yt-dlp（以 SHA-256 檢查）。
- `npm run adblock:update`：更新 `resources/easylist.txt`。

## 專案結構

| 路徑 | 內容 |
|---|---|
| `electron/` | Electron 主程序、preload（視窗、yt-dlp、廣告阻擋、網頁模式） |
| `src/` | 畫面（React） |
| `tests/unit/` | 單元測試（Vitest） |
| `tests/manual/` | 手動驗收清單與測試用網頁 |
| `doc/specs/` | 各功能的規格文件 |
| `doc/features/` | 各功能的使用說明 |

## 注意事項

- 本程式是個人 side project，與 YouTube、Google 或任何影片網站無關。
- 使用 yt-dlp 播放、廣告阻擋時，請自行遵守各網站的使用條款與當地法規。
- 不支援有 DRM 保護的串流（例如 Netflix）。

## 第三方元件

| 元件 | 授權 |
|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp)（打包時內附） | Unlicense |
| [EasyList](https://easylist.to/)（`resources/easylist.txt`） | GPLv3 或 CC BY-SA 3.0 |
| [@ghostery/adblocker](https://github.com/ghostery/adblocker) | MPL-2.0 |
| [hls.js](https://github.com/video-dev/hls.js) | Apache-2.0 |
| [Electron](https://www.electronjs.org/)、[React](https://react.dev/) | MIT |

## 授權

[GNU General Public License v3.0](LICENSE)

Copyright (C) 2026 Alec
