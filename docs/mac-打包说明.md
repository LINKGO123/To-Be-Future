# Mac（Apple Silicon）打包说明

目标：在 **Mac（arm64）** 上把「To Be Future 资金雷达工作台」打成 **不签名的 dmg**，给家人用
（首次右键「打开」绕过 Gatekeeper「未验证开发者」拦截，不关系统安全）。

Windows 侧已完成代码/配置适配（`electron/main.cjs`、`electron/stage.cjs`、`electron-builder.yml`），
本文只覆盖 **Mac 上要手动执行的步骤**。实际 dmg 打包必须在 Mac 上跑，Windows 上无法出 Mac 产物。

---

## 0. 架构与产物

| 项 | 值 |
|---|---|
| 架构 | arm64（Apple Silicon） |
| 签名 | 不签名（`identity: null`） |
| 目标 | dmg（`electron-builder --mac dmg`） |
| 产物 | `release/To Be Future 资金雷达-<版本>-mac-arm64.dmg` |
| 运行时 | Node + Python + sherpa-onnx 的 darwin-arm64 版（打进包内 `resources/`） |

---

## 1. 前置条件（Mac 上装一次）

1. **Node ≥ 22**（本机构建用，`pnpm --dir desktop run build` 需要；`engines: >=22.18`）。
   建议与便携版同主版本：Node 24。
2. **pnpm**：`npm i -g pnpm`。
3. **uv**（下载/组装便携 Python 用）：`curl -LsSf https://astral.sh/uv/install.sh | sh`。
4. **Xcode Command Line Tools**（`git`/`tar`/`xcode-select --install` 若提示缺失时）。

```bash
git clone <仓库> && cd <仓库根>
pnpm install          # 安装 electron / electron-builder / desktop 前端依赖
pnpm --dir orchestrator-flat install --node-linker=hoisted --prod   # 后端扁平依赖（stage.cjs 需要）
```

---

## 2. 下载/组装 darwin-arm64 运行时

在仓库根执行（脚本已在 `scripts/download-mac-runtime.sh`，会按 `process.platform` 无关，只下载 arm64 资产）：

```bash
bash scripts/download-mac-runtime.sh
```

它产出（`electron/stage.cjs` 在 darwin 下会原样复制到 `build/resources`）：

```
resources/node/darwin-arm64/            # Node（官方 darwin-arm64 tarball，含 bin/node）
resources/python/darwin-arm64/          # Python 3.14 便携 venv（含 sherpa-onnx + numpy）
resources/sherpa-onnx/darwin-arm64/bin/ # sherpa-onnx-offline 离线识别器二进制（+ 动态库）
```

> 模型/词表/流式脚本（`resources/sherpa-onnx/models/` 与 `streaming_stt.py`）跨平台通用，仓库已自带，不用下。

### 运行时下载清单（darwin-arm64）

| 组件 | 来源 | 说明 |
|---|---|---|
| Node | `https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz` | 与 Windows 便携版同版本（v24.21.0） |
| Python | 经 `uv` 装 3.14（底层是 python-build-standalone，可整体搬移） | 3.14 = cp314，sherpa-onnx 有 macOS arm64 wheel |
| sherpa-onnx 流式包 | `sherpa_onnx-1.13.8-cp314-cp314-macosx_11_0_arm64.whl` | 经 `pip install sherpa-onnx` 自动解析 |
| sherpa-onnx 离线二进制 | `sherpa_onnx_bin-1.13.8-py3-none-macosx_11_0_arm64.whl` | 提供 `sherpa-onnx-offline`（对应 Windows 的 `.exe`） |

sherpa-onnx 官方 wheel 索引（`pip` 可直接从 PyPI 装，找不到时用 `-f` 指到该索引）：

