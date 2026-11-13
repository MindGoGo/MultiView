# iPad／iPhone 版：手動驗收步驟

對應規格：`doc/specs/ios-app.md`（R119–R144）。單元測試在 `ios/MultiViewCore/Tests/`，由 GitHub Actions 執行（沒有 Mac，不能在本機跑）。

安裝方式見 `doc/features/ios-app.md`。

## 步驟 1：建置與安裝流程（R119，`ios-v0.0.1`）

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R119 AC1 | 推送改到 `ios/` 的 commit，看 GitHub 的 Actions 頁面 | 「iOS」workflow 的「測試與模擬器編譯」成功 |
| R119 AC2 | 推送 `ios-v0.0.1` 標籤 | Releases 出現「MultiView iOS 0.0.1」，附 `MultiView-iOS-0.0.1.ipa`；`ios-source` 版本裡有 `sidestore-source.json`，內容指向這個 IPA |
| R119 AC3 | 在 iPad 的 SideStore 加入來源網址，安裝 MultiView 後開啟 | 看得到圖示（四個彩色格子），開啟後黑底顯示「MultiView iOS 0.0.1」，沒有狀態列 |
| R119 AC3 | 在 iPhone 重複一次 | 同上 |
| R119 AC4 | 發佈 `ios-v0.0.2` 後打開 SideStore | 顯示 MultiView 有更新；更新後開啟顯示新的版本號（資料保留要等有設定可存的版本再驗一次） |
| R119 AC5 | 看 Actions 的「包成 IPA」步驟 | 沒有「IPA 裡有 App 延伸功能」的錯誤 |

## 驗收紀錄

（驗收後填寫）
