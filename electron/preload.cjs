/**
 * 预加载脚本（CommonJS）。
 * 只暴露无害的桌面环境标记与「自动更新」桥，**绝不**暴露后端 Bearer token 或任何凭据：
 * token 由主进程内置反代在服务端注入（复刻 Vite dev proxy 语义），浏览器侧永远拿不到。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__FR_DESKTOP__", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  packaged: process.argv.some((a) => a.endsWith(".asar")) || !process.defaultApp,
}));

// 自动更新（electron-updater）桥：只转发方法调用与事件，不含任何凭据。
// 主进程可能在渲染层订阅前就发出事件（启动自动检查早于 React 挂载），
// 这里缓存最近一次状态 / 进度，订阅时先回放，避免「新版本可用」提示被错过。
let lastStatus = null;
let lastProgress = null;
ipcRenderer.on("fr:update:status", (_event, payload) => { lastStatus = payload; });
ipcRenderer.on("fr:update:progress", (_event, payload) => { lastProgress = payload; });

contextBridge.exposeInMainWorld("__FR_UPDATE__", Object.freeze({
  check: () => ipcRenderer.invoke("app:check-update"),
  download: () => ipcRenderer.invoke("app:download-update"),
  install: () => ipcRenderer.invoke("app:install-update"),
  onStatus: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("fr:update:status", handler);
    if (lastStatus) { try { cb(lastStatus); } catch { /* 回调异常不影响 */ } }
    return () => ipcRenderer.removeListener("fr:update:status", handler);
  },
  onProgress: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("fr:update:progress", handler);
    if (lastProgress) { try { cb(lastProgress); } catch { /* 回调异常不影响 */ } }
    return () => ipcRenderer.removeListener("fr:update:progress", handler);
  },
}));
