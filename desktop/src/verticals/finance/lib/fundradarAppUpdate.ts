/**
 * 资金雷达工作台 · 应用自动更新（electron-updater）前端桥。
 * ------------------------------------------------------------
 * 只封装 preload 暴露的 `window.__FR_UPDATE__` 的类型与调用；浏览器模式没有这个对象，
 * 所有函数安全降级为 `{ ok:false }`（不抛异常）。状态由主进程经 `fr:update:status` /
 * `fr:update:progress` 事件推送，React 侧用 `useAppUpdate`（见 hooks/useAppUpdate.ts）订阅。
 */

/** 主进程推送的更新状态（`fr:update:status` 事件负载）。 */
export interface AppUpdateStatusPayload {
  state: "checking" | "available" | "not-available" | "downloaded" | "error";
  version?: string;
  current?: string;
  message?: string;
}

/** 前端归一化后的更新状态（含「下载中」这个客户端派生态）。 */
export type AppUpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; current: string }
  | { state: "not-available"; version?: string; current: string }
  | { state: "downloading"; version?: string }
  | { state: "downloaded"; version: string; current: string }
  | { state: "error"; message: string };

/** 下载进度（`fr:update:progress` 事件负载）。 */
export interface AppUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

/** IPC 方法返回结果。 */
export interface AppUpdateInvokeResult {
  ok: boolean;
  reason?: string;
  updateAvailable?: boolean;
  version?: string;
}

interface FrUpdateBridge {
  check: () => Promise<AppUpdateInvokeResult>;
  download: () => Promise<AppUpdateInvokeResult>;
  install: () => Promise<AppUpdateInvokeResult>;
  onStatus: (cb: (payload: AppUpdateStatusPayload) => void) => () => void;
  onProgress: (cb: (payload: AppUpdateProgress) => void) => () => void;
}

/** 取 preload 暴露的更新桥；浏览器模式返回 null。 */
export function getUpdateBridge(): FrUpdateBridge | null {
  const w = window as unknown as { __FR_UPDATE__?: FrUpdateBridge };
  return w.__FR_UPDATE__ ?? null;
}

export function hasUpdateBridge(): boolean {
  return getUpdateBridge() !== null;
}

export function mapAppUpdateStatus(p: AppUpdateStatusPayload): AppUpdateStatus {
  const current = p.current ?? "";
  switch (p.state) {
    case "checking": return { state: "checking" };
    case "available": return { state: "available", version: p.version ?? "", current };
    case "not-available": return { state: "not-available", version: p.version, current };
    case "downloaded": return { state: "downloaded", version: p.version ?? "", current };
    case "error": return { state: "error", message: clipUpdateMessage(p.message ?? "未知错误") };
    default: return { state: "idle" };
  }
}

/** 主进程正常只发一句话；这里再兜一层：折叠空白 + 截断，防止任何超长文本（堆栈/Headers）撑爆 UI。 */
const MAX_UPDATE_MSG_LEN = 160;
function clipUpdateMessage(raw: string): string {
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t) return "未知错误";
  return t.length > MAX_UPDATE_MSG_LEN ? `${t.slice(0, MAX_UPDATE_MSG_LEN)}…` : t;
}

export function checkForAppUpdate(): Promise<AppUpdateInvokeResult> {
  const b = getUpdateBridge();
  if (!b) return Promise.resolve({ ok: false, reason: "仅桌面版支持自动更新" });
  return b.check();
}

export function downloadAppUpdate(): Promise<AppUpdateInvokeResult> {
  const b = getUpdateBridge();
  if (!b) return Promise.resolve({ ok: false, reason: "仅桌面版支持自动更新" });
  return b.download();
}

export function installAppUpdate(): Promise<AppUpdateInvokeResult> {
  const b = getUpdateBridge();
  if (!b) return Promise.resolve({ ok: false, reason: "仅桌面版支持自动更新" });
  return b.install();
}
