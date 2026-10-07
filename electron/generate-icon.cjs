/**
 * 生成应用图标：用 Electron 离屏窗口把 desktop/public/favicon.svg 渲染成 PNG。
 * 供 electron-builder 使用：Windows 用 256×256 PNG 自动转 .ico；
 * macOS 用 1024×1024 PNG，再由 scripts/make-icns.sh 转成 .icns。可选项 —— 不跑也不影响打包。
 * 用法：
 *   electron electron/generate-icon.cjs                                 # 默认 256 → build/icon.png
 *   electron electron/generate-icon.cjs --size 1024 --out build/icon-1024.png
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const SVG = path.join(REPO, "desktop", "public", "favicon.svg");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}
const SIZE = parseInt(arg("size", "256"), 10);
const OUT = path.resolve(REPO, arg("out", path.join("build", "icon.png")));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const svgB64 = fs.readFileSync(SVG).toString("base64");
    const html = `<!doctype html><html><head><style>html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}</style></head><body><img src="data:image/svg+xml;base64,${svgB64}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`;
    const win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 800)); // 等栅格化
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
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
