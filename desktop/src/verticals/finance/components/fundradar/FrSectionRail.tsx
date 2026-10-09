/**
 * 资金雷达工作台 · 右侧章节导轨（发光进度形态）。
 * 页面右侧固定竖线轨道：渐变发光填充线随滚动「变长」，顶端有游标光点；
 * 轨道上按区块分布节点，当前节点渐变发光 + 脉冲光环 + 柔光呼吸，
 * 顶部常显当前区块名（渐变标签，切换动画）；hover 节点显示章节气泡；
 * 整体进场动画从右侧滑入。大屏（xl+）显示；小屏用顶部横向锚点条。
 */
import { useScrollSpy } from "@/hooks/useScrollSpy";
import type { FrSection } from "./FrSectionNav";

export function FrSectionRail({ sections }: { sections: FrSection[] }) {
  const active = useScrollSpy(sections.map((s) => s.id));
  const activeIdx = Math.max(0, sections.findIndex((s) => s.id === active));
  const activeLabel = sections[activeIdx]?.label ?? "";
  // 填充线与游标位置：从顶部到当前节点（节点均匀分布，按下标比例近似）
  const fillPct = sections.length > 1 ? (activeIdx / (sections.length - 1)) * 100 : 100;

  return (
    <nav aria-label="页内章节"
      className="fr-rail-enter fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center xl:flex">
      {/* 当前区块名（渐变发光标签，切换时上滑淡入） */}
      <span key={activeLabel} aria-live="polite"
        className="fr-rail-label mb-4 max-w-[9rem] truncate rounded-full border border-primary/40
          bg-gradient-to-r from-blue-500/25 via-blue-500/10 to-cyan-400/25 px-3 py-1.5
          text-xs font-semibold text-primary shadow-[0_0_14px_hsl(var(--primary)/0.35)]">
        {activeLabel}
      </span>

      {/* 轨道 + 渐变填充 + 游标光点 + 节点 */}
      <div className="relative flex flex-col items-center">
        {/* 背景轨道（暗线） */}
        <div aria-hidden="true"
          className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-white/10" />
        {/* 渐变发光填充线（随滚动变长） */}
        <div aria-hidden="true"
          className="absolute left-1/2 top-0 w-[2px] -translate-x-1/2 rounded-full
            bg-gradient-to-b from-cyan-300 via-blue-400 to-blue-600
            shadow-[0_0_10px_rgba(59,130,246,0.85)] transition-[height] duration-300 ease-out"
          style={{ height: `${fillPct}%` }} />
        {/* 游标光点（填充线顶端，随滚动滑动） */}
        <div aria-hidden="true"
          className="absolute left-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full
            bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.95),0_0_24px_rgba(103,232,249,0.5)]
            transition-[top] duration-300 ease-out"
          style={{ top: `${fillPct}%` }} />

        {/* 节点（区块圆点） */}
        <div className="relative flex flex-col items-center gap-5 py-1">
          {sections.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button key={s.id} type="button" aria-label={s.label} title={s.label}
                aria-current={isActive ? "true" : undefined}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="group relative flex shrink-0 items-center justify-center">
                {isActive ? (
                  <>
                    {/* 脉冲光环（雷达波） */}
                    <span aria-hidden="true"
                      className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-primary/40" />
                    {/* 发光当前节点（柔光呼吸） */}
                    <span aria-hidden="true"
                      className="fr-rail-active-dot relative block h-3 w-3 rounded-full
                        bg-gradient-to-br from-cyan-300 via-blue-400 to-blue-600" />
                  </>
                ) : (
                  <span aria-hidden="true"
                    className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/40
                      transition-all duration-200 group-hover:scale-150 group-hover:bg-primary/80" />
                )}
                {/* hover 章节名气泡（向页面内侧展开） */}
                <span aria-hidden="true"
                  className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2
                    whitespace-nowrap rounded-md border border-border bg-card/95 px-2.5 py-1
                    text-xs text-foreground opacity-0 shadow-lg backdrop-blur
                    transition-all duration-200 group-hover:opacity-100">
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
