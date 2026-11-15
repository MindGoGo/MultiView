# Android 版：安裝與更新

> 上線版本：Android 0.0.12（第一個有主畫面的版本）　｜　更新日期：2026-11-14

## 這個功能做什麼

MultiView 的 Android 手機／平板版。在一個畫面裡分割顯示多場直播與影片，各格有獨立的聲音。YouTube 預設用 yt-dlp 解析後以原生播放器播放（沒有 YouTube 的廣告，可以多格同時出聲）。目前還在開發中：背景播放、網頁來源的廣告阻擋、清單、訂閱、YouTube 小視窗會在之後的版本加入（規格見 `doc/specs/android-app.md`，測試步驟見 `tests/manual/android-app.md`）。

## 誰可以使用

給自己使用。需要 Android 8.0 以上的手機或平板。App 不上架 Google Play，直接安裝 GitHub Releases 上的 APK。

## 怎麼使用

### 安裝

1. 用手機的瀏覽器到 [Releases](https://github.com/MindGoGo/MultiView/releases)，找標題是「MultiView Android 版本號」的版本，下載 `MultiView-Android-版本號.apk`。
2. 點下載好的檔案安裝。第一次會問要不要允許瀏覽器（或檔案管理）「安裝不明應用程式」，允許後回來繼續安裝。
3. Xiaomi HyperOS 可能會跳出安全掃描或要求登入小米帳號才能安裝，照畫面指示繼續即可。
4. 打開 MultiView，看到空白的格子（「貼上 YouTube、mp4、m3u8 或影片網頁的網址」）。

### 基本操作

- **加入影片**：在空白格按藍色的「貼上」按鈕，或點「輸入網址…」。也可以在 YouTube App、Chrome 按「分享」選 MultiView。
- **聲音**：點一下影片，只聽那一格。要多格同時出聲，先點一下任何影片叫出工具列，再按各格左上角的喇叭。
- **操作列**：點一下影片後出現在那一格下方：播放／暫停、喇叭、音量、亮度、畫質、移動、全螢幕、最愛、更換網址、移除。格子太窄時，部分按鈕收在「⋯」裡。3 秒沒有操作自動收起，再點一下影片也會收起。
- **工具列**：在畫面上方：版型、全部播放／暫停、全部靜音、總亮度、旋轉（按一下轉向並固定，按鈕變藍色；再按一下取消固定）。版本號在工具列最右邊。
- **換位**：長按影片後拖到另一格放開。
- **全螢幕**：操作列的全螢幕按鈕，或兩指在影片上張開；兩指捏合離開。
- **快轉／倒轉**：雙擊影片的右邊／左邊 1/3，一次 10 秒。

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
