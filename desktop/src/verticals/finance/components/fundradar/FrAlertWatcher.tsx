/**
 * 资金雷达工作台 · 异动提醒接入（刀7）
 * ------------------------------------------------------------
 * 连接异动哨兵数据源（lib/fundradarAlerts.checkAnomalies）与提醒弹层
 * （FrAlertToast）：监听 fr-data-refreshed（一键更新 / 盘中自动刷新完成后
 * 派发），检出异常后映射为 toast 项推送。挂载在 Layout，全局生效。
 *
 * - 去重 / 午间免打扰（12:30–13:30）在 checkAnomalies 内部处理（localStorage
 *   记当天已提醒，单股单类日限 1 次），本组件只把返回的**新**异常推入弹层。
 * - 映射口径：持仓异动 → warning（普通）/ danger（strong，≥9%），detail 按
 *   涨跌方向红涨绿跌着色；主线切换 → info（蓝，中性信息）。
 * - 硬约束：不改 calc/datasources/orchestrator；不新增依赖；不碰密钥。
 */
import { useEffect } from "react";
import { FR_DATA_REFRESHED } from "@/lib/fundradarData";
import { checkAnomalies, type FrAnomaly } from "@/lib/fundradarAlerts";
import { FrAlertToastHost, useFrToast, type FrAlertItem } from "@/components/fundradar/FrAlertToast";

/** 异动 → toast 项（不含 id，由 useFrToast.push 生成）。 */
function toToastItem(a: FrAnomaly): Omit<FrAlertItem, "id"> {
  if (a.kind === "mainline_switch") {
    return { level: "info", title: "主线切换", detail: a.detail };
  }
  return {
    level: a.level === "strong" ? "danger" : "warning",
    title: "持仓异动",
    detail: a.detail,
    tone: a.dir,
  };
}

/** 全局异动提醒接入点：挂一次，监听刷新事件，把新异常推入右上角弹层。 */
export function FrAlertWatcher() {
  const { items, push, dismiss } = useFrToast();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const anomalies = await checkAnomalies();
      if (cancelled) return;
      for (const a of anomalies) push(toToastItem(a));
    };
    const onRefreshed = () => void run();
    window.addEventListener(FR_DATA_REFRESHED, onRefreshed);
    return () => {
      cancelled = true;
      window.removeEventListener(FR_DATA_REFRESHED, onRefreshed);
    };
    // push / dismiss 由 useFrToast 内部 useCallback([]) 稳定，此处空依赖安全
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <FrAlertToastHost items={items} onDismiss={dismiss} />;
}
