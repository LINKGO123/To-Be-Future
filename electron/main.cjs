/**
 * To Be Future 资金雷达工作台 · Electron 便携壳（主进程，CommonJS）
 * ------------------------------------------------------------------
 * 职责（与浏览器模式 `启动资金雷达.ps1` 并存，互不干扰）：
 *   1) 单实例锁：二次启动聚焦已有窗口；
 *   2) 自动选空闲端口（API 8765 / UI 5930 被占则 +1 递增）；
 *   3) spawn 后端 `<node> <app>/orchestrator/src/api.ts --port <apiPort> --host 127.0.0.1`
 *      —— node 优先便携 `resources/node/node.exe`，回退系统 `node`；
 *   4) 环境变量：VRA_REPO_ROOT / VRA_DATA_ROOT / VRA_API_TOKEN / VRA_PYTHON
 *      —— 数据根指向 `app.getPath('userData')`，Python 指向便携解释器；
 *   5) 本进程内置一个最小 HTTP 服务：serve `desktop/dist`（SPA）+ 把 `/api/*` 反代到后端
 *      并注入 Bearer token（复刻 Vite dev proxy 语义，token 永不进浏览器）；
 *   6) 轮询后端 `/health`（带 token）直到 ok 或 30s 超时，超时弹可见错误窗口；
 *   7) 退出清理：`before-quit` 异步 `taskkill /T /F` 杀掉后端子进程树（不阻塞退出），
 *      `will-quit` 显式 `app.releaseSingleInstanceLock()`；后端由守护层保证"主进程死亡即自杀"。
 *
 * 硬约束：本文件不写死任何源码绝对路径，一律用 `process.resourcesPath` / `__dirname` 相对定位。
 */
// 防御：若环境里设了 ELECTRON_RUN_AS_NODE=1（DSH/CI 常见），electron.exe 会退化成纯 Node，
// require("electron") 返回的是路径字符串而不是 Electron API —— 这里给一句能看懂的报错。
const electron = require("electron");
if (!electron || typeof electron !== "object" || !electron.app) {
  console.error(
    "[fund-radar-desktop] 检测到 ELECTRON_RUN_AS_NODE 已设置：Electron 以 Node 模式运行，无法启动桌面壳。\n" +
    "请移除环境变量 ELECTRON_RUN_AS_NODE 后重试（真实用户机器通常不会设置它）。",
  );
  process.exit(1);
}
const { app, BrowserWindow, dialog, session, ipcMain } = electron;
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const net = require("node:net");

// 让 userData 路径稳定为 ASCII（避免中文/空格目录带来的下游扫描歧义）。
app.setName("fund-radar-desktop");

const IS_PACKAGED = app.isPackaged;

// 路径定位（不写死源码绝对路径）：
//   - 打包后：仓库内容在 `resources/app`，便携运行时在 `resources/{node,python}`；
//   - 开发：   仓库根 = electron/ 上一级，便携运行时在 `<repo>/resources/{node,python}`。
const APP_ROOT = IS_PACKAGED
  ? path.join(process.resourcesPath, "app")
  : path.resolve(__dirname, "..");
const RESOURCES_DIR = IS_PACKAGED
  ? process.resourcesPath
  : path.join(APP_ROOT, "resources");

const NODE_EXE = path.join(RESOURCES_DIR, "node", "node.exe");
const PYTHON_EXE = path.join(RESOURCES_DIR, "python", "python.exe");

const API_BASE_PORT = 8765;
const UI_BASE_PORT = 5930;
const READY_TIMEOUT_MS = 30_000;

// ---- 运行态 ----
let apiProc = null;          // 后端 node 子进程
let uiServer = null;         // 内置 UI/代理 HTTP 服务
let uiPort = 0;
let apiPort = 0;
let mainWindow = null;
let userDataRoot = "";
let logFd = null;            // 主进程日志文件描述符
let quitting = false;

/* ---------------- 日志 ---------------- */
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
  try {
    if (logFd !== null) fs.appendFileSync(logFd, line + "\n", "utf8");
  } catch {
    /* 日志失败不影响启动 */
  }
}

function ensureLogDir() {
  const dir = path.join(userDataRoot, "logs");
  fs.mkdirSync(dir, { recursive: true });
  logFd = path.join(dir, "main.log");
  fs.mkdirSync(path.dirname(logFd), { recursive: true });
}

