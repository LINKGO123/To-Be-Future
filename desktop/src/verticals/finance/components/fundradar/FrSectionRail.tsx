/**
 * 资金雷达工作台 · 右侧章节导轨（形态 C）。
 * 页面右侧固定的竖线轨道：蓝色填充线随滚动「变长」（滚到哪、线走到哪），
 * 轨道上按区块分布圆点节点，当前区块节点高亮，顶部常显当前区块名，点击节点跳转。
 * 大屏（xl+）显示；小屏用顶部横向锚点条 FrSectionNav（xl:hidden）。
 */
import { useScrollSpy } from "@/hooks/useScrollSpy";
import type { FrSection } from "./FrSectionNav";

export function FrSectionRail({ sections }: { sections: FrSection[] }) {
  const active = useScrollSpy(sections.map((s) => s.id));
  const activeIdx = Math.max(0, sections.findIndex((s) => s.id === active));
  const activeLabel = sections[activeIdx]?.label ?? "";
  // 填充线高度：从顶部到当前节点（节点均匀分布，按下标比例近似）
  const fillPct = sections.length > 1 ? (activeIdx / (sections.length - 1)) * 100 : 100;

  return (
    <nav aria-label="页内章节"
      className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center xl:flex">
      {/* 当前区块名（常显） */}
      <span className="mb-3 max-w-[8rem] truncate rounded-full border border-border bg-card/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
        {activeLabel}
      </span>
      {/* 轨道 + 填充线 + 节点 */}
      <div className="relative flex flex-col items-center">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" aria-hidden="true" />
        <div className="absolute left-1/2 top-0 w-px -translate-x-1/2 bg-primary transition-[height] duration-200"
          style={{ height: `${fillPct}%` }} aria-hidden="true" />
        <div className="relative flex flex-col items-center gap-4 py-1">
          {sections.map((s, i) => (
            <button key={s.id} type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              aria-label={s.label} title={s.label}
              aria-current={i === activeIdx ? "true" : undefined}
              className={`shrink-0 rounded-full transition-all duration-200 ${
                i === activeIdx
                  ? "h-2.5 w-2.5 bg-primary ring-4 ring-primary/20"
                  : "h-1.5 w-1.5 bg-muted-foreground/40 hover:scale-125 hover:bg-muted-foreground"
              }`} />
          ))}
        </div>
      </div>
    </nav>
  );
}
