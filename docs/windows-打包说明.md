# Windows 打包说明

目标：在 **Windows** 上把「To Be Future 资金雷达工作台」打成 **NSIS 安装包（.exe）**，给家人用
（未签名，SmartScreen 会提示「未知发布者」，家人点「仍要运行」即可，不关闭系统防护）。

> Mac（arm64 dmg）打包见 [mac-打包说明.md](mac-打包说明.md)。

---

## 0. 架构与产物

| 项 | 值 |
|---|---|
| 架构 | x64 |
| 签名 | 不签名（`identity: null`） |
| 目标 | nsis（`electron-builder --win nsis`） |
| 产物 | `release/` 下的 `fund-radar.exe`（NSIS 向导式安装包，可自选安装目录、免管理员） |
| 运行时 | Node + Python + sherpa-onnx 的 Windows x64 版（打进包内 `resources/`） |

---

## 1. 前置条件（Windows 上装一次）

1. **Node ≥ 22**（建议 24）。
2. **pnpm**：`npm i -g pnpm`（权限不够就用 `corepack pnpm`）。
3. **Python ≥ 3.11**（数据层 `.venv` 用，建议 3.12）。

---

## 2. Windows 便携运行时（关键，需手动下载）

`resources/` 被 gitignore，**clone 后为空**。打包需要 Windows 版便携运行时。
仓库里**没有 Windows 下载脚本**（只有 Mac 的 `scripts/download-mac-runtime.sh`），
需要手动下载，或参考 Mac 脚本的逻辑改造成 Windows 版。

| 组件 | 目标路径 | 版本 | 来源 |
|---|---|---|---|
| Node | `resources/node/`（`node.exe` 直接在 `resources/node/` 下，扁平布局） | v24.21.0 | `https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip` |
| Python | `resources/python/`（含 sherpa-onnx + numpy） | 3.14 | `uv`（Windows 版）建 venv，`pip install sherpa-onnx==1.13.8 sherpa-onnx-bin==1.13.8 numpy` |
| sherpa-onnx 离线二进制 | `resources/sherpa-onnx/bin/`（`sherpa-onnx-offline.exe` + `onnxruntime.dll`） | 1.13.8 | sherpa-onnx-bin 的 Windows wheel，或 sherpa-onnx 官方 GitHub release 的 Windows x64 预编译包 |
| 语音模型 | `resources/sherpa-onnx/models/` | — | k2-fsa/sherpa-onnx 的 `asr-models` release（tarball） |

> 流式脚本 `resources/sherpa-onnx/streaming_stt.py` 已进 git（clone 下来就有），不用下载。

### 2.1 Node

下载 `node-v24.21.0-win-x64.zip` 解压，把 `node.exe` 放到 `resources/node/node.exe`
（扁平：`node.exe` 直接在 `resources/node/` 下，不是 `resources/node/node-v24.21.0-win-x64/`）。

### 2.2 Python（含 sherpa-onnx + numpy）

```powershell
uv venv --python 3.14 --relocatable --seed resources/python
resources\python\Scripts\python.exe -m pip install sherpa-onnx==1.13.8 sherpa-onnx-bin==1.13.8 numpy
resources\python\Scripts\python.exe -m pip install -r .agents\skills\data-access\scripts\requirements.txt
```

注意 Windows venv 的 python 在 `Scripts\python.exe`（不是 `bin/python3`）。
第二行是数据层取数脚本依赖（requests/pandas/lxml/akshare/baostock/mootdx）——
缺了它，东财 `em_*` 等行情端点会全部取数失败、前端降级为示例数据。

### 2.3 sherpa-onnx 离线识别器二进制

`sherpa-onnx-offline.exe` + `onnxruntime.dll` 放到 `resources/sherpa-onnx/bin/`，两者必须同目录。
两个来源二选一：