- 安装文档：<https://k2-fsa.github.io/sherpa/onnx/python/install.html>
- CPU wheel 索引：<https://k2-fsa.github.io/sherpa/onnx/cpu.html>
- 三个 arm64 资产的直接地址（`csukuangfj2/sherpa-onnx-wheels` 仓库）：
  - <https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/main/cpu/1.13.8/sherpa_onnx-1.13.8-cp314-cp314-macosx_11_0_arm64.whl>
  - <https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/main/cpu/1.13.8/sherpa_onnx_core-1.13.8-py3-none-macosx_11_0_arm64.whl>
  - <https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/main/cpu/1.13.8/sherpa_onnx_bin-1.13.8-py3-none-macosx_11_0_arm64.whl>

> 注意：sherpa-onnx 的 GitHub Release 里只给 Windows 出 `sherpa-onnx-offline.exe`，
> macOS 的离线识别器二进制要从 `sherpa-onnx-bin` wheel 里拿（脚本第 3 步已处理）。

---

## 3. 生成应用图标（icns）

Mac 需要 `.icns`（`electron-builder.yml` 的 `mac.icon: build/icon.icns`）。
仓库只有 256×256 的 `build/icon.png`（供 Windows 转 `.ico`），**没有 icns 生成逻辑**，需先跑：

```bash
bash scripts/make-icns.sh
```

它用 Electron 离屏把 `desktop/public/favicon.svg` 渲染成 1024×1024 PNG，再用 macOS 自带的
`sips` + `iconutil` 合成 `build/icon.icns`。产物：`build/icon.icns`（以及中间态 `build/icon-1024.png`、`build/icon.iconset/`）。

---

## 4. 打前端 + 组装 + 出 dmg

```bash
pnpm --dir desktop run build                          # 前端产物 desktop/dist（stage.cjs 需要）
node electron/stage.cjs --clean                       # 按 platform=darwin 组装 build/（复制 arm64 运行时）
npx electron-builder --mac dmg                        # 出 dmg（不签名）
```

等价的一条（`package.json` 已加脚本）：

```bash
pnpm run electron:build:mac
```

产物路径：`release/To Be Future 资金雷达-1.2.0-mac-arm64.dmg`（`artifactName` 见 `electron-builder.yml`，含中文产品名与空格属正常）。

---

## 5. 首次打开（不签名的说明）

未签名的 dmg 拖进「应用程序」后，**双击会提示「无法打开，因为无法验证开发者」**：

- 右键 app → 「打开」→ 再点「打开」即可（只需一次，之后正常双击）。

这是 Gatekeeper 对未签名/未公证应用的正常拦截，**不要**关闭「系统偏好设置 → 隐私与安全性」的整体防护。

---

## 6. （可选）发布到 GitHub Releases

`electron-builder.yml` 的 `publish` 已是 github（`LINKGO123/To-Be-Future`），Windows/Mac 共用：

```bash
npx electron-builder --mac dmg --publish always   # 需 GH_TOKEN 环境变量
```

未签名下，`electron-updater` 的 dmg 更新链路仍可用，但首次/每次升级可能再次触发 Gatekeeper 提示（已知，接受）。

---

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| `electron-builder` 报「找不到签名身份 / skip codesign」 | 已配 `identity: null`；若仍报错确认没传 `--sign` 参数、没设 `CSC_IDENTITY_AUTO_DISCOVERY=true` |
| `stage.cjs` 提示未找到 `resources/node/darwin-arm64` | 先跑 `bash scripts/download-mac-runtime.sh` |
| 语音识别（离线/流式）不可用 | 检查 `resources/sherpa-onnx/darwin-arm64/bin/sherpa-onnx-offline` 存在；模型在 `resources/sherpa-onnx/models/`（仓库自带） |
| 流式识别 `sherpa_onnx` 导入失败 | 确认 `resources/python/darwin-arm64/bin/python3 -c "import sherpa_onnx, numpy"` 通过 |
| 打包后 app 找不到 node/python | 确认运行时按 `resources/{node,python}/{bin/}` 布局（`main.cjs` 在 darwin 下找 `node/bin/node`、`python/bin/python3`） |
