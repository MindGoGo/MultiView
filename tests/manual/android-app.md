# Android 版：手動驗收步驟

對應規格：`doc/specs/android-app.md`（R145–R159）。單元測試在 `android/core/src/test/`，可以在本機跑（`cd android && ./gradlew :core:test`），GitHub Actions 也會執行。

安裝方式見 `doc/features/android-app.md`。測試裝置：POCO F6 Pro（HyperOS 3，Android 16）。

## 步驟 1：建置與安裝流程（R145，`android-v0.0.1`）

| 需求 | 步驟 | 預期結果 |
|---|---|---|
| R145 AC1 | 推送改到 `android/` 的 commit，看 GitHub 的 Actions 頁面 | 「Android」workflow 的「測試與編譯」成功，Artifacts 有 `MultiView-Android-debug` |
| R145 AC2 | 推送版本號還沒發佈過的提交（0.0.1），看 Actions | 「判斷要不要發佈」顯示「還沒有發佈：測試通過後自動發佈」；「產生簽章的 APK 並發佈」成功；Releases 出現「MultiView Android 0.0.1」與標籤 `android-v0.0.1`，附 `MultiView-Android-0.0.1.apk`，沒有標成最新版本 |
| R145 AC2 | 再推送一個沒有改版本號的提交 | 只跑「測試與編譯」，「產生簽章的 APK 並發佈」被略過 |
| R145 AC2 | 在手機下載 APK 安裝後開啟 | 看得到圖示（四個彩色格子），開啟後黑底顯示「MultiView」與「MultiView Android 0.0.1」，文字沒有被瀏海或導覽列擋住 |
| R145 AC3 | 版本號升到 0.0.2 並推送（自動發佈）後下載安裝 | 直接覆蓋安裝（沒有「與現有套件衝突」的錯誤），開啟顯示新的版本號（資料保留要等有設定可存的版本再驗一次） |

## 驗收紀錄

（驗收後填寫）
