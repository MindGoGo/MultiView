# yt-dlp 的更新來源 規格

- 功能代號：`ytdlp-update-channel`
- 狀態：已實作（桌面版 0.8.4，2026-11-15）
- 前置規格：[ytdlp-playback](ytdlp-playback.md)（R89–R95）。需求編號 R160（R119–R159 是 iOS 版、Android 版在 `Phone` 分支使用的編號）。

## 背景

2026 年 11 月 YouTube 的改動讓 yt-dlp 2026.10.26 拿串流時被拒（HTTP 403，yt-dlp issue #17989）。yt-dlp 11/14 在每天建置的版本（nightly）修好，正式版還沒出。使用者希望可以自己選要用正式版或最新版（手機版同時加入同樣的功能）。

## R160：yt-dlp 的更新來源

- 描述：
  - 設定視窗的 yt-dlp 分類多一列「更新來源」，兩段選擇「正式版｜最新版」，預設正式版。說明：「正式版：yt-dlp 的正式發佈。最新版：每天建置的版本，YouTube 改版時通常先在這裡修好。切換後馬上換成那個版本。」
  - 選擇存在 yt-dlp 的更新紀錄（`%APPDATA%\MultiView\bin\update.json` 的 `channel`），不寫進 `settings.json`（設定檔格式不變，手機版也一樣）。
  - 更新（開啟時的自動更新、解析失敗時的更新、手動更新）都用 yt-dlp 的 `--update-to <來源>`（`stable` 或 `nightly`）；查詢最新版（R93）查那個來源的 GitHub Releases（`yt-dlp/yt-dlp` 或 `yt-dlp/yt-dlp-nightly-builds`）。
  - 切換時馬上更新成那個來源的最新版，完成後提示結果（同 R93）。從最新版切回正式版時，即使正式版比較舊也換回正式版；選正式版、但目前用的是最新版的版本（版本號有第四段）時，版本列顯示「有新版」。
- 驗收條件：
  - AC1：設定 → yt-dlp 有「更新來源」，預設正式版，版本列顯示目前的版本。
  - AC2：改成最新版 → 幾秒後提示已更新，版本變成 `2026.11.xx.xxxxxx`；關閉再開啟仍是最新版。
  - AC3：改回正式版 → 版本回到正式版。
  - AC4：舊的 `update.json`（沒有 `channel`）→ 正式版。

## 實作

- `src/lib/ytdlp.ts`：`YtDlpChannel`、`latestReleaseApi`、`UpdateRecord.channel`、`statusOf` 的來源判斷（單元測試 `tests/unit/ytdlp.test.ts`）
- `electron/ytdlp.ts`：`--update-to <來源>`、`setChannel`；`electron/main.ts`、`electron/preload.ts`：`ytdlp:setChannel`
- `src/components/SettingsDialog.tsx`：「更新來源」

## 變更紀錄

| 日期 | 變更 | 原因 |
|---|---|---|
| 2026-11-15 | 初版，實作於 0.8.4 | 使用者要求（YouTube 2026-11 的改動，正式版還沒修好） |
