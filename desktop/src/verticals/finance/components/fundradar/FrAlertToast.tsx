/**
 * 资金雷达工作台 · 异动/炸板提醒弹层（P1 动画 · 组件先做，异动数据源下一批接）
 * ------------------------------------------------------------
 * 通用 toast：顶部右上角弹入（translateY -8px→0 + opacity，200ms ease-out，
 * keyframe frToastIn），自动消失（默认 4.5s，可设 0 关闭自动消失）或手动关闭。
 * 只做 UI + 动画，不含取数 / 异常检测逻辑：哨兵触发时调 useFrToast().push(...) 接入。
 * DSH 风：蓝主色（info）+ 中性灰 + 语义状态色（warning / danger），克制不炫技。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Info, X, type LucideIcon } from "lucide-react";

export type FrAlertLevel = "info" | "warning" | "danger";

export interface FrAlertItem {
  id: string;
  level: FrAlertLevel;
  title: string;
  detail?: string;
  /** 自动消失毫秒数；0 表示不自动消失（需手动关闭）。默认 4500。 */
  autoDismissMs?: number;
  /** 涨跌方向（红涨绿跌）：设置后 detail 按方向着色；不设为中性灰。 */
  tone?: "up" | "down";
}

const LEVEL_META: Record<FrAlertLevel, { Icon: LucideIcon; cls: string }> = {
  info: { Icon: Info, cls: "border-primary/40 text-primary" },
  warning: { Icon: AlertTriangle, cls: "border-warning/40 text-warning" },
  danger: { Icon: AlertCircle, cls: "border-destructive/40 text-destructive" },
};

let toastSeq = 0;
const nextId = () => `fr-toast-${Date.now().toString(36)}-${(toastSeq += 1)}`;

/** 单条提醒：滑入动画 + 自动消失计时 + 手动关闭。 */
export function FrAlertToast({ item, onDismiss }: {
  item: FrAlertItem;
  onDismiss: (id: string) => void;
}) {
  const { Icon, cls } = LEVEL_META[item.level];
  useEffect(() => {
    const ms = item.autoDismissMs ?? 4500;
    if (ms <= 0) return;
    const t = window.setTimeout(() => onDismiss(item.id), ms);
    return () => window.clearTimeout(t);
  }, [item.id, item.autoDismissMs, onDismiss]);
  return (
    <div className={`fr-toast-in fr-glass flex items-start gap-2.5 border px-4 py-3 ${cls}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="fr-body font-bold leading-snug">{item.title}</p>
        {item.detail && (
          <p className={`fr-sub mt-0.5 ${item.tone === "up" ? "fr-up" : item.tone === "down" ? "fr-down" : "text-muted-foreground"}`}>
            {item.detail}
          </p>
        )}
      </div>
      <button type="button" aria-label="关闭提醒" onClick={() => onDismiss(item.id)}
        className="fr-tap -mr-1 -mt-1 shrink-0 rounded-btn p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** 提醒弹层容器：固定右上角，pointer-events 穿透、子项恢复，支持多条例外堆叠。 */
export function FrAlertToastHost({ items, onDismiss }: {
  items: FrAlertItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="fr-toast-viewport" role="region" aria-label="异动提醒" aria-live="polite">
      {items.map((t) => <FrAlertToast key={t.id} item={t} onDismiss={onDismiss} />)}
    </div>
  );
}

/** 提醒队列 Hook：push 一条提醒（返回 id），dismiss 单条关闭，clear 清空。 */
export function useFrToast() {
  const [items, setItems] = useState<FrAlertItem[]>([]);
  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const push = useCallback((t: Omit<FrAlertItem, "id">) => {
    const id = nextId();
    setItems((prev) => [...prev, { ...t, id }]);
    return id;
  }, []);
  const clear = useCallback(() => setItems([]), []);
  return { items, push, dismiss, clear };
}
