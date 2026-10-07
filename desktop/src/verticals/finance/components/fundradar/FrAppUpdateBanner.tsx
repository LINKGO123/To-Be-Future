/**
 * 资金雷达工作台 · 应用更新「全局横幅 + 侧栏检查入口」。
 * ------------------------------------------------------------
 * - FrAppUpdateBanner：固定右下角横幅，监听 onStatus/onProgress，在
 *   「发现新版本 / 下载中 / 下载完成 / 检查失败」时弹出，家人打开应用
 *   自动检查后无需进设置页也能看到提示；「已是最新版本 / 检查中」不打扰。
 * - FrAppUpdateButton：侧栏「检查更新」图标入口，点击后手动检查，结果经
 *   title 提示 + 图标着色反馈（成功绿 / 失败红），与 FrUpdateButton 同款交互。
 * DSH 风：蓝主色 + 中性灰 + SVG 图标，无 emoji。
 */
import { useEffect, useState } from "react";
import { AlertCircle, Download, LoaderCircle, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkForAppUpdate, type AppUpdateInvokeResult } from "@/lib/fundradarAppUpdate";
import { useAppUpdate } from "@/hooks/useAppUpdate";

export function FrAppUpdateBanner() {
  const { status, progress, downloading, download, install } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  // 出现新的关键状态（可下载 / 已下载）时解除「已关闭」，避免用户错过后续提示。
  useEffect(() => {
    if (status.state === "available" || status.state === "downloaded") {
      setDismissed(false);
    }
  }, [status.state]);

  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const showAvailable = status.state === "available" && !downloading;
  const showDownloading = downloading;
  const showDownloaded = status.state === "downloaded";
  const showError = status.state === "error";

  if (dismissed || !(showAvailable || showDownloading || showDownloaded || showError)) return null;

  return (
    <div className="fr-toast-in fr-glass fixed bottom-4 right-4 z-[80] w-[min(380px,calc(100vw-32px))] border px-5 py-4 shadow-lg"
      role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {showAvailable && (
            <>
              <p className="fr-body font-bold">发现新版本 v{status.state === "available" ? status.version : ""}，是否下载？</p>
              <button type="button" onClick={() => void download()}
                className="fr-btn-h fr-tap fr-body mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-6 font-bold text-primary-foreground hover:opacity-90">
                <Download className="h-6 w-6" aria-hidden="true" /> 下载
              </button>
            </>
          )}

          {showDownloading && (
            <>
              <p className="fr-body font-bold">正在下载更新…</p>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="下载进度">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
              </div>
              <p className="fr-sub mt-2 tabular-nums text-muted-foreground">{pct.toFixed(1)}%</p>
            </>
          )}

          {showDownloaded && (
            <>
              <p className="fr-body font-bold">下载完成，点击重启安装</p>
              <button type="button" onClick={install}
                className="fr-btn-h fr-tap fr-body mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-6 font-bold text-primary-foreground hover:opacity-90">
                <RotateCw className="h-6 w-6" aria-hidden="true" /> 重启
              </button>
            </>
          )}

          {showError && (
            <p className="fr-body inline-flex items-start gap-2 font-bold text-destructive">
              <AlertCircle className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
              检查更新失败{status.state === "error" ? `：${status.message}` : ""}
            </p>
          )}
        </div>
        <button type="button" aria-label="关闭更新提示" onClick={() => setDismissed(true)}
          className="fr-tap -mr-1 -mt-1 shrink-0 rounded-btn p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 侧栏「检查更新」图标入口：手动触发一次检查，结果经 title + 图标色反馈。 */
export function FrAppUpdateButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const res: AppUpdateInvokeResult = await checkForAppUpdate();
    if (!res.ok) {
      setResult({ kind: "err", text: res.reason ?? "检查更新失败" });
    } else if (res.updateAvailable === false) {
      setResult({ kind: "ok", text: "已是最新版本" });
    } else {
      setResult({ kind: "ok", text: `发现新版本${res.version ? ` v${res.version}` : ""}` });
    }
    setBusy(false);
  };

  const title = busy ? "正在检查更新…" : result ? result.text : "检查更新";
  return (
    <button type="button" onClick={() => void run()} disabled={busy}
      aria-label="检查更新" title={title}
      className={cn("fr-icon-btn text-muted-foreground hover:text-foreground",
        busy && "cursor-wait",
        !busy && result && (result.kind === "ok" ? "text-success" : "text-destructive"))}>
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
