# iPad／iPhone 版：安裝與更新

> 上線版本：iOS 0.0.1（測試版，只有空畫面）　｜　更新日期：2026-11-13

## 這個功能做什麼

MultiView 的 iPad／iPhone 版。目前是第一個測試版，打開只有一個顯示版本號的畫面，用來確認「編譯 → 安裝到 iPad → 更新」這條路走得通。多格播放等功能會在之後的版本陸續加入（規格見 `doc/specs/ios-app.md`）。

## 誰可以使用

給自己使用。需要：

- iPadOS／iOS 17 以上的 iPad 或 iPhone
- 一個 Apple ID（免費的就可以）
- 第一次設定 SideStore 時需要一台電腦（Windows 可以）

App 不上架 App Store，用 [SideStore](https://sidestore.io/) 以你自己的 Apple ID 簽章後安裝。

## 怎麼使用

### 第一次：安裝 SideStore

SideStore 的安裝步驟會隨版本調整，請照官方說明做：<https://docs.sidestore.io/>。大致是：

1. 在 iPad 的「設定 → 隱私權與安全性」開啟「開發者模式」（要重新開機）。
2. 在電腦上照官方說明把 SideStore 裝到 iPad，並產生「配對檔」放進 SideStore。
3. 在 iPad 安裝官方說明指定的 VPN App（SideStore 靠它在 iPad 上自己完成簽章，不會把流量送到外面）。
4. 打開 SideStore，用 Apple ID 登入。

### 安裝 MultiView

1. 打開 SideStore →「Sources」（來源）→ 右上角「+」。
2. 貼上來源網址後加入：

   ```
   https://github.com/MindGoGo/MultiView/releases/download/ios-source/sidestore-source.json
   ```

3. 在「Browse」找到 MultiView，按「FREE」安裝。
4. 回到主畫面打開 MultiView。第一次開啟如果顯示「未受信任的開發者」，到「設定 → 一般 → VPN 與裝置管理」信任你的 Apple ID。

也可以不加來源，直接安裝單一版本：用 Safari 到 [Releases](https://github.com/MindGoGo/MultiView/releases) 下載 `MultiView-iOS-版本號.ipa`，在 SideStore 的「My Apps」按「+」選這個檔案。

### 更新

有新版時，SideStore 的「My Apps」會顯示 MultiView 有更新，按「UPDATE」。更新後設定、清單、登入狀態都會保留。

### 每 7 天重新簽章

用免費 Apple ID 時，簽章 7 天後失效，失效後 App 打不開（資料不會消失）。請每隔幾天打開 SideStore，在「My Apps」按「Refresh All」；也可以照 SideStore 的說明設定自動重新簽章。

## 限制與注意事項

- 免費 Apple ID 同時最多只能有 3 個自己簽章的 App，SideStore 本身占 1 個。
- 簽章過期後重新簽章即可，不需要移除 App。**移除 App 會刪掉設定與清單。**
- iPad 和 iPhone 要分別安裝 SideStore 與 MultiView。
- 來源網址和 IPA 要能下載，GitHub 的 repo 必須是公開的。

## 給開發者：發佈新版

1. 改 `ios/project.yml` 的 `MARKETING_VERSION`，並把更新內容寫在 `ios/release-notes.txt`。
2. 推送標籤 `ios-v<版本號>`（例如 `ios-v0.1.0`）。也可以在 GitHub 網頁的 Releases 按「Draft a new release」，建立這個名稱的新標籤、選好分支後發佈。
3. GitHub Actions（`.github/workflows/ios.yml`）會跑測試、編譯沒有簽章的 IPA、放到 Releases，並更新 `ios-source` 這個固定版本裡的 SideStore 來源檔。

在 Mac 上開發時：`brew install xcodegen`，然後 `cd ios && xcodegen generate` 產生 `MultiView.xcodeproj`（不放進 repo）。
