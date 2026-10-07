#!/usr/bin/env bash
# 在 Mac 上生成 build/icon.icns（应用图标），供 electron-builder 打包 dmg 使用。
# 依赖：macOS 自带的 sips / iconutil，以及仓库 devDependencies 里的 electron。
# 用法：bash scripts/make-icns.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -x "node_modules/.bin/electron" ]; then
  ELECTRON_BIN="node_modules/.bin/electron"
elif command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="electron"
else
  echo "未找到 electron（先 pnpm install 安装仓库依赖）" >&2
  exit 1
fi

SRC="build/icon-1024.png"
ICONSET="build/icon.iconset"
OUT="build/icon.icns"

echo "[icns] 渲染 1024×1024 主图：$SRC"
"$ELECTRON_BIN" electron/generate-icon.cjs --size 1024 --out "$SRC"

echo "[icns] 组装 $ICONSET"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
sips -z 16 16   "$SRC" --out "$ICONSET/icon_16x16.png"      >/dev/null
sips -z 32 32   "$SRC" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
sips -z 32 32   "$SRC" --out "$ICONSET/icon_32x32.png"      >/dev/null
sips -z 64 64   "$SRC" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
sips -z 128 128 "$SRC" --out "$ICONSET/icon_128x128.png"    >/dev/null
sips -z 256 256 "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SRC" --out "$ICONSET/icon_256x256.png"    >/dev/null
sips -z 512 512 "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SRC" --out "$ICONSET/icon_512x512.png"    >/dev/null
cp "$SRC" "$ICONSET/icon_512x512@2x.png"

echo "[icns] iconutil → $OUT"
iconutil -c icns "$ICONSET" -o "$OUT"
echo "[icns] 完成：$OUT"