/* ---------------- 数据根 / 目录 ---------------- */
function ensureUserData() {
  userDataRoot = app.getPath("userData");
  fs.mkdirSync(userDataRoot, { recursive: true });
  // 后端 `safePath` 与 `resolveToken` 依赖数据根存在；子目录先建好（幂等）。
  for (const sub of ["codex-home", "runs", "knowledge", "providers", "mcp", "logs"]) {
    fs.mkdirSync(path.join(userDataRoot, sub), { recursive: true });
  }
  ensureLogDir();
}

/* ---------------- 运行时解析 ---------------- */
function resolveNode() {
  if (fs.existsSync(NODE_EXE)) return NODE_EXE;
  // 回退：PATH 上的 node（开发机 / 系统已装）
  log("warn", `未找到便携 Node：${NODE_EXE}，回退系统 node`);
  return "node";
}

function resolvePython() {
  if (fs.existsSync(PYTHON_EXE)) return PYTHON_EXE;
  // 开发回退：仓库内 .venv
  const venv = path.join(APP_ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venv)) return venv;
  log("warn", `未找到便携 Python：${PYTHON_EXE}，回退 PATH 上的 python`);
  return "python";
}

/* ---------------- 空闲端口 ---------------- */
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      if (port > start + 100) return reject(new Error(`在 ${start} 起 100 个端口内均被占用`));
      const srv = net.createServer();
      srv.unref();
      srv.once("error", () => {
        port += 1;
        attempt();
      });
      srv.listen(port, "127.0.0.1", () => {
        srv.close(() => resolve(port));
      });
    };
    attempt();
  });
}

/* ---------------- 进程树清理 ---------------- */
function killProcessTree(pid) {
  if (!pid) return;
  try {
    // 异步 taskkill：不再用 spawnSync 同步阻塞主进程退出。
    // 此前 spawnSync + timeout 8000 最长会卡住 app.quit() 8 秒，导致单实例锁
    // 释放延迟 —— 用户关窗后立刻再点会拿不到锁而"打不开"。
    const taskkill = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    taskkill.on("error", (err) => log("warn", `taskkill 失败:${err.message}`));
    // 不让 taskkill 子进程句柄拖住主进程事件循环；它是独立 OS 进程，会自行完成清理。
    taskkill.unref();
  } catch (e) {
    log("warn", `taskkill 异常:${e && e.message ? e.message : String(e)}`);
  }
}

/* 守护脚本：由主进程用 `node -e` 启动，作为后端的"父进程死亡即自杀"守护层。
 * 原理：主进程给守护进程的 stdin 开一条管道且从不写入、也不关闭；主进程一旦退出
 * （无论正常还是被强杀），OS 关闭该管道写端 → 守护进程 stdin 收到 close → 立即
 * taskkill 掉后端整棵树，避免残留孤儿 node/python 进程。
 * 后端真实参数经 argv 透传；环境变量（含 token）走 env 继承，不进命令行，避免泄露。 */
const GUARDIAN_SCRIPT = [
  'const { spawn, spawnSync } = require("node:child_process");',
  'let child = null;',
  'let killing = false;',
  'function killTree() {',
  '  if (!child || child.exitCode !== null) return;',
  '  try { spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 4000 }); } catch (e) {}',
  '}',
  'function onParentGone() {',
  '  if (killing) return;',
  '  killing = true;',
  '  killTree();',
  '  process.exit(0);',
  '}',
  'try {',
  '  child = spawn(process.execPath, [process.argv[1]].concat(process.argv.slice(2)), {',
  '    stdio: ["ignore", "inherit", "inherit"],',
  '    windowsHide: true,',
  '    env: process.env,',
  '  });',
  '} catch (e) {',
  '  process.stderr.write("guardian spawn failed: " + (e && e.message ? e.message : String(e)) + "\\n");',
  '  process.exit(1);',
  '}',
  'process.stdin.resume();',
  'process.stdin.on("end", onParentGone);',
  'process.stdin.on("close", onParentGone);',
  'process.stdin.on("error", function () {});',
  'child.on("error", function () { process.exit(1); });',
  'child.on("exit", function (code) { if (killing) return; process.exit(code == null ? 1 : code); });',
].join("\n");

