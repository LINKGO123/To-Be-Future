/**
 * 资金雷达工作台 · 通用分页器（新闻模块翻页共用）
 * ------------------------------------------------------------
 * DSH 风：上一页 / 页码 / 下一页，蓝主色 + 中性灰 + SVG 图标（ChevronLeft/Right，无 emoji）。
 * - 触达 ≥ 40px（.fr-tap 保证 48px 最小点击区）。
 * - 当前页高亮（bg-primary 白字）；边界禁用（第 1 页禁上一页、末页禁下一页）。
 * - 总页数 ≤ 1 时返回 null，不给短列表塞多余分页器。
 * - 页数 > 7 自动折叠为「1 … 4 5 6 … N」。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** 新闻模块统一每页条数（板块要闻 / 全球要闻 / 个股板块要闻共用） */
export const FR_NEWS_PAGE_SIZE = 10;

/** 按钮基础样式：中性灰描边卡片 + 主色 hover；禁用降透明度 */
const PAGE_BTN =
  "fr-sub fr-tap inline-flex items-center justify-center rounded-btn border font-bold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export interface FrPagerProps {
  /** 当前页（1 起，越界自动夹取到 [1, totalPages]） */
  page: number;
  /** 总页数（≥1） */
  totalPages: number;
  /** 翻页回调（参数为夹取后的目标页） */
  onChange: (page: number) => void;
  /** 可选：条目总数，用于展示「共 N 条」 */
  totalItems?: number;
  className?: string;
}

/** 页码序列：≤7 页全显；否则折叠为 1 … 中段 … N。 */
function pageList(cur: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | "…"> = [1];
  if (cur > 3) out.push("…");
  const lo = Math.max(2, cur - 1);
  const hi = Math.min(total - 1, cur + 1);
  for (let p = lo; p <= hi; p++) out.push(p);
  if (cur < total - 2) out.push("…");
  out.push(total);
  return out;
}

export function FrPager({ page, totalPages, onChange, totalItems, className }: FrPagerProps) {
  if (totalPages <= 1) return null;
  const cur = Math.min(Math.max(1, page), totalPages);
  const go = (p: number) => {
    if (p >= 1 && p <= totalPages && p !== cur) onChange(p);
  };

  return (
    <nav className={cn("mt-3 flex flex-wrap items-center justify-between gap-2", className)} aria-label="分页">
      <span className="fr-sub tabular-nums text-muted-foreground">
        第 {cur} / {totalPages} 页{totalItems != null ? ` · 共 ${totalItems} 条` : ""}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={cur === 1}
          onClick={() => go(cur - 1)}
          aria-label="上一页"
          className={cn(PAGE_BTN, "gap-1.5 border-border bg-card px-3 text-muted-foreground hover:border-primary/50 hover:text-primary")}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          上一页
        </button>

        {pageList(cur, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`dots-${i}`} className="fr-sub px-1 tabular-nums text-muted-foreground" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              aria-current={p === cur ? "page" : undefined}
              className={cn(
                PAGE_BTN,
                p === cur
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary",
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          disabled={cur === totalPages}
          onClick={() => go(cur + 1)}
          aria-label="下一页"
          className={cn(PAGE_BTN, "gap-1.5 border-border bg-card px-3 text-muted-foreground hover:border-primary/50 hover:text-primary")}
        >
          下一页
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
