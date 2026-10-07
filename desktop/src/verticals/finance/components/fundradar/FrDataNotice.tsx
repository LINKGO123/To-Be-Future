/**
 * 资金雷达工作台 · 数据可用性提示条（刀5）
 * 取数失败 / 部分或全部降级到示例数据时，在页面顶部说明并提供重试。
 * 加载态已改由骨架屏（FrSkeleton）承接，本组件在 loading 时返回 null，
 * 只负责「● 数据暂不可用，显示示例」+「点击重试」按钮 —— 取数失败绝不静默。
 */
import { useState } from "react";

export function FrDataNotice({ loading, missing, onRetry }: {
  loading: boolean;
  /** 已降级为示例的块名；整页降级时传 ["全部数据"] */
  missing: string[];
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // 加载态交给骨架屏（FrSkeleton），本组件只负责「取数失败/降级到示例」的提示
  if (loading || missing.length === 0) return null;
  return (
    <div
      data-fr-data-notice
      role="status"
      className="fr-body mb-4 flex flex-wrap items-center gap-3 rounded-btn border border-warning/40 bg-warning/10 px-4 py-2.5"
    >
      <span className="font-bold">
        {`● 数据暂不可用，显示示例${missing.length > 0 ? `（${missing.join("、")}）` : ""}`}
      </span>
      {!loading && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onRetry();
            window.setTimeout(() => setBusy(false), 3000);
          }}
          className="fr-sub fr-tap rounded-btn border border-warning/60 bg-card px-3 py-1 font-bold disabled:opacity-50"
        >
          点击重试
        </button>
      )}
    </div>
  );
}
