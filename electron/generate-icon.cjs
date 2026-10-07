/**
 * 生成应用图标：用 Electron 离屏窗口把 desktop/public/favicon.svg 渲染成 256×256 PNG，
 * 供 electron-builder 自动转成 Windows .ico。可选项 —— 不跑也不影响打包（用 Electron 默认图标）。
 * 用法：electron electron/generate-icon.cjs
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const SVG = path.join(REPO, "desktop", "public", "favicon.svg");
const OUT = path.join(REPO, "build", "icon.png");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const svgB64 = fs.readFileSync(SVG).toString("base64");
    const html = `<!doctype html><html><head><style>html,body{margin:0;width:256px;height:256px;background:transparent}</style></head><body><img src="data:image/svg+xml;base64,${svgB64}" width="256" height="256" style="display:block"></body></html>`;
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 800)); // 等栅格化
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, image.toPNG());
    console.log(`icon written: ${OUT} ${image.getSize().width}x${image.getSize().height}`);
    win.destroy();
    app.quit();
  } catch (e) {
    console.error("icon generation failed:", e);
    app.exit(1);
  }
});
