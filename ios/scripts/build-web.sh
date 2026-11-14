#!/bin/bash
# 產生 iOS 版網頁格子需要的檔案（規格 ios-app R137、R138），放在 ios/Vendor/web/（不放進 repo）：
#   web-inject.js   注入網頁的程式：桌面版的 electron/webPreload.ts 打包成一個檔案
#   adblock/        EasyList 轉成的 WebKit 內容阻擋規則
# 需要 node（npx 會下載固定版本的 esbuild）。執行：ios/scripts/build-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD_VERSION="0.25.10"
OUT="Vendor/web"
rm -rf "$OUT"
mkdir -p "$OUT"

npx --yes "esbuild@$ESBUILD_VERSION" web/inject.ts \
  --bundle --format=iife --target=safari16 --minify-syntax --legal-comments=none \
  --alias:electron=./web/electron-shim.ts \
  --outfile="$OUT/web-inject.js" --log-level=warning
echo "web-inject.js：$(wc -c < "$OUT/web-inject.js") bytes"

node scripts/easylist-to-webkit.mjs ../resources/easylist.txt "$OUT/adblock"
