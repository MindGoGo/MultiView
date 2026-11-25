# yt-dlp 播放起播速度研究

- 狀態：研究結論，尚未排入開發
- 日期：2026-11-25
- 相關規格：[ytdlp-playback](../specs/ytdlp-playback.md)（R89–R93）、[ytdlp-update-channel](../specs/ytdlp-update-channel.md)（R160）

## 1. 問題

YouTube 官方播放器幾乎一點就播，用 yt-dlp 播放卻要等好幾秒。

## 2. 結論：程式沒有在下載影片

目前的 yt-dlp 播放已經是串流（`electron/ytdlp.ts`）：

```
啟動 yt-dlp.exe → -J 解析（網頁、player JS、n/sig 挑戰）→ pickStream 挑 HLS 或 360p mp4
→（只有 mp4）waitUntilServed 試讀 → hls.js 或 <video> 串流播放
```

等待時間幾乎都花在**拿到串流網址之前**。YouTube 官方播放器在網頁載入時就已經拿到解好的串流資訊，不用付這段成本；之後的分段串流、自適應畫質兩邊是一樣的。

## 3. 耗時來源（依影響大小排列）

> 下面的秒數是依經驗估的，**未實測**（研究環境連不到 YouTube，也不是 Windows）。

| # | 環節 | 估計耗時 | 位置與原因 |
|---|---|---|---|
| 1 | yt-dlp 解析本身 | 2–6 秒 | yt-dlp 預設會用好幾種 YouTube 客戶端身分（player_client）各發一次請求，還要下載 player JS；解 n 挑戰時，每次都會再啟動一個 Electron 當 Node（`--js-runtimes node:${process.execPath}`） |
| 2 | yt-dlp.exe 冷啟動 | 1–3 秒 | `scripts/fetch-yt-dlp.mjs` 抓的是單一檔案版 `yt-dlp.exe`（PyInstaller onefile），每次執行都要把 Python 環境解壓到暫存資料夾，Windows Defender 還會掃描 |
| 3 | `waitUntilServed` | 約 3 秒，最多 10 秒 | 只影響沒有 HLS 的一般影片（mp4）與其他網站；用來避開剛解析出的網址前幾秒回 403 |
| 4 | 同時解析數上限 3 | 格子多時倍增 | `src/lib/ytdlpResolver.ts` 的 `concurrency ?? 3`；9 宮格開啟時要排 2～3 輪 |
| 5 | hls.js 起播 | 0.5–1 秒 | master 清單 → 子清單 → 第一個片段；官方播放器也有這段 |

已經做得好的部分：解析結果快取到網址有效期限前 10 分鐘、同一部影片同時只解析一次（`inflight`），所以重新載入同一格很快。

## 4. 可以改善的方向

| 代號 | 做法 | 預期效果 | 代價與風險 |
|---|---|---|---|
| A | 改用 onedir 版 yt-dlp（`yt-dlp_win.zip`） | 每次解析省 1–2 秒 | 打包腳本要改；onedir 版不能用 `--update-to` 自我更新，R92／R160 的更新要改成自己下載 zip 再替換 |
| B | 限縮 player_client（`--extractor-args youtube:player_client=…`） | 省 1–3 秒 | YouTube 常調整各客戶端的行為，選錯可能拿不到 HLS 或失敗率上升；要搭配「失敗時改用預設客戶端重試」 |
| C | 預先解析（開啟程式、載入清單、滑鼠移到清單項目上時在背景解析） | 切換時幾乎可以立刻播 | 多出背景請求；可以直接沿用現有的快取 |
| D | 同時解析數 3 → 例如 6 | 多格同時開啟時變快 | CPU 負擔與被 YouTube 限流的風險增加 |
| E | 長駐 yt-dlp 程序（內嵌 Python 常駐） | 冷啟動與 import 成本只付一次 | 架構改動最大，不建議作為第一步 |

## 5. 建議的下一步

先加計時紀錄（啟動 yt-dlp → yt-dlp 結束 → 試讀完成 → 第一個畫面），在 Windows 上實測，確認真正的瓶頸是哪一段，再決定要做 A～E 的哪幾項。
