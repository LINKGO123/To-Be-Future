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
    if (st.isDirectory() || st.isSymbolicLink()) sum += dirSize(fp);
    else sum += st.size;
  }
  return sum;
}

function cpDir(from, to, { dereference = false } = {}) {
  const start = Date.now();
  fs.cpSync(from, to, { recursive: true, dereference, errorOnExist: false, force: true });
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
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
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

  console.log("[stage] 组装 build/resources（便携运行时）");
  const nodeSrc = path.join(REPO_ROOT, "resources", "node");
  if (fs.existsSync(nodeSrc)) cpDir(nodeSrc, path.join(RES_DIR, "node"));
  else console.log("  ⚠ 未找到 resources/node（便携 Node 缺，运行时将回退系统 node）");

  const pySrc = path.join(REPO_ROOT, "resources", "python");
  if (fs.existsSync(pySrc)) cpDir(pySrc, path.join(RES_DIR, "python"));
  else console.log("  ⚠ 未找到 resources/python（便携 Python 缺，运行时将回退系统 python）");

  // 本地离线语音识别（sherpa-onnx 二进制 + 中文模型）：打进 resources/sherpa-onnx，
  // 后端经 VRA_SHERPA_DIR 定位（Electron 无 Web Speech 后端时语音输入走这条）。
  const sttSrc = path.join(REPO_ROOT, "resources", "sherpa-onnx");
  if (fs.existsSync(sttSrc)) cpDir(sttSrc, path.join(RES_DIR, "sherpa-onnx"));
  else console.log("  ⚠ 未找到 resources/sherpa-onnx（离线语音识别缺，运行时该功能降级为打字）");

  console.log(`[stage] 完成，build/ 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
