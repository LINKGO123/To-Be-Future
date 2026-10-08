/**
 * 打包预处理：把「运行所需的仓库内容」+「便携运行时」摊平复制到 build/，
 * 供 electron-builder 的 extraResources 直接打包（见 electron-builder.yml）。
 *
 * 为什么摊平：orchestrator 用 pnpm 安装，node_modules 顶层是 Junction（目录符号链接）指向
 * .pnpm 存储。electron-builder 复制 junction 的行为不可控，直接打进包里会丢依赖。
 * 这里用 fs.cpSync({ dereference: true }) 把 junction 解引用成真实目录，产出自包含的扁平副本。
 *
 * 用法：node electron/stage.cjs [--clean]
 *   --clean  强制清空 build/ 重建（默认跳过已存在且非空的 orchestrator/node_modules 以提速）
 *
 * 跨平台：按 process.platform 选便携运行时。
 *   - win32 ：resources/node、resources/python、resources/sherpa-onnx/bin（扁平/exe）
 *   - darwin：resources/node/darwin-arm64、resources/python/darwin-arm64、resources/sherpa-onnx/darwin-arm64/bin
 *   模型/词表/流式脚本（resources/sherpa-onnx/models 与 streaming_stt.py）跨平台通用，不分平台。
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(REPO_ROOT, "build");
const APP_DIR = path.join(BUILD_DIR, "app");
const RES_DIR = path.join(BUILD_DIR, "resources");

const clean = process.argv.includes("--clean");

const t0 = Date.now();
function mb(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function dirSize(p) {
  let sum = 0;
  for (const f of fs.readdirSync(p)) {
    const fp = path.join(p, f);
    const st = fs.lstatSync(fp);
    if (st.isDirectory()) sum += dirSize(fp);
    else if (st.isSymbolicLink()) {
      // dereferenceTree 之后不应再出现；若出现（dangling 等）跳过，不影响复制正确性
      continue;
    } else sum += st.size;
  }
  return sum;
}

/** Node 的 fs.cpSync({dereference:true}) 不会递归解引用目录树内的 symlink，
 *  而是把相对 symlink 重写成指向源目录的绝对 symlink——打包进 DMG 后这些绝对路径
 *  在用户机器上必然断链。此函数把 to 树内的 symlink 全部替换为真实内容副本。 */
function dereferenceTree(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const fp = path.join(root, ent.name);
    if (ent.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(fp);
      } catch {
        fs.rmSync(fp, { force: true }); // dangling symlink：包内无用，删掉
        continue;
      }
      let st;
      try {
        st = fs.statSync(real);
      } catch {
        continue;
      }
      fs.rmSync(fp, { force: true });
      if (st.isDirectory()) {
        fs.cpSync(real, fp, { recursive: true, errorOnExist: false, force: true });
        dereferenceTree(fp);
      } else {
        fs.copyFileSync(real, fp);
      }
    } else if (ent.isDirectory()) {
      dereferenceTree(fp);
    }
  }
}

