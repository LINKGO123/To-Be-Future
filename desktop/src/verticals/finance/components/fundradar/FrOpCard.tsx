/**
 * 资金雷达工作台 · 操作确认卡（Agent 操作前端模块）
 * ------------------------------------------------------------------
 * 把 Agent 输出的 [OP] 结构化指令渲染成「操作确认卡」：中文描述（要做什么）
 * + 「确认执行 / 取消」按钮。**先确认再执行**：只有用户点「确认执行」才调用
 * executeOp（写 localStorage）；成功显示绿色结果、失败显示错误、取消标注「已取消」。
 *
 * 操作里只有 code 时，前端用 lookupStockName 兜底查名（先查持仓档案、再走
 * loadStockQuote 行情端点），查不到回退代码；查到的名称回填到描述与写库名称。
 * 复用 PlanCard 的样式基调（fr-tool-card），DSH 风、无 emoji、SVG 图标（lucide）。
 */
import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Play, Zap } from "lucide-react";

import { describeOp, executeOp, OP_ACTION_LABELS, lookupStockName, type FrOp } from "@/lib/fundradarOps";

type OpStatus = "idle" | "done" | "error" | "cancelled";

export function OpCard({ op }: { op: FrOp }) {
  const [resolvedName, setResolvedName] = useState("");
  const [status, setStatus] = useState<OpStatus>("idle");
  const [msg, setMsg] = useState("");

  // 操作里只有 code、没给 name 时：前端兜底查名（仅作展示与写库名称，异步补一次）
  useEffect(() => {
    const code = op.params.code;
    if (!code || op.params.name) return;
    let alive = true;
    void lookupStockName(code).then((n) => {
      if (alive && n && n !== code) setResolvedName(n);
    });
    return () => {
      alive = false;
    };
  }, [op.params.code, op.params.name]);

  const label = OP_ACTION_LABELS[op.action] ?? "操作";
  const desc = describeOp(op, resolvedName || undefined);

  const confirm = () => {
    const res = executeOp(op, resolvedName || undefined);
    setStatus(res.ok ? "done" : "error");
    setMsg(res.message);
  };
  const cancel = () => setStatus("cancelled");

  return (
    <div className="fr-tool-card mt-1.5">
      <div className="fr-sub flex items-center gap-1.5 px-2.5 py-2 font-bold text-primary">
        <Zap className="h-4 w-4" aria-hidden="true" /> 操作确认 · {label}
      </div>
      <div className="px-2.5 pb-2.5">
        <div className="rounded-btn border border-border/60 bg-background/40 px-2.5 py-2">
          <p className="fr-sub font-bold">{desc}</p>
        </div>

        {msg && (
          <p role={status === "error" ? "alert" : "status"}
            className={`fr-sub mt-1.5 ${status === "error" ? "text-destructive" : status === "done" ? "text-success" : "text-muted-foreground"}`}>
            {msg}
          </p>
        )}

        {status === "idle" && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={confirm}
              className="fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-primary/40 bg-primary-subtle-strong px-3 py-1.5 font-bold text-primary hover:bg-primary-200">
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> 确认执行
            </button>
            <button type="button" onClick={cancel}
              className="fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border px-3 py-1.5 font-bold text-muted-foreground hover:border-primary/40 hover:text-primary">
              <Ban className="h-3.5 w-3.5" aria-hidden="true" /> 取消
            </button>
          </div>
        )}

        {status === "done" && (
          <p className="fr-sub mt-2 inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> 已完成
          </p>
        )}

        {status === "cancelled" && (
          <p className="fr-sub mt-2 text-muted-foreground">已取消，未执行。</p>
        )}
      </div>
    </div>
  );
}
