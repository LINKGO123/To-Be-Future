import assert from "node:assert/strict";
import test from "node:test";
import { mapAppUpdateStatus } from "../src/verticals/finance/lib/fundradarAppUpdate.ts";

/** 模拟 electron-updater 的真实 err.message：一句人话 + Headers JSON + 调用堆栈（数千字符）。 */
const RAW_UPDATER_ERROR = [
  "Cannot find latest-mac.yml in the latest release artifacts (https://github.com/x/y/releases/download/v1.0.0/latest-mac.yml): HttpError: 404",
  "Headers: {",
  '  "content-type": "text/plain; charset=utf-8",',
  '  "x-github-request-id": "9B7E:3337E9:9576D:CA87B",',
  "}",
  "    at createHttpError (/app/node_modules/builder-util-runtime/out/httpExecutor.js:53:12)",
  "    at ElectronHttpExecutor.handleResponse (/app/node_modules/builder-util-runtime/out/httpExecutor.js:157:20)",
].join("\n");

test("更新失败原因只给一句话：超长堆栈被截断、多行折叠，不把调用堆栈塞进 UI", () => {
  const s = mapAppUpdateStatus({ state: "error", message: RAW_UPDATER_ERROR });
  assert.equal(s.state, "error");
  if (s.state !== "error") return;
  assert.ok(s.message.length <= 161, `截断后应为 160 字符 + 省略号，实际 ${s.message.length}`);
  assert.ok(s.message.endsWith("…"), "超长文本应以省略号结尾");
  assert.ok(s.message.startsWith("Cannot find latest-mac.yml"), "保留错误原因开头，便于定位");
  assert.doesNotMatch(s.message, /at createHttpError/, "调用堆栈不应进入 UI 文案");
  assert.doesNotMatch(s.message, /\n/, "UI 文案不应保留换行（否则横幅会被撑高）");
});

test("短错误原因原样透传；缺 message 时回落默认文案", () => {
  assert.deepEqual(mapAppUpdateStatus({ state: "error", message: "网络不可用" }),
    { state: "error", message: "网络不可用" });
  assert.deepEqual(mapAppUpdateStatus({ state: "error" }),
    { state: "error", message: "未知错误" });
});

test("「未发布新版本」按暂无更新处理（主进程 404 分支对应 not-available，前端不展示错误）", () => {
  assert.deepEqual(
    mapAppUpdateStatus({ state: "not-available", current: "1.2.0" }),
    { state: "not-available", version: undefined, current: "1.2.0" },
  );
});

test("其余更新状态映射不受影响", () => {
  assert.deepEqual(mapAppUpdateStatus({ state: "checking" }), { state: "checking" });
  assert.deepEqual(mapAppUpdateStatus({ state: "available", version: "1.3.0", current: "1.2.0" }),
    { state: "available", version: "1.3.0", current: "1.2.0" });
  assert.deepEqual(mapAppUpdateStatus({ state: "downloaded", version: "1.3.0", current: "1.2.0" }),
    { state: "downloaded", version: "1.3.0", current: "1.2.0" });
  assert.deepEqual(mapAppUpdateStatus({ state: "idle" as never }), { state: "idle" });
});
