#!/bin/bash
# Xcode 的建置步驟：把 Python 的標準函式庫和 yt-dlp 放進 App（規格 ios-app R122）。
# iOS 規定 App 裡的原生程式碼要包成 framework 放在 Frameworks/，所以把標準函式庫裡的 .so
# 各自包成一個 framework，原本的位置留一個 .fwork 檔指過去（Python 3.13 在 iOS 上的標準做法）。
set -euo pipefail

XCFRAMEWORK="$PROJECT_DIR/Vendor/Python.xcframework"
PACKAGES="$PROJECT_DIR/Vendor/site-packages"
APP="$CODESIGNING_FOLDER_PATH"

if [ ! -d "$XCFRAMEWORK" ] || [ ! -d "$PACKAGES" ]; then
  echo "error: 找不到 Vendor/Python.xcframework 或 Vendor/site-packages，請先執行 ios/scripts/fetch-python.sh" >&2
  exit 1
fi

# Python-Apple-support（3.13-b18）的結構：
#   Python.xcframework/lib/python3.13/                    標準函式庫裡用 Python 寫的部分（各平台共用）
#   Python.xcframework/ios-arm64/lib-arm64/python3.13/    實機用的原生模組（lib-dynload/*.so）與平台設定
#   Python.xcframework/ios-arm64_x86_64-simulator/lib-arm64、lib-x86_64   模擬器用的
if [ "${EFFECTIVE_PLATFORM_NAME:-}" = "-iphonesimulator" ]; then
  # 模擬器只用來確認編譯得過，固定用 arm64 的
  SLICE="$(ls -d "$XCFRAMEWORK"/ios-*simulator* | head -1)"
else
  SLICE="$XCFRAMEWORK/ios-arm64"
fi
COMMON_LIB="$XCFRAMEWORK/lib"
NATIVE_LIB="$SLICE/lib-arm64"
if [ ! -f "$(ls -d "$COMMON_LIB"/python3.* | head -1)/encodings/__init__.py" ] || [ ! -d "$NATIVE_LIB" ]; then
  echo "error: Python-Apple-support 的結構和預期不同（找不到 $COMMON_LIB/python3.*/encodings 或 $NATIVE_LIB）" >&2
  ls "$XCFRAMEWORK" "$SLICE" >&2 || true
  exit 1
fi

# 標準函式庫（去掉用不到的部分，減少 App 的大小），再疊上原生模組
rm -rf "$APP/python"
mkdir -p "$APP/python/lib"
rsync -a \
  --exclude '__pycache__' --exclude 'test' --exclude 'tests' --exclude 'idlelib' --exclude 'tkinter' \
  --exclude 'turtledemo' --exclude 'ensurepip' --exclude 'lib2to3' --exclude 'pydoc_data' \
  --exclude 'config-*' --exclude '*.a' --exclude 'pkgconfig' \
  "$COMMON_LIB/" "$APP/python/lib/"
rsync -a --exclude '__pycache__' --exclude 'config-*' --exclude '*.a' --exclude 'pkgconfig' \
  "$NATIVE_LIB/" "$APP/python/lib/"

STDLIB="$(ls -d "$APP"/python/lib/python3.* | head -1)"
if [ ! -f "$STDLIB/encodings/__init__.py" ] || [ ! -d "$STDLIB/lib-dynload" ]; then
  echo "error: 標準函式庫沒有放進 App（$STDLIB）" >&2
  exit 1
fi

# yt-dlp 等套件
rsync -a --delete --exclude '__pycache__' "$PACKAGES/" "$APP/site-packages/"

# 把 .so 包成 framework
MIN_OS="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
find "$APP/python/lib" -name '*.so' | while read -r FULL_EXT; do
  RELATIVE_EXT="${FULL_EXT#"$APP"/}"
  # 例如 _ssl.cpython-313-iphoneos.so → _ssl
  MODULE_NAME="$(basename "$FULL_EXT" | cut -d '.' -f 1)"
  FRAMEWORK="Frameworks/$MODULE_NAME.framework"
  BUNDLE_ID="org.python.ext.$(echo "$MODULE_NAME" | tr '_' '-' | sed 's/^-*//')"
  mkdir -p "$APP/$FRAMEWORK"
  cat > "$APP/$FRAMEWORK/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$MODULE_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$MODULE_NAME</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>$MIN_OS</string>
</dict>
</plist>
PLIST
  mv "$FULL_EXT" "$APP/$FRAMEWORK/$MODULE_NAME"
  # 原本的位置留下 .fwork，內容是 framework 裡的檔案（相對於 App）
  echo "$FRAMEWORK/$MODULE_NAME" > "${FULL_EXT%.so}.fwork"
  # framework 裡記下原本的位置
  echo "${RELATIVE_EXT%.so}.fwork" > "$APP/$FRAMEWORK/$MODULE_NAME.origin"
done

echo "Python 標準函式庫：$(du -sh "$APP/python" | cut -f 1)；套件：$(du -sh "$APP/site-packages" | cut -f 1)；framework 數量：$(ls "$APP/Frameworks" | wc -l | tr -d ' ')"
