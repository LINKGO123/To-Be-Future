/**
 * 资金雷达工作台 · 出处减弱（L4 信息层级）
 * ------------------------------------------------------------
 * 把「出处 / 数据源 / 日期 / 口径」这类元信息从核心数据同排收到底部：
 * - 默认折叠，只显示一行「数据来源」小字（fr-sub + text-muted-foreground）；
 * - 点击展开列出详细出处，每条一行、前置小圆点「•」、行距拉开；
 * - summary 点击区 ≥48px（fr-tap），chevron 随展开旋转。
 */
import { ChevronDown } from "lucide-react";

import { frEndpointCn } from "@/lib/fundradarData";

export function FrSourceFooter({ items, className = "" }: { items: readonly string[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <details className={`fr-sub group mt-3 rounded-btn border border-border/70 bg-muted/30 text-muted-foreground ${className}`}>
      <summary className="fr-tap flex cursor-pointer select-none items-center gap-2 rounded-btn px-3 py-2 font-bold text-muted-foreground hover:text-foreground">
        <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
        数据来源
      </summary>
      <ul className="space-y-1.5 px-4 pb-3 leading-relaxed">
        {items.map((t, i) => (
          <li key={`${i}-${t}`} className="flex gap-2">
            <span className="shrink-0" aria-hidden="true">•</span>
            <span>{frEndpointCn(t)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
