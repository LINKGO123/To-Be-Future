#!/usr/bin/env bash
# 在 Mac (Apple Silicon) 上下载并组装 macOS arm64 便携运行时，供 electron/stage.cjs 打包 dmg 使用。
# 产出（供 stage.cjs 在 darwin 下复制到 build/resources）：
#   resources/node/darwin-arm64/             ← Node（官方 darwin-arm64 tarball）
#   resources/python/darwin-arm64/           ← Python 3.14 便携 venv（含 sherpa-onnx + numpy）
#   resources/sherpa-onnx/darwin-arm64/bin/  ← sherpa-onnx-offline 离线识别器二进制（+ 可能存在的动态库）
#
# 前置：已安装 uv（curl -LsSf https://astral.sh/uv/install.sh | sh）。
# 版本可经环境变量覆盖：NODE_VERSION / PYTHON_VERSION / SHERPA_VERSION。
# 用法：bash scripts/download-mac-runtime.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_VERSION="${NODE_VERSION:-v24.21.0}"   # 与 Windows 便携版同主版本（当前 resources/node/node.exe 为 v24.21.0）
PYTHON_VERSION="${PYTHON_VERSION:-3.14}"   # cp314：sherpa-onnx 1.13.8 有 macOS arm64 wheel
SHERPA_VERSION="${SHERPA_VERSION:-1.13.8}"

NODE_DST="resources/node/darwin-arm64"
PY_DST="resources/python/darwin-arm64"
STT_BIN_DST="resources/sherpa-onnx/darwin-arm64/bin"

echo "== 1/3 Node.js darwin-arm64 =="
if [ -x "$NODE_DST/bin/node" ]; then
  echo "  已存在，跳过（删除 $NODE_DST 可强制重下）"
else
  TARBALL="node-${NODE_VERSION}-darwin-arm64.tar.gz"
  URL="https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}"
  echo "  下载 $URL"
  curl -fL "$URL" -o "/tmp/${TARBALL}"
  mkdir -p resources/node
  rm -rf "$NODE_DST" "resources/node/node-${NODE_VERSION}-darwin-arm64"
  tar -xzf "/tmp/${TARBALL}" -C resources/node
  mv "resources/node/node-${NODE_VERSION}-darwin-arm64" "$NODE_DST"
  rm -f "/tmp/${TARBALL}"
fi
"$NODE_DST/bin/node" --version

echo "== 2/3 Python ${PYTHON_VERSION}（relocatable venv + sherpa-onnx + numpy）=="
if [ -x "$PY_DST/bin/python3" ]; then
  echo "  已存在，跳过（删除 $PY_DST 可强制重建）"
else
  if ! command -v uv >/dev/null 2>&1; then
    echo "  缺少 uv。请先安装：curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
  fi
  uv python install "$PYTHON_VERSION"
  # --relocatable：生成可整体搬移的 venv（相对引用，不写死构建机绝对路径），便于打进 DMG。
  uv venv --python "$PYTHON_VERSION" --relocatable --seed "$PY_DST"
  "$PY_DST/bin/python3" -m pip install --upgrade pip >/dev/null
  # sherpa-onnx（流式 Python 包）+ sherpa-onnx-bin（提供 sherpa-onnx-offline 离线二进制）+ numpy。
  # macOS arm64 cp314 wheel 在 PyPI / k2-fsa 官方索引均有（见 docs/mac-打包说明.md）。
  "$PY_DST/bin/python3" -m pip install \
    "sherpa-onnx==${SHERPA_VERSION}" "sherpa-onnx-bin==${SHERPA_VERSION}" numpy
fi
"$PY_DST/bin/python3" -c 'import sherpa_onnx, numpy; print("  sherpa_onnx", sherpa_onnx.__version__, "| numpy", numpy.__version__)'

echo "== 3/3 sherpa-onnx-offline 离线识别器二进制 =="
if [ -x "$STT_BIN_DST/sherpa-onnx-offline" ]; then
  echo "  已存在，跳过"
else
  OFFLINE_BIN="$PY_DST/bin/sherpa-onnx-offline"
  if [ ! -x "$OFFLINE_BIN" ]; then
    echo "  未找到 $OFFLINE_BIN（sherpa-onnx-bin 未提供离线二进制？）" >&2
    echo "  手动确认：ls -l $PY_DST/bin/sherpa-onnx*" >&2
    exit 1
  fi
  mkdir -p "$STT_BIN_DST"
  cp "$OFFLINE_BIN" "$STT_BIN_DST/"
  # 若 wheel 附带动态库（libsherpa-onnx-c-api.dylib / libonnxruntime*.dylib），一并复制到 bin/ 同目录，保证二进制自包含。
  # 注意：dylib 不在 $PY_DST/lib 或 $PY_DST/bin，而在 site-packages/sherpa_onnx/lib/。
  SHERPA_LIB_DIR="$(find "$PY_DST" -type d -path "*site-packages/sherpa_onnx/lib" 2>/dev/null | head -1)"
  if [ -n "$SHERPA_LIB_DIR" ]; then
    cp "$SHERPA_LIB_DIR"/*.dylib "$STT_BIN_DST/" 2>/dev/null || true
  else
    cp "$PY_DST"/lib/lib*.dylib "$STT_BIN_DST/" 2>/dev/null || true
    cp "$PY_DST"/bin/*.dylib "$STT_BIN_DST/" 2>/dev/null || true
  fi
fi
ls -la "$STT_BIN_DST"

echo ""
echo "完成。后续打包步骤（按顺序）："
echo "  bash scripts/make-icns.sh"
echo "  pnpm --dir desktop run build"
echo "  node electron/stage.cjs --clean && npx electron-builder --mac dmg"
