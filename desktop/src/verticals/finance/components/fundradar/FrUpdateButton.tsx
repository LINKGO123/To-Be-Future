/**
 * 资金雷达工作台 · 一键更新数据按钮（常用区域）
 * ------------------------------------------------------------
 * variant=big   首页总览区醒目大字按钮：高度 ≥56px、字号 20px，状态文案显示在下方；
 * variant=small 侧栏底部小入口：按钮内短文案随状态切换（更新中… / 已更新 / 部分失败 / 失败），
 *               完整结果放 title 提示；
 * variant=icon  折叠侧栏图标入口：RefreshCw 图标，busy 转圈，title 带状态。
 * 三态结果：全成功 → 绿（success token）；部分失败 → 黄（warning token）；
 * 全部失败 → 红（destructive token）。busy 期间禁点 + 转圈，防止重复触发。
 */
import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { frMnD, updateAllFrData } from "@/lib/fundradarUpdate";

type FrUpdateResult =
  | { kind: "ok" | "warn" | "err"; text: string; detail: string };

export function FrUpdateButton({ variant = "big" }: { variant?: "big" | "small" | "icon" }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FrUpdateResult | null>(null);

  const run = async () => {
    if (busy) return; // 更新中禁点，防止并发重复触发
    setBusy(true);
    try {
      const o = await updateAllFrData();
      if (o.ok > 0 && o.fail === 0) {
        setResult({ kind: "ok", text: `数据已更新至 ${frMnD(o.dataDate)} 盘后`, detail: "7 项数据全部更新成功" });
      } else if (o.ok > 0) {
        setResult({
          kind: "warn",
          text: `已更新 ${o.ok} 项，${o.fail} 项暂不可用（可重试）`,
          detail: `失败项：${o.failedLabels.join("、")}`,
        });
      } else {
        setResult({
          kind: "err",
          text: "全部数据源暂不可用，请稍后重试",
          detail: `失败项：${o.failedLabels.join("、")}`,
        });
      }
    } catch {
      setResult({ kind: "err", text: "更新失败，请稍后重试", detail: "" });
    } finally {
      setBusy(false);
    }
  };

  /** 结果色一律走主题 token：成功绿 / 部分黄 / 失败红 */
  const tone = (kind: FrUpdateResult["kind"]) =>
    kind === "ok" ? "text-success" : kind === "warn" ? "text-warning" : "text-destructive";

  if (variant === "big") {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          aria-busy={busy}
          className={cn(
            "fr-tap fr-press inline-flex min-h-14 items-center justify-center gap-2.5 rounded-btn bg-primary px-8 text-[20px] font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90",
            busy && "cursor-wait opacity-70",
          )}
        >
          {busy
            ? <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            : <RefreshCw className="h-6 w-6" aria-hidden="true" />}
          {busy ? "正在更新数据…" : "一键更新数据"}
        </button>
        {result && !busy && (
          <p
            role={result.kind === "err" ? "alert" : "status"}
            className={cn("fr-body text-center font-bold", tone(result.kind))}
            title={result.detail}
          >
            {result.text}
          </p>
        )}
      </div>
    );
  }

  if (variant === "icon") {
    const title = busy ? "正在更新数据…" : result ? `${result.text}（${result.detail}）` : "一键更新数据";
    return (
      <button type="button" onClick={() => void run()} disabled={busy} aria-label="一键更新数据"
        aria-busy={busy} title={title}
        className={cn("fr-icon-btn text-muted-foreground hover:text-foreground",
          busy && "cursor-wait", !busy && result && tone(result.kind))}>
        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
      </button>
    );
  }

  const label = busy ? "正在更新数据…" : result?.kind === "ok" ? "已更新" : result?.kind === "warn" ? "部分失败" : result?.kind === "err" ? "失败" : "更新数据";
  const title = busy ? "正在更新数据…" : result ? `${result.text}（${result.detail}）` : "并行刷新 7 个数据源（强制后端真取）";
  return (
    <button type="button" onClick={() => void run()} disabled={busy}
      aria-busy={busy} title={title}
      className={cn(
        "fr-tap inline-flex min-h-11 items-center gap-1.5 rounded-btn border border-border bg-card px-3 text-xs font-bold transition-colors hover:border-primary/50",
        busy && "cursor-wait opacity-70",
        !busy && result ? tone(result.kind) : "text-muted-foreground",
      )}>
      {busy
        ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  );
}