/* ---------------- 后端 spawn ---------------- */
function spawnBackend(port, token) {
  const node = resolveNode();
  const python = resolvePython();
  const entry = path.join(APP_ROOT, "orchestrator", "src", "api.ts");
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到后端入口 ${entry}（打包资源不完整？）`);
  }

  const env = {
    ...process.env,
    VRA_REPO_ROOT: APP_ROOT,
    VRA_DATA_ROOT: userDataRoot,
    VRA_API_TOKEN: token,
    VRA_PYTHON: python,
    // 本地离线语音识别资产（sherpa-onnx 二进制 + 中文模型）：打包后位于 resources/sherpa-onnx
    VRA_SHERPA_DIR: path.join(RESOURCES_DIR, "sherpa-onnx"),
    // 让便携解释器目录也在 PATH 里（后端 python3 兜底 / 脚本子进程可复用）
    PATH: [
      path.dirname(node === "node" ? "node" : node),
      path.dirname(python === "python" ? "python" : python),
      process.env.PATH || "",
    ].filter(Boolean).join(path.delimiter),
  };

  const outFd = fs.openSync(path.join(userDataRoot, "logs", "backend.out.log"), "a");
  const errFd = fs.openSync(path.join(userDataRoot, "logs", "backend.err.log"), "a");
  log("info", `启动后端:${node} ${path.relative(APP_ROOT, entry)} --port ${port} --host 127.0.0.1`);
  log("info", `  python=${python}  dataRoot=${userDataRoot}`);

  const child = spawn(node, ["-e", GUARDIAN_SCRIPT, entry, "--port", String(port), "--host", "127.0.0.1"], {
    cwd: APP_ROOT,
    env,
    windowsHide: true,
    // stdin 用 pipe（守护层的"父进程存活"心跳）：主进程从不写入也从不关闭它。
    stdio: ["pipe", outFd, errFd],
  });
  child.on("error", (err) => {
    log("error", `后端启动失败:${err.message}`);
  });
  child.on("exit", (code, signal) => {
    log("info", `后端进程退出 code=${code} signal=${signal}`);
    try { fs.closeSync(outFd); fs.closeSync(errFd); } catch { /* ignore */ }
    if (!quitting) {
      // 后端意外退出：给用户可见提示（此时窗口可能已能连不上）
      dialog.showErrorBox(
        "To Be Future 资金雷达",
        `本机服务已停止（退出码 ${code ?? "未知"}）。\n请查看日志：${path.join(userDataRoot, "logs", "backend.err.log")}`,
      ).then(() => {}).catch(() => {});
    }
  });
  return child;
}

/* ---------------- 就绪轮询 ---------------- */
async function waitBackendReady(port, token) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (apiProc && apiProc.exitCode !== null) {
      throw new Error(`后端启动失败（退出码 ${apiProc.exitCode}），请查看 logs/backend.err.log`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body && body.ok === true) return body;
      }
    } catch {
      /* 还没起来，继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("后端启动等待超过 30 秒，请查看 logs/backend.err.log");
}

/* ---------------- 静态 + 反代 HTTP 服务 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function proxyToBackend(req, res, apiPort, token, targetPath) {
  const headers = { ...req.headers };
  // 去掉 hop-by-hop 头；Node 会自己填 Host / Connection
  delete headers.host;
  delete headers["content-length"];
  delete headers.connection;
  // 注入后端鉴权（复刻 Vite dev proxy：token 只留在本进程，不进浏览器）
  headers.authorization = `Bearer ${token}`;

  const proxyReq = http.request(
    { host: "127.0.0.1", port: apiPort, path: targetPath, method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      error: "api_unreachable",
      message: `本机服务没有启动或已经关闭：${err.message}`,
    }));
  });
  req.pipe(proxyReq);
  // 客户端中断（如前端 AbortSignal）时掐断到后端的请求，后端据此中止计费。
  // 🔴 不能在 `req.on("close")` 里 destroy：IncomingMessage 的 close 在 GET 无 body 时
  //    请求一读完就触发，会抢在后端响应前掐断连接（表现为 502 socket hang up）。
  //    正确做法是盯响应流：未正常写完就关闭 = 客户端提前断开。
  res.on("close", () => {
    if (!res.writableEnded) proxyReq.destroy();
  });
}

/* WebSocket 反代（流式语音 /transcribe-stream）：与 HTTP 反代同款「注入 Bearer」语义。
 * 浏览器 WS 不能自定义头，token 只留在本进程；upgrade 请求经 http.request 转发到后端，
 * 后端 101 后把两侧 socket 直连。 */
function proxyUpgradeToBackend(req, socket, head, apiPort, token, targetPath) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  headers.authorization = `Bearer ${token}`;

  const proxyReq = http.request({
    host: "127.0.0.1",
    port: apiPort,
    path: targetPath,
    method: "GET",
    headers,
  });

  const writeHead = (statusCode, statusMessage, hdrs) => {
    let line = `HTTP/1.1 ${statusCode} ${statusMessage || ""}\r\n`;
    for (const k of Object.keys(hdrs || {})) {
      if (k === "connection" && !/upgrade/i.test(String(hdrs[k]))) continue;
      line += `${k}: ${hdrs[k]}\r\n`;
    }
    line += "\r\n";
    socket.write(line);
  };

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    writeHead(proxyRes.statusCode || 101, proxyRes.statusMessage, proxyRes.headers);
    if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on("response", (proxyRes) => {
    // 后端拒绝 upgrade（401 鉴权失败 / 503 流式模型不可用）：透传错误响应，浏览器据此回退
    writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, proxyRes.headers);
    proxyRes.pipe(socket);
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
}

function createUiServer(apiPort, token) {
  const distDir = path.join(APP_ROOT, "desktop", "dist");
  const indexHtml = path.join(distDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    log("warn", `未找到前端产物 ${indexHtml}（先执行 pnpm --dir desktop run build）`);
  }

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("bad path");
    }

    // /api → 反代到后端（去掉 /api 前缀，与 Vite rewrite 一致）
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const search = new URL(req.url || "/", "http://127.0.0.1").search;
      const target = pathname.replace(/^\/api/, "") + search;
      return proxyToBackend(req, res, apiPort, token, target || "/");
    }

    // 静态文件 + SPA 回退
    let filePath = path.join(distDir, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    // 路径逃逸防护：解析后必须仍在 distDir 内
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      filePath = indexHtml;
    }
    const serveFile = (fp) => {
      try {
        const data = fs.readFileSync(fp);
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
        });
        res.end(data);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
      }
    };

    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
      return serveFile(filePath);
    }
    // 客户端路由（createBrowserRouter）→ 回退 index.html
    return serveFile(indexHtml);
  });

  // WebSocket 反代（流式语音 /transcribe-stream）：同 /api 前缀去重写 + 注入 Bearer
  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      socket.destroy();
      return;
    }
    const search = new URL(req.url || "/", "http://127.0.0.1").search;
    const target = pathname.replace(/^\/api/, "") + search;
    proxyUpgradeToBackend(req, socket, head, apiPort, token, target || "/");
  });

  return server;
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f14",
    title: "To Be Future 资金雷达",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("error", `页面加载失败 ${code} ${desc} ${url}`);
  });
  // 外链一律走系统浏览器，不在 Electron 内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadURL(`http://127.0.0.1:${uiPort}/`);
  return mainWindow;
}

