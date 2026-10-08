/**
 * 资金雷达工作台 · 应用自动更新面板（设置页「软件更新」分组）。
 * ------------------------------------------------------------
 * 监听 window.__FR_UPDATE__.onStatus/onProgress，展示四类状态：
 *   - 检查中：转圈
 *   - 发现新版本 vX：提示 + 「下载」按钮（autoDownload=false，先问再下）
 *   - 下载中：进度条 + 百分比
 *   - 下载完成：提示 + 「重启」按钮（quitAndInstall）
 *   无更新：「已是最新版本」；失败：「检查更新失败」+ 原因。
 * DSH 风：蓝主色 + 中性灰 + SVG 图标，无 emoji。
 */
import { AlertCircle, Check, Download, LoaderCircle, RefreshCw, RotateCw } from "lucide-react";
import { useAppUpdate } from "@/hooks/useAppUpdate";

export function FrAppUpdate() {
  const { status, progress, busy, downloading, check, download, install } = useAppUpdate();

  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;

  return (
    <div className="space-y-3">
      {/* 检查更新入口（始终可用；busy=检查中，downloading=下载中，二者皆禁点） */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void check()} disabled={busy || downloading}
          className="fr-btn-h fr-tap fr-body inline-flex items-center gap-2 rounded-btn border border-border bg-card px-6 font-bold hover:border-primary/50 disabled:cursor-wait disabled:opacity-60">
          {busy ? <LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /> : <RefreshCw className="h-6 w-6 text-primary" aria-hidden="true" />}
          {busy ? "正在检查…" : "检查更新"}
        </button>
        {status.state === "idle" && (
          <span className="fr-sub text-muted-foreground">应用启动后也会自动检查一次（发布到 GitHub Releases 后生效）。</span>
        )}
      </div>

      {/* 发现新版本 → 询问是否下载 */}
      {status.state === "available" && !downloading && (
        <div className="rounded-btn border border-primary/40 bg-primary-subtle p-4" role="status" aria-live="polite">
          <p className="fr-body font-bold">发现新版本 v{status.version}，是否下载？</p>
          <p className="fr-sub mt-1 text-muted-foreground">当前版本 v{status.current} · 下载完成后需重启安装。</p>
          <button type="button" onClick={() => void download()}
            className="fr-btn-h fr-tap fr-body mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-8 font-bold text-primary-foreground hover:opacity-90">
            <Download className="h-6 w-6" aria-hidden="true" /> 下载
          </button>
        </div>
      )}

      {/* 下载中 → 进度条 */}
      {downloading && (
        <div className="rounded-btn border border-border bg-card p-4" role="status" aria-live="polite">
          <p className="fr-body font-bold">正在下载更新…</p>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="下载进度">
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
          <p className="fr-sub mt-2 tabular-nums text-muted-foreground">{pct.toFixed(1)}%</p>
        </div>
      )}

      {/* 下载完成 → 重启安装 */}
      {status.state === "downloaded" && (
        <div className="rounded-btn border border-success/40 bg-success/10 p-4" role="status" aria-live="polite">
          <p className="fr-body font-bold">下载完成，点击重启安装</p>
          <p className="fr-sub mt-1 text-muted-foreground">将退出并自动安装 v{status.version}，安装后自动重启。</p>
          <button type="button" onClick={install}
            className="fr-btn-h fr-tap fr-body mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-8 font-bold text-primary-foreground hover:opacity-90">
            <RotateCw className="h-6 w-6" aria-hidden="true" /> 重启
          </button>
        </div>
      )}

      {/* 无更新 */}
      {status.state === "not-available" && (
        <p className="fr-body inline-flex items-center gap-2 font-bold text-success" role="status" aria-live="polite">
          <Check className="h-6 w-6" aria-hidden="true" />
          已是最新版本{status.version ? ` v${status.version}` : ""}
        </p>
      )}

      {/* 失败 */}
      {status.state === "error" && (
        <p className="fr-body flex items-start gap-2 font-bold text-destructive" role="alert">
          <AlertCircle className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">检查更新失败：{status.message}</span>
        </p>
      )}
    </div>
  );
}
