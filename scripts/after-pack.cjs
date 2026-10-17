/**
 * electron-builder afterPack 钩子 · macOS ad-hoc 重签名
 * ------------------------------------------------------------
 * 背景：Electron 官方二进制自带 adhoc/linker-signed 签名，但打包会改动 app bundle
 * （注入 app.asar、resources 等），原签名与新资源不匹配。
 * macOS 14+ 的 Gatekeeper 会判定「code has no resources but signature indicates they must be present」
 * → 用户看到「应用已损坏，无法打开」，右键也打不开。
 *
 * 修复：打包后、生成 dmg 前，对整个 app 做 ad-hoc 重签名（codesign --sign -）。
 * 重签后 codesign --verify 通过；Gatekeeper 变为「未验证开发者」（可右键 → 打开绕过），
 * 不再是「已损坏」。
 *
 * 注意：这不是开发者 ID 签名/公证，只是让 app 结构自洽可用。
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  // 只处理 macOS
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[afterPack] ad-hoc 重签：${appPath}`);

  // 1) 重签整个 app（--deep 处理 Frameworks / Helpers）
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });

  // 2) 验证签名自洽（失败会让打包失败，避免再产出「已损坏」的包）
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log("[afterPack] 重签完成，签名验证通过");
};