/* ---------------- 自动更新（electron-updater · GitHub Releases，未签名） ----------------
 * 说明：
 *   - autoDownload=false：只检查并通知，不静默下载；用户点「下载」后才调 downloadUpdate()。
 *   - feedUrl 的 owner/repo 不写死：按 环境变量 FR_UPDATE_REPO > 常量 UPDATE_REPO >
 *     package.json 的 repository 字段 的优先级解析；发布前填 UPDATE_REPO（或补 repository 字段）。
 *   - 未签名：electron-updater 的 NSIS 更新链路仍可用，但 Windows SmartScreen 会告警（已知，接受）。
 *   - 开发模式（app.isPackaged=false）下 electron-updater 默认跳过检查（dev 更新配置未强制），
 *     不影响 `electron:dev` 启动；打包成 NSIS 后才会真正请求 GitHub Releases。
 *   - 私有仓库需在发布/运行环境提供 GH_TOKEN 环境变量（electron-updater 会自动读取），此处不处理密钥。
 */
const UPDATE_REPO = "LINKGO123/To-Be-Future"; // 发布仓库（owner/repo）

let updater = null;       // 惰性加载的 autoUpdater 实例
let updaterFailed = false;

/** 解析更新仓库 owner/repo：环境变量 > 常量 > package.json repository。返回 null 表示未配置。 */
function resolveUpdateRepo() {
  const fromStr = (s) => {
    const parts = String(s).trim().split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts.slice(1).join("/").replace(/\.git$/, "") };
    }
    return null;
  };
  if (process.env.FR_UPDATE_REPO) {
    const r = fromStr(process.env.FR_UPDATE_REPO);
    if (r) return r;
  }
  if (UPDATE_REPO) {
    const r = fromStr(UPDATE_REPO);
    if (r) return r;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    const rep = pkg && pkg.repository;
    if (typeof rep === "string") {
      const r = fromStr(rep);
      if (r) return r;
    } else if (rep && typeof rep.url === "string") {
      const m = rep.url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
      if (m) return { owner: m[1], repo: m[2] };
    }
  } catch {
    /* 读取 package.json 失败可忽略 */
  }
  return null;
}

