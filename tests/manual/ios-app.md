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

## 驗收紀錄

（驗收後填寫）
