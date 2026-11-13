#!/bin/bash
# 下載 iOS 版要內附的 Python 和 yt-dlp（規格 ios-app R122），放在 ios/Vendor/（不放進 repo）。
#   Vendor/Python.xcframework   BeeWare 的 Python-Apple-support：iOS 版的 Python 與標準函式庫
#   Vendor/site-packages        yt-dlp、yt-dlp-ejs（解 YouTube JS 驗證的程式）、certifi（憑證）
# 需要 gh（GitHub CLI，要有 GH_TOKEN 或已登入）和 python3。執行：ios/scripts/fetch-python.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON_SERIES="3.13"
# 固定版本；留空時用這個系列最新的版本（並印出來，方便之後固定）
SUPPORT_TAG="${PYTHON_SUPPORT_TAG:-}"
SUPPORT_SHA256="${PYTHON_SUPPORT_SHA256:-}"
YTDLP_VERSION="2026.10.26"
EJS_VERSION="0.8.0"
CERTIFI_VERSION="2026.10.23"
SUPPORT_REPO="beeware/Python-Apple-support"

mkdir -p Vendor

if [ ! -d Vendor/Python.xcframework ]; then
  if [ -z "$SUPPORT_TAG" ]; then
    SUPPORT_TAG="$(gh api "repos/$SUPPORT_REPO/releases?per_page=100" -q '.[].tag_name' | grep "^$PYTHON_SERIES-" | head -1)"
  fi
  echo "Python-Apple-support 版本：$SUPPORT_TAG"
  ASSET="$(gh api "repos/$SUPPORT_REPO/releases/tags/$SUPPORT_TAG" -q '.assets[].name' | grep -i 'iOS-support' | head -1)"
  echo "檔案：$ASSET"
  rm -rf Vendor/download Vendor/support
  mkdir -p Vendor/download Vendor/support
  gh release download "$SUPPORT_TAG" --repo "$SUPPORT_REPO" --pattern "$ASSET" --dir Vendor/download
  ACTUAL_SHA256="$(shasum -a 256 "Vendor/download/$ASSET" | cut -d ' ' -f 1)"
  echo "SHA-256：$ACTUAL_SHA256"
  if [ -n "$SUPPORT_SHA256" ] && [ "$SUPPORT_SHA256" != "$ACTUAL_SHA256" ]; then
    echo "error: Python-Apple-support 的 SHA-256 不符（預期 $SUPPORT_SHA256）" >&2
    exit 1
  fi
  tar -xzf "Vendor/download/$ASSET" -C Vendor/support
  mv Vendor/support/Python.xcframework Vendor/Python.xcframework
  echo "── 內容 ──"
  ls Vendor/support || true
  cat Vendor/support/VERSIONS 2>/dev/null || true
  ls Vendor/Python.xcframework
  for slice in Vendor/Python.xcframework/ios-*; do
    echo "$slice:"; ls "$slice"; ls "$slice/lib" 2>/dev/null || true
  done
  ls Vendor/Python.xcframework/build 2>/dev/null || true
  rm -rf Vendor/download
fi

if [ ! -d Vendor/site-packages/yt_dlp ]; then
  rm -rf Vendor/site-packages
  python3 -m pip install --quiet --disable-pip-version-check --no-deps --no-compile --only-binary=:all: \
    --target Vendor/site-packages \
    "yt-dlp==$YTDLP_VERSION" "yt-dlp-ejs==$EJS_VERSION" "certifi==$CERTIFI_VERSION"
  # 不需要的檔案
  rm -rf Vendor/site-packages/bin Vendor/site-packages/share Vendor/site-packages/yt_dlp/__pyinstaller
  find Vendor/site-packages -name '__pycache__' -type d -prune -exec rm -rf {} +
  echo "site-packages：$(du -sh Vendor/site-packages | cut -f 1)"
  ls Vendor/site-packages
fi