/** 给渲染进程发更新状态（窗口销毁时安全跳过）。 */
function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fr:update:status", payload);
  }
}

function sendUpdateProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fr:update:progress", payload);
  }
}

/** 惰性加载 electron-updater 并装配事件 / feedUrl（只成功一次）。 */
function ensureUpdater() {
  if (updater) return updater;
  if (updaterFailed) return null;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;       // 先提示再下载，不静默下载
    autoUpdater.allowPrerelease = false;    // 只追稳定版
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (m) => log("info", `[updater] ${m}`),
      warn: (m) => log("warn", `[updater] ${m}`),
      error: (m) => log("error", `[updater] ${m}`),
      debug: () => {},                      // debug 太噪，静默
    };
    const target = resolveUpdateRepo();
    if (target) {
      autoUpdater.setFeedURL({ provider: "github", owner: target.owner, repo: target.repo });
    }
    autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking", current: app.getVersion() }));
    autoUpdater.on("update-available", (info) =>
      sendUpdateStatus({ state: "available", version: info && info.version, current: app.getVersion() }));
    autoUpdater.on("update-not-available", (info) =>
      sendUpdateStatus({ state: "not-available", version: info && info.version, current: app.getVersion() }));
    autoUpdater.on("download-progress", (p) =>
      sendUpdateProgress({
        percent: p && p.percent,
        transferred: p && p.transferred,
        total: p && p.total,
        bytesPerSecond: p && p.bytesPerSecond,
      }));
    autoUpdater.on("update-downloaded", (info) =>
      sendUpdateStatus({ state: "downloaded", version: info && info.version, current: app.getVersion() }));
    autoUpdater.on("error", (err) =>
      sendUpdateStatus({ state: "error", message: err && err.message ? err.message : String(err), current: app.getVersion() }));
    updater = autoUpdater;
    return updater;
  } catch (e) {
    updaterFailed = true;
    log("warn", `加载 electron-updater 失败（自动更新不可用）：${e && e.message ? e.message : String(e)}`);
    return null;
  }
}