function cpDir(from, to, { dereference = false } = {}) {
  const start = Date.now();
  fs.cpSync(from, to, { recursive: true, dereference, errorOnExist: false, force: true });
  if (dereference) dereferenceTree(to);
  const sz = fs.existsSync(to) ? dirSize(to) : 0;
  console.log(`  cp ${path.relative(REPO_ROOT, from)} -> ${path.relative(REPO_ROOT, to)}  (${mb(sz)}, ${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

function cpFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`  cp ${path.relative(REPO_ROOT, from)} -> ${path.relative(REPO_ROOT, to)}`);
}

function main() {
  if (clean) {
    // 只清重建目标 app/ 与 resources/，保留 build/icon.icns 等图标产物——
    // make-icns.sh 先于本脚本运行，若整个删掉 build/ 会把 electron-builder 要用的图标一并删掉。
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.rmSync(RES_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.mkdirSync(RES_DIR, { recursive: true });

  console.log("[stage] 组装 build/app（后端 + 数据层 + 前端产物）");

  // orchestrator：src + package.json（`type: module` 必须）+ node_modules
  // node_modules 用 orchestrator-flat 的 hoisted（扁平、无 junction）安装产物 ——
  //   源码仓库的 node_modules 是 pnpm 符号链接布局（junction 指向 .pnpm），直接复制会
  //   断掉兄弟依赖解析或体积爆炸。hoisted 布局只有硬链接，普通递归复制即可，自包含。
  cpDir(path.join(REPO_ROOT, "orchestrator", "src"), path.join(APP_DIR, "orchestrator", "src"));
  cpFile(path.join(REPO_ROOT, "orchestrator", "package.json"), path.join(APP_DIR, "orchestrator", "package.json"));
  cpFile(path.join(REPO_ROOT, "orchestrator", "tsconfig.json"), path.join(APP_DIR, "orchestrator", "tsconfig.json"));
  const nmSrc = path.join(REPO_ROOT, "orchestrator-flat", "node_modules");
  if (!fs.existsSync(nmSrc)) {
    console.log(`  ⚠ 未找到 ${nmSrc}（先运行: pnpm install --dir orchestrator-flat --node-linker=hoisted --prod）`);
  } else {
    const nmDst = path.join(APP_DIR, "orchestrator", "node_modules");
    if (!clean && fs.existsSync(nmDst) && fs.existsSync(path.join(nmDst, "@openai", "codex-sdk"))) {
      console.log(`  skip orchestrator/node_modules（已存在，加 --clean 强制重建）`);
    } else {
      fs.rmSync(nmDst, { recursive: true, force: true });
      cpDir(nmSrc, nmDst);
    }
  }

  // 数据层 / 配置 / 前端产物
  cpDir(path.join(REPO_ROOT, "calc"), path.join(APP_DIR, "calc"));
  cpDir(path.join(REPO_ROOT, "datasources"), path.join(APP_DIR, "datasources"));
  cpDir(path.join(REPO_ROOT, ".agents"), path.join(APP_DIR, ".agents"));
  cpDir(path.join(REPO_ROOT, "providers"), path.join(APP_DIR, "providers"));
  cpDir(path.join(REPO_ROOT, "backtest"), path.join(APP_DIR, "backtest"));
  cpDir(path.join(REPO_ROOT, "desktop", "dist"), path.join(APP_DIR, "desktop", "dist"));
  cpDir(path.join(REPO_ROOT, "desktop", "public"), path.join(APP_DIR, "desktop", "public"));
  cpFile(path.join(REPO_ROOT, "AGENTS.md"), path.join(APP_DIR, "AGENTS.md"));
  cpFile(path.join(REPO_ROOT, "vibe-research.config.json"), path.join(APP_DIR, "vibe-research.config.json"));

  console.log("[stage] 组装 build/resources（便携运行时，按平台）");
  const isMac = process.platform === "darwin";

  // Node：win32 → resources/node（扁平 node.exe）；darwin → resources/node/darwin-arm64（解包后含 bin/node）
  const nodeSrc = isMac
    ? path.join(REPO_ROOT, "resources", "node", "darwin-arm64")
    : path.join(REPO_ROOT, "resources", "node");
  // dereference: true —— 运行时目录（尤其 macOS venv/node 的 bin 里是符号链接）要解引用成真实文件，
  // 否则打包后的 resources 里会留下指向构建机绝对路径的断链。
  if (fs.existsSync(nodeSrc)) cpDir(nodeSrc, path.join(RES_DIR, "node"), { dereference: true });
  else console.log(`  ⚠ 未找到 ${path.relative(REPO_ROOT, nodeSrc)}（便携 Node 缺，运行时将回退系统 node）`);

  // Python：win32 → resources/python（扁平 python.exe）；darwin → resources/python/darwin-arm64（venv，含 bin/python3）
  const pySrc = isMac
    ? path.join(REPO_ROOT, "resources", "python", "darwin-arm64")
    : path.join(REPO_ROOT, "resources", "python");
  if (fs.existsSync(pySrc)) cpDir(pySrc, path.join(RES_DIR, "python"), { dereference: true });
  else console.log(`  ⚠ 未找到 ${path.relative(REPO_ROOT, pySrc)}（便携 Python 缺，运行时将回退系统 python）`);

  // 本地离线语音识别（sherpa-onnx）：模型/词表/流式脚本跨平台通用，识别器二进制分平台。
  const sttRoot = path.join(REPO_ROOT, "resources", "sherpa-onnx");
  cpFile(path.join(sttRoot, "streaming_stt.py"), path.join(RES_DIR, "sherpa-onnx", "streaming_stt.py"));
  const sttModelsSrc = path.join(sttRoot, "models");
  if (fs.existsSync(sttModelsSrc)) cpDir(sttModelsSrc, path.join(RES_DIR, "sherpa-onnx", "models"));
  else console.log("  ⚠ 未找到 sherpa-onnx 模型（离线语音识别缺，运行时该功能降级为打字）");
  // 识别器二进制：win32 → resources/sherpa-onnx/bin（sherpa-onnx-offline.exe + onnxruntime dll）；
  // darwin → resources/sherpa-onnx/darwin-arm64/bin（sherpa-onnx-offline + dylib，来自 sherpa-onnx-bin wheel）。
  const sttBinSrc = isMac ? path.join(sttRoot, "darwin-arm64", "bin") : path.join(sttRoot, "bin");
  if (fs.existsSync(sttBinSrc)) cpDir(sttBinSrc, path.join(RES_DIR, "sherpa-onnx", "bin"), { dereference: true });
  else console.log(`  ⚠ 未找到 ${path.relative(REPO_ROOT, sttBinSrc)}（sherpa-onnx 识别器二进制缺，离线语音识别降级为打字）`);

  console.log(`[stage] 完成，build/ 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