- sherpa-onnx 官方 GitHub release 的 Windows x64 预编译包（`sherpa-onnx-v1.13.8-win-x64.tar.bz2`，
  解压后含 `sherpa-onnx-offline.exe` + `onnxruntime.dll`），确切的 asset 名以 release 页面为准；
- 或 `sherpa-onnx-bin` 的 Windows wheel（`pip install sherpa-onnx-bin==1.13.8` 后从 site-packages 里取）。

### 2.4 语音模型（跨平台通用，两个都要）

解压到 `resources/sherpa-onnx/models/` 下、保持各自目录名：

- `sherpa-onnx-paraformer-zh-small-2024-03-09`
  <https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2>
- `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`
  <https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16.tar.bz2>

---

## 3. 装依赖

```powershell
pnpm install                                              # 根依赖（electron / electron-builder）
mkdir orchestrator-flat
copy orchestrator\package.json orchestrator-flat\package.json
pnpm --dir orchestrator-flat install --node-linker=hoisted --prod   # 后端扁平依赖（stage.cjs 需要）
```

> `orchestrator-flat/` 是打包专用的 hoisted 后端依赖副本，gitignore、clone 后不存在，
> 需要先复制 `orchestrator/package.json` 过去再装。

---

## 4. 打包

```powershell
Remove-Item env:ELECTRON_RUN_AS_NODE            # 关键：先移除，见第 5 节
pnpm --dir desktop run build                    # 前端产物 desktop/dist（stage.cjs 需要）
node electron/stage.cjs --clean                 # 按 platform=win32 组装 build/（复制 win32 运行时）
npx electron-builder --win nsis                 # 出 NSIS 安装包
```

等价的一条（`package.json` 已加脚本）：`pnpm run electron:build`。

产物路径：`release/` 下 `fund-radar.exe`（内层 exe 用 ASCII 名，避免中文/空格在 NSIS 里出问题）。

---

## 5. 已知坑（务必遵守）

1. **`ELECTRON_RUN_AS_NODE`**：DSH / CI 环境常自动设置该环境变量，会让 electron 退化成纯 Node、
   `require("electron")` 返回路径字符串、桌面壳起不来。打包前必须 `Remove-Item env:ELECTRON_RUN_AS_NODE`。
2. **中文/空格路径**：`sherpa-onnx-offline.exe` 用窄 `main(argc, char* argv[])` 收参，Windows 按 GBK
   代码页转中文路径会挂。仓库已内置解法（模型 + wav 缓存到 `os.tmpdir()`、spawn 用相对 ASCII 文件名），
   **不要改 `orchestrator/src/transcribe.ts` 里这套设计**。
3. **`stage.cjs` 已修两个 bug**（`fs.cpSync` 不递归解引用树内 symlink、`--clean` 误删图标），clone 下来就有，别改动。
4. **`desktop/package.json` 已含 `@types/mdast`**，前端构建不会报 TS2307。

---

## 6. 验证

打包成功后检查 `release/` 下出现 `fund-radar.exe`（NSIS 安装包，约 400–500MB 属正常）。
双击安装：可自选目录、免管理员、桌面与开始菜单建快捷方式。

---

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| `stage.cjs` 提示未找到 `resources/node` 或 `resources/python` | 第 2 节运行时没下载全，补齐后再跑 |
| `stage.cjs` 提示未找到 `orchestrator-flat/node_modules` | 第 3 节 `pnpm --dir orchestrator-flat install` 没跑 |
| 语音识别不可用 | 检查 `resources/sherpa-onnx/bin/sherpa-onnx-offline.exe` + `onnxruntime.dll` 同目录；模型在 `resources/sherpa-onnx/models/` |
| `electron-builder` 报「找不到签名身份」 | 已配 `identity: null`；确认没传 `--sign`、没设 `CSC_IDENTITY_AUTO_DISCOVERY=true` |
| SmartScreen 提示「未知发布者」 | 未签名所致（已知），点「仍要运行」即可，不关闭系统防护 |
