/**
 * 资金雷达工作台 · 界面截图（Electron 离屏渲染）
 * ------------------------------------------------------------------
 * 用 Electron 离屏 BrowserWindow（offscreen + capturePage）截取三张图：
 * 首页 `/`、Agent 对话 `/agent-chat`、每日复盘 `/daily-review`，
 * 存到 assets/screenshots/2026-10-07/。
 *
 * 关键实现（踩坑记录，别改回）：
 *   - 首页是 eager 路由，`loadURL` 可靠；/agent-chat、/daily-review 是
 *     React.lazy 路由，离屏窗口直接 loadURL 会卡在 did-finish-load 永不触发。
 *     所以：只用【一个窗口】先 loadURL 首页，后续两页走【客户端路由】
 *     （点击侧栏 <a href>，React Router 接管、懒加载 chunk，不触发整页刷新）。
 *   - 深色主题：不用 reload（reload 有二次导航风险），改为复刻应用自身的
 *     深浅切换 applyDarkMode(true)：写 localStorage + 切 html class +
 *     dispatch "fr-theme-changed" 事件，在屏 useDarkMode 实例即时同步 → 整站深色。
 *   - backgroundThrottling:false 防止离屏窗口被后台节流导致 capturePage 卡死。
 *   - 每步 await 带超时兜底 + 全局硬超时 app.exit()，确保脚本必退出。
 *
 * 用法：
 *   node_modules\electron\dist\electron.exe electron\capture-screens.cjs
 *
 * 硬约束：运行前移除 ELECTRON_RUN_AS_NODE；只读 5930（代理 /api→8765），
 * 不改业务逻辑、不碰密钥、不杀现有服务。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if (!app || typeof app !== "object" || !app.whenReady) {
  console.error("[capture] ELECTRON_RUN_AS_NODE 已设置：Electron 退化为 Node，无法离屏截图。请先 Remove-Item env:ELECTRON_RUN_AS_NODE。");
  process.exit(1);
}

const REPO = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO, "assets", "screenshots", "2026-10-07");
const LOG_FILE = path.join(REPO, "build", "capture-screens.log");
const BASE = "http://127.0.0.1:5930";
const WIDTH = 1440;
const HEIGHT = 900;
const GLOBAL_TIMEOUT_MS = 180_000;

/** 三页：路由 + 侧栏导航 href（客户端导航用）+ 输出文件名 + 加载完成标记（非骨架态） */
const PAGES = [
  { path: "/", href: null, file: "home.png", marker: "今日市场" },
  { path: "/agent-chat", href: "/agent-chat", file: "agent-chat.png", marker: "新对话" },
  { path: "/daily-review", href: "/daily-review", file: "daily-review.png", marker: "涨停梯队" },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch { /* ignore */ }
}

app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`超时：${label}（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

async function execJS(win, code, timeoutMs = 8000) {
  return withTimeout(win.webContents.executeJavaScript(code), timeoutMs, "executeJavaScript");
}

async function hasText(win, text, timeoutMs) {
  try {
    return await execJS(win, `!!(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`, timeoutMs);
  } catch {
    return false;
  }
}

async function waitForText(win, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasText(win, text, 3000)) return true;
    await sleep(500);
  }
  return false;
}

/** 复刻应用深浅切换（applyDarkMode(true)）：写 localStorage + 切 class + 广播事件，免 reload */
async function switchDark(win) {
  await execJS(win, `
    (function () {
      localStorage.setItem("vr-theme", "dark");
      var h = document.documentElement;
      h.classList.add("dark");
      h.classList.remove("light");
      h.classList.add("fr-elder-dark");
      window.dispatchEvent(new CustomEvent("fr-theme-changed", { detail: "dark" }));
      return true;
    })()
  `);
}

/** 客户端导航：点击侧栏链接，React Router 接管（懒加载 chunk，不整页刷新） */
async function navTo(win, href) {
  const clicked = await execJS(win, `
    (function () {
      var a = document.querySelector('a[href=${JSON.stringify(href)}]');
      if (!a) return false;
      a.click();
      return true;
    })()
  `);
  return clicked;
}

async function capture(win, file) {
  const image = await withTimeout(
    win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT }),
    15000,
    `capturePage ${file}`,
  );
  const out = path.join(OUT_DIR, file);
  fs.writeFileSync(out, image.toPNG());
  const s = image.getSize();
  log(`   ✓ ${file} -> ${path.relative(REPO, out)} (${s.width}x${s.height}, ${fs.statSync(out).size} bytes)`);
}

app.whenReady().then(async () => {
  const hardExit = setTimeout(() => {
    log("GLOBAL_TIMEOUT：超过全局超时，强制退出");
    app.exit(2);
  }, GLOBAL_TIMEOUT_MS);
  hardExit.unref?.();

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    backgroundColor: "#0b0f14",
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    log(`开始截图：BASE=${BASE} OUT=${path.relative(REPO, OUT_DIR)}`);

    // ① 加载首页（eager 路由，可靠）
    log("① 加载首页 …");
    await withTimeout(win.loadURL(`${BASE}/`), 30000, "load /");
    await sleep(2000); // 等 SPA 外壳 + useDarkMode 挂载、订阅 fr-theme-changed

    // ② 切深色（复刻 applyDarkMode，免 reload），再等首页数据就绪
    log("② 切换深色主题（fr-theme-changed 广播，免 reload）…");
    await switchDark(win);
    await sleep(800);

    // ③ 首页：等数据内容就绪 → 截图
    const homeOk = await waitForText(win, PAGES[0].marker, 40000);
    log(`   首页标记「${PAGES[0].marker}」${homeOk ? "已出现" : "未出现（继续截图）"}`);
    await sleep(3000); // 世界指数卡直连、数字动画稳定
    await capture(win, PAGES[0].file);

    // ④ 客户端导航到 Agent 对话 + 每日复盘，各自等数据就绪再截图
    for (const p of PAGES.slice(1)) {
      log(`④ 客户端导航 → ${p.path} …`);
      const clicked = await navTo(win, p.href);
      log(`   点击侧栏 ${p.href}：${clicked ? "已触发" : "未找到链接（继续等标记）"}`);
      const ok = await waitForText(win, p.marker, 45000);
      log(`   ${p.path} 标记「${p.marker}」${ok ? "已出现" : "未出现（继续截图）"}`);
      await sleep(3500); // ECharts 梯队图 / 异步渲染稳定
      await capture(win, p.file);
    }

    log("全部截图完成");
    clearTimeout(hardExit);
    win.destroy();
    app.exit(0);
  } catch (e) {
    log(`截图失败：${e && e.stack ? e.stack : String(e)}`);
    clearTimeout(hardExit);
    try { win.destroy(); } catch { /* ignore */ }
    app.exit(1);
  }
});
