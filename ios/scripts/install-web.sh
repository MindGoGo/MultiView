#!/bin/bash
# Xcode 的建置步驟：把網頁格子需要的檔案放進 App（規格 ios-app R137、R138）。
# 檔案由 ios/scripts/build-web.sh 產生在 Vendor/web/。
set -euo pipefail

SOURCE="$PROJECT_DIR/Vendor/web"
if [ ! -f "$SOURCE/web-inject.js" ] || [ ! -f "$SOURCE/adblock/manifest.json" ]; then
  echo "error: 找不到 Vendor/web，請先執行 ios/scripts/build-web.sh" >&2
  exit 1
fi
rsync -a --delete "$SOURCE/" "$CODESIGNING_FOLDER_PATH/web/"
echo "網頁格子的檔案：$(du -sh "$CODESIGNING_FOLDER_PATH/web" | cut -f 1)"
