# iPad／iPhone 版：手動驗收步驟

對應規格：`doc/specs/ios-app.md`（R119–R144）。單元測試在 `ios/MultiViewCore/Tests/`，由 GitHub Actions 執行（沒有 Mac，不能在本機跑）。

安裝方式見 `doc/features/ios-app.md`。

## 步驟 1：建置與安裝流程（R119，`ios-v0.0.1`）

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R119 AC1 | 推送改到 `ios/` 的 commit，看 GitHub 的 Actions 頁面 | 「iOS」workflow 的「測試與模擬器編譯」成功 |
| R119 AC2 | 在 GitHub 網頁的 Releases 建立 `ios-v0.0.1` 標籤（或推送標籤） | Releases 出現「MultiView iOS 0.0.1」，附 `MultiView-iOS-0.0.1.ipa`；`ios-source` 版本裡有 `sidestore-source.json`，內容指向這個 IPA |
| R119 AC3 | 在 iPad 的 SideStore 加入來源網址，安裝 MultiView 後開啟 | 看得到圖示（四個彩色格子），開啟後黑底顯示「MultiView iOS 0.0.1」，沒有狀態列 |
| R119 AC3 | 在 iPhone 重複一次 | 同上 |
| R119 AC4 | 發佈 `ios-v0.0.2` 後打開 SideStore | 顯示 MultiView 有更新；更新後開啟顯示新的版本號（資料保留要等有設定可存的版本再驗一次） |
| R119 AC5 | 看 Actions 的「包成 IPA」步驟 | 沒有「IPA 裡有 App 延伸功能」的錯誤 |

## 語音選單（R135 的聲音軌，`ios-v0.0.29`）

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R135 AC4 | 系統語言是繁體中文，貼上有 AI 配音的 YouTube 影片（例如 https://www.youtube.com/watch?v=fg1H4WCdkNI ），用 yt-dlp 播放 | 聽到的是原本的中文聲音，不是英文 AI 配音 |
| R135 AC4 | 點一下這一格，按操作列的「語音」（窄的格子在「⋯」裡） | 列出「中文（繁體）（原本的聲音）」「英文（美國）（AI 配音）」之類的選項，目前的打勾 |
| R135 AC4 | 選另一條 | 提示「語音：<名稱>」，幾秒內換成那條聲音，影片不從頭播放 |
| R135 AC4 | 從 App 切換器滑掉 App 再開，播放這一格 | 仍然是上一步選的語言 |
| R135 | 只有一條聲音的影片、內嵌播放器、網頁格子 | 沒有「語音」 |

## 字幕、進度條的預覽縮圖（R131，`ios-v0.0.30`）

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R131 AC4 | 貼上有字幕的 YouTube 影片（TED 的 https://www.youtube.com/watch?v=iG9CE55wbtY ），用 yt-dlp 播放，點一下格子 | 操作列有「字幕」按鈕（CC 圖示；窄的格子在「⋯」裡） |
| R131 AC4 | 按「字幕」 | 列出「關閉」和各種語言（有中文），「關閉」打勾 |
| R131 AC4 | 選中文 | 提示「字幕：中文…」；幾秒內影片下方出現白字黑底的中文字幕，跟著影片的時間換；按鈕變成強調色 |
| R131 AC4 | 單格全螢幕、再回到分割畫面 | 字的大小跟著格子變大、變小 |
| R131 AC4 | 選有「（自動產生）」的語言 | 出現自動字幕，同一行不會一直重複出現 |
| R131 AC4 | 選「關閉」 | 字幕消失，按鈕不再是強調色 |
| R131 AC4 | 開著中文字幕，從 App 切換器滑掉 App 再開，播放這一格；和另一格換位 | 字幕仍然開著；換位後字幕跟著影片 |
| R131 AC4 | 開著字幕的格子「更換網址」成另一部有中文字幕的影片 | 新的影片也自動顯示中文字幕 |
| R131 AC4 | 沒有字幕的影片（https://www.youtube.com/watch?v=aqz-KE-bpKQ ）、內嵌播放器、網頁格子 | 沒有「字幕」 |
| R131 AC5 | YouTube 一般影片（yt-dlp 或內嵌）：按住進度條左右拖 | 手指上方出現縮圖和時間，跟著手指換；放開後消失、跳到那個位置 |
| R131 AC5 | mp4（例如 https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4 ）：拖進度條 | 一下子後出現那個位置的畫面；播放、聲音不中斷 |
| R131 AC5 | m3u8、其他網站：拖進度條 | 只有時間 |
| R131 AC5 | 可回放的直播：拖進度條 | 只有時間，顯示「-1:23」之類距離最新位置多久 |
| R131 AC5 | 拖到最左、最右 | 提示完整顯示，不超出進度條的範圍 |
| R131 AC5 | iPhone 直向 2×2 之類很窄的格子：拖進度條 | 進度條比縮圖窄時只有時間 |

## 驗收紀錄

（驗收後填寫）
