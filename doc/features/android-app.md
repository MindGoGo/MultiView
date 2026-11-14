# Android 版：安裝與更新

> 上線版本：Android 0.0.3（技術驗證版，測試畫面）　｜　更新日期：2026-11-14

## 這個功能做什麼

MultiView 的 Android 手機／平板版。目前是技術驗證版，打開是測試畫面：同時播放多格原生播放器（m3u8）或多格 YouTube 內嵌播放器，確認能不能同時出聲、各自調音量（步驟見 `tests/manual/android-app.md`）。多格播放等功能會在之後的版本陸續加入（規格見 `doc/specs/android-app.md`）。

## 誰可以使用

給自己使用。需要 Android 8.0 以上的手機或平板。App 不上架 Google Play，直接安裝 GitHub Releases 上的 APK。

## 怎麼使用

### 安裝

1. 用手機的瀏覽器到 [Releases](https://github.com/MindGoGo/MultiView/releases)，找標題是「MultiView Android 版本號」的版本，下載 `MultiView-Android-版本號.apk`。
2. 點下載好的檔案安裝。第一次會問要不要允許瀏覽器（或檔案管理）「安裝不明應用程式」，允許後回來繼續安裝。
3. Xiaomi HyperOS 可能會跳出安全掃描或要求登入小米帳號才能安裝，照畫面指示繼續即可。
4. 打開 MultiView，上方顯示「MultiView Android 版本號」。

### 更新

- **直接安裝新版**：下載新版的 APK 安裝，會覆蓋舊版，設定與資料保留。
- **用 Obtainium 自動提示更新**（選用）：安裝 [Obtainium](https://github.com/ImranR98/Obtainium)，新增 App，來源網址填 `https://github.com/MindGoGo/MultiView`。這個 repo 也有桌面版、iOS 版的 Releases，所以要在 Obtainium 的設定裡把版本標題篩選成 `MultiView Android`、APK 檔名篩選成 `MultiView-Android-.*\.apk`。

## 限制與注意事項

- **不要移除 App 再裝**：移除會刪掉設定與清單。直接安裝新版就會覆蓋。
- 所有發佈的 APK 都用同一把簽章金鑰簽章，所以可以覆蓋安裝。如果金鑰遺失，新版要先移除舊版才能安裝（資料會不見），請保管好金鑰的備份。
- GitHub Actions 每次編譯也會產生 debug 版（`MultiView-Android-debug`，在 Actions 執行結果的 Artifacts）。debug 版的名稱是「MultiView」但套件名稱不同（`local.multiview.android.debug`），可以和正式版同時安裝；它的簽章每次編譯都可能不同，更新 debug 版時可能要先移除。

## 給開發者：發佈新版

1. 改 `android/gradle.properties` 的 `multiview.versionName`，並把更新內容寫在 `android/release-notes.txt`。versionCode 由版本號自動算出來（`1.2.3` → `1002003`）。
2. 推送就好，**不用自己建立標籤**。GitHub Actions（`.github/workflows/android.yml`）測試與編譯通過後，發現這個版本號還沒有發佈過，就自動建立標籤 `android-v<版本號>` 與 Release（標題「MultiView Android 版本號」，不標成最新版本），用 Secrets 裡的金鑰（`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`）編譯簽章的 APK 放上去。
3. 版本號沒有變的推送只測試與編譯，不發佈。測試沒過也不發佈。

也可以手動建立 `android-v<版本號>` 標籤（例如在 GitHub 網頁的 Releases），效果相同；標籤和 `multiview.versionName` 不一致時 Actions 會報錯。

在電腦上開發時：

- 只跑邏輯的單元測試，不需要 Android SDK：`cd android && ./gradlew :core:test`
- 編譯 App 需要 Android SDK（設定 `ANDROID_HOME`，或在 `android/local.properties` 寫 `sdk.dir=…`）：`cd android && ./gradlew :app:assembleDebug`
