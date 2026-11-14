#!/bin/bash
# 產生 Android 版網頁格子需要的檔案（規格 android-app R157），放在 android/app/build/generated/multiview-assets/（不放進 repo）：
#   web-inject.js   注入網頁的程式：桌面版的 electron/webPreload.ts 打包成一個檔案
#   adblock/        EasyList 轉成的規則（和 iOS 版相同的轉換程式）
# 需要 node（npx 會下載固定版本的 esbuild）。執行：android/scripts/build-web.sh
# 沒有執行這個腳本也能編譯 App，只是網頁格子沒有「只顯示影片」和廣告阻擋。
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD_VERSION="0.25.10"
OUT="app/build/generated/multiview-assets"
rm -rf "$OUT"
mkdir -p "$OUT"

npx --yes "esbuild@$ESBUILD_VERSION" web/inject.ts \
  --bundle --format=iife --target=chrome100 --minify-syntax --legal-comments=none \
  --alias:electron=./web/android-shim.ts \
  --outfile="$OUT/web-inject.js" --log-level=warning
echo "web-inject.js：$(wc -c < "$OUT/web-inject.js") bytes"

node ../ios/scripts/easylist-to-webkit.mjs ../resources/easylist.txt "$OUT/adblock"
