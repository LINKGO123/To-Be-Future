/**
 * 资金雷达工作台 · 应用更新订阅 Hook。
 * 订阅 preload 的 onStatus/onProgress，归一化出 status / progress，并暴露
 * check / download / install 三个动作与 busy / downloading 两个本地忙碌态。
 * 浏览器模式（无更新桥）下安全降级：status 保持 idle，动作返回 error。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForAppUpdate, downloadAppUpdate, installAppUpdate,
  getUpdateBridge, mapAppUpdateStatus,
  type AppUpdateProgress, type AppUpdateStatus,
} from "@/lib/fundradarAppUpdate";

export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>({ state: "idle" });
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [busy, setBusy] = useState(false);        // 用户点「检查」/「下载」后的进行中
  const [downloading, setDownloading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const bridge = getUpdateBridge();
    if (!bridge) return () => { mounted.current = false; };

    const offStatus = bridge.onStatus((payload) => {
      const next = mapAppUpdateStatus(payload);
      setStatus(next);
      // 只在终态清 busy；checking 是过程态，保持按钮「正在检查…」直到 available/not-available/error
      if (next.state === "available" || next.state === "not-available" || next.state === "downloaded" || next.state === "error") {
        setBusy(false);
      }
      if (next.state === "downloaded" || next.state === "error") {
        setDownloading(false);
      }
    });
    const offProgress = bridge.onProgress((p) => {
      setProgress(p);
      setDownloading(true);
      setStatus((cur) => (cur.state === "available" || cur.state === "checking" || cur.state === "idle"
        ? { state: "downloading", version: cur.state === "available" ? cur.version : undefined }
        : cur));
    });

    return () => {
      mounted.current = false;
      offStatus();
      offProgress();
    };
  }, []);

  const check = useCallback(async () => {
    setBusy(true);
    setStatus({ state: "checking" });
    const res = await checkForAppUpdate();
    if (!mounted.current) return;
    if (!res.ok) {
      setStatus({ state: "error", message: res.reason ?? "检查更新失败" });
      setBusy(false);
    }
    // res.ok 时状态由 onStatus 事件驱动（checking → available / not-available / error）
  }, []);

  const download = useCallback(async () => {
    setBusy(true);
    setDownloading(true);
    const res = await downloadAppUpdate();
    if (!mounted.current) return;
    if (!res.ok) {
      setStatus({ state: "error", message: res.reason ?? "下载失败" });
      setBusy(false);
      setDownloading(false);
    }
    // res.ok 时进度由 onProgress 事件驱动，完成后由 update-downloaded 事件置为 downloaded
  }, []);

  const install = useCallback(() => {
    // quitAndInstall 会退出并重启应用；这里不 await 结果（进程即将退出）
    void installAppUpdate();
  }, []);

  return { status, progress, busy, downloading, check, download, install };
}
