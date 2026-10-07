/**
 * 资金雷达工作台 · 数据状态指示器（首页总览区）+ 顶栏自动刷新徽标
 * ------------------------------------------------------------
 * 改造 1：首页总览区大按钮「🔄 一键更新数据」退化为「状态显示 + 点击刷新」——
 *   - FrDataStatus：● 数据已更新至 HH:MM + 下次自动刷新倒计时 + 刷新小图标（点击仍触发 updateAllFrData）。
 *   - FrAutoRefreshBadge：顶栏紧凑徽标（● 时间 + 倒计时，无刷新按钮；侧栏是唯一主更新入口）。
 * 两处状态都读同一份 fr-last-refresh（由 updateAllFrData / 自动刷新成功时写入），
 * 倒计时读 fr-auto-refresh-status 事件（AutoRefresh 模块每秒派发）。
 */
import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { updateAllFrData } from "@/lib/fundradarUpdate";
import {
  frCountdownLabel, frLastRefreshLabel, useAutoRefreshStatus,
} from "@/lib/fundradarAutoRefresh";

/** 首页总览区：状态指示器 + 点击刷新（原「一键更新数据」大按钮退化为状态显示） */
export function FrDataStatus() {
  const status = useAutoRefreshStatus();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 与侧栏入口同一 updateAllFrData，无逻辑冲突
      await updateAllFrData();
    } finally {
      setBusy(false);
    }
  };

  const countdown = frCountdownLabel(status.nextTickAt, status.enabled);

  return (
    <div className="flex items-center gap-2.5" role="status" aria-live="polite">
      <span className="fr-body flex items-center gap-2 font-bold text-muted-foreground">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
        {status.lastRefreshAt ? `数据已更新至 ${frLastRefreshLabel(status.lastRefreshAt)}` : "数据尚未更新"}
      </span>
      {countdown && <span className="fr-sub text-muted-foreground">下次自动刷新 {countdown}</span>}
      <button type="button" onClick={() => void run()} disabled={busy} aria-label="立即更新数据"
        title={busy ? "正在更新数据…" : "立即更新数据"}
        className="fr-tap rounded-btn p-2 text-primary hover:bg-muted disabled:cursor-wait disabled:opacity-60">
        {busy
          ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
          : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** 顶栏紧凑徽标：● 数据更新时间 + 下次自动刷新倒计时（无刷新按钮） */
export function FrAutoRefreshBadge() {
  const status = useAutoRefreshStatus();
  const countdown = frCountdownLabel(status.nextTickAt, status.enabled);
  return (
    <span className="fr-sub hidden items-center gap-1.5 text-muted-foreground md:inline-flex" role="status" aria-live="polite">
      <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
      {status.lastRefreshAt ? `数据 ${frLastRefreshLabel(status.lastRefreshAt)}` : "数据已就绪"}
      {countdown ? <span>· 自动刷新 {countdown}</span> : <span>· 自动刷新已关</span>}
    </span>
  );
}
