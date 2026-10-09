/**
 * 资金雷达工作台 · 页内锚点导航（长页面顶部横向 chip 条）。
 * 滚动时当前区块高亮（useScrollSpy），点击平滑滚动到对应区块。
 * 小屏使用；大屏（xl+）用右侧章节导轨 FrSectionRail 替代（xl:hidden）。
 * 只在多区块长页面使用（每日复盘 / 个股报告 / 研报），短页面不加。
 */
import { useScrollSpy } from "@/hooks/useScrollSpy";

export interface FrSection {
  id: string;
  label: string;
}

export function FrSectionNav({ sections }: { sections: FrSection[] }) {
  const active = useScrollSpy(sections.map((s) => s.id));
  return (
    <nav aria-label="页内导航"
      className="sticky top-0 z-20 -mx-1 mb-3 border-b border-border bg-background/95 px-1 py-2 backdrop-blur xl:hidden">
      <div className="flex gap-2 overflow-x-auto">
        {sections.map((s) => (
          <button key={s.id} type="button"
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            aria-current={active === s.id ? "true" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs transition-colors ${
              active === s.id
                ? "bg-primary font-semibold text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}>
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