/** 注册更新相关 IPC（只应在 whenReady 里调用一次）。 */
function setupUpdateIpc() {
  ipcMain.handle("app:check-update", async () => {
    const u = ensureUpdater();
    if (!u) return { ok: false, reason: "自动更新组件不可用（electron-updater 未安装）" };
    if (!resolveUpdateRepo()) return { ok: false, reason: "未配置更新仓库（发布前在 electron/main.cjs 填 UPDATE_REPO）" };
    try {
      const res = await u.checkForUpdates();
      // checkForUpdates 在打包态返回 { isUpdateAvailable, updateInfo }（仅开发模式才返回 null）
      return {
        ok: true,
        updateAvailable: !!(res && res.isUpdateAvailable),
        version: res && res.updateInfo ? res.updateInfo.version : undefined,
      };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  });
  ipcMain.handle("app:download-update", async () => {
    const u = ensureUpdater();
    if (!u) return { ok: false, reason: "自动更新组件不可用（electron-updater 未安装）" };
    try {
      await u.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  });
  ipcMain.handle("app:install-update", () => {
    const u = ensureUpdater();
    if (!u) return { ok: false, reason: "自动更新组件不可用（electron-updater 未安装）" };
    // 非静默退出 + 安装后自动重启；NSIS 安装器会覆盖安装
    u.quitAndInstall(false, true);
    return { ok: true };
  });
}

/** 启动自动检查（窗口加载完成后调用，渲染层此时已订阅事件）。 */
function autoCheckForUpdates() {
  const u = ensureUpdater();
  if (!u) return;
  if (!resolveUpdateRepo()) {
    log("info", "未配置更新仓库（UPDATE_REPO 为空），跳过启动自动检查。发布前填 electron/main.cjs 的 UPDATE_REPO。");
    return;
  }
  u.checkForUpdates().catch((e) =>
    log("warn", `自动检查更新失败：${e && e.message ? e.message : String(e)}`));
}

/* ---------------- 生命周期 ---------------- */
function cleanup() {
  quitting = true;
  if (apiProc && apiProc.exitCode === null) killProcessTree(apiProc.pid);
  apiProc = null;
  if (uiServer) {
    try { uiServer.close(); } catch { /* ignore */ }
    uiServer = null;
  }
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      ensureUserData();
      log("info", `资源根=${APP_ROOT}  运行时根=${RESOURCES_DIR}  数据根=${userDataRoot}`);

      // 麦克风权限：Electron 无 Web Speech 后端，语音输入走 getUserMedia 录本地 WAV，
      // 交给后端 sherpa-onnx 离线识别。这里放行 microphone（"media"），其余权限一律拒绝。
      session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(permission === "media");
      });
      session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

      // 1) 选端口（避开用户正在跑的浏览器模式 8765/5930）
      apiPort = await findFreePort(API_BASE_PORT);
      log("info", `选定 API 端口 ${apiPort}`);

      // 2) 会话 token（后端 resolveToken 读到 VRA_API_TOKEN 直接用，不落盘）
      const token = crypto.randomBytes(24).toString("hex");

      // 3) 起后端
      apiProc = spawnBackend(apiPort, token);

      // 4) 等后端就绪
      await waitBackendReady(apiPort, token);

      // 5) 起内置 UI/代理服务
      uiPort = await findFreePort(UI_BASE_PORT);
      uiServer = createUiServer(apiPort, token);
      await new Promise((resolve, reject) => {
        uiServer.once("error", reject);
        uiServer.listen(uiPort, "127.0.0.1", resolve);
      });
      log("info", `UI 服务 http://127.0.0.1:${uiPort} (代理 /api → 127.0.0.1:${apiPort})`);

      // 6) 开窗口
      createWindow();

      // 7) 自动更新：注册 IPC + 窗口加载完成后自动检查（autoDownload=false，只提示不静默下载）
      setupUpdateIpc();
      if (mainWindow) {
        mainWindow.webContents.once("did-finish-load", () => {
          setTimeout(autoCheckForUpdates, 2500);
        });
      }
    } catch (err) {
      log("error", `启动失败:${err instanceof Error ? err.stack || err.message : String(err)}`);
      cleanup();
      dialog.showErrorBox(
        "To Be Future 资金雷达 · 启动失败",
        `${err instanceof Error ? err.message : String(err)}\n\n日志目录：${path.join(userDataRoot || app.getPath("userData"), "logs")}`,
      ).finally(() => app.quit());
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && uiPort) createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    cleanup();
  });

  app.on("will-quit", () => {
    // 显式释放单实例锁：确保锁在本进程完全退出前立即释放，不等进程收尾。
    // 这是"关窗后立刻再点仍能启动"的关键 —— 否则二次启动 requestSingleInstanceLock
    // 返回 false → 直接 app.quit()，窗口不出现。
    try {
      app.releaseSingleInstanceLock();
    } catch (e) {
      log("warn", `releaseSingleInstanceLock 失败:${e && e.message ? e.message : String(e)}`);
    }
  });

  // 主进程异常兜底
  process.on("uncaughtException", (err) => {
    log("error", `uncaughtException:${err && err.stack ? err.stack : String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    log("error", `unhandledRejection:${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
}
