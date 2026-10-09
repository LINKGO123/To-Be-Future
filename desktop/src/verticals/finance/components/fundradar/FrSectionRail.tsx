/**
 * 资金雷达工作台 · 右侧章节导轨（发光进度形态）。
 * 页面右侧固定竖线轨道：渐变发光填充线随滚动「变长」，顶端有游标光点；
 * 轨道上按区块分布节点，当前节点渐变发光 + 脉冲光环 + 柔光呼吸；
 * 顶部常显当前区块名（渐变标签，切换动画）；hover 节点显示章节气泡。
 *
 * 对齐校准：节点按钮统一 16px 高度、gap-4、py-2，节点中心位置用精确公式
 * （非下标线性近似），填充线高度与游标 top 都按当前节点中心的真实像素比例计算，
 * 保证「线走到哪、光点就正好盖在当前节点上」。
 * 大屏（xl+）显示；小屏用顶部横向锚点条。
 */
import { useScrollSpy } from "@/hooks/useScrollSpy";
import type { FrSection } from "./FrSectionNav";

/* 布局常量（与下方 className 一一对应，改样式必须同步这里） */
const DOT_H = 16; // 节点按钮高度 h-4
const GAP = 16;   // 节点间距 gap-4
const PAD = 8;    // 列表上下内边距 py-2

export function FrSectionRail({ sections }: { sections: FrSection[] }) {
  const active = useScrollSpy(sections.map((s) => s.id));
  const activeIdx = Math.max(0, sections.findIndex((s) => s.id === active));
  const activeLabel = sections[activeIdx]?.label ?? "";

  // 节点 i 中心相对轨道顶部的精确像素位置；总高度按统一布局算
  const n = sections.length;
  const totalH = 2 * PAD + n * DOT_H + (n - 1) * GAP;
  const centerY = (i: number) => PAD + i * (DOT_H + GAP) + DOT_H / 2;
  const fillPct = totalH > 0 ? (centerY(activeIdx) / totalH) * 100 : 100;

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
        {/* 背景轨道（暗线，高度=节点列表总高） */}
        <div aria-hidden="true"
          className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-white/10" />
        {/* 渐变发光填充线（精确到当前节点中心） */}
        <div aria-hidden="true"
          className="absolute left-1/2 top-0 w-[2px] -translate-x-1/2 rounded-full
            bg-gradient-to-b from-cyan-300 via-blue-400 to-blue-600
            shadow-[0_0_10px_rgba(59,130,246,0.85)] transition-[height] duration-300 ease-out"
          style={{ height: `${fillPct}%` }} />
        {/* 游标光点（填充线顶端 = 当前节点中心，精确对齐） */}
        <div aria-hidden="true"
          className="absolute left-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full
            bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95),0_0_20px_rgba(103,232,249,0.5)]
            transition-[top] duration-300 ease-out"
          style={{ top: `${fillPct}%` }} />

        {/* 节点（统一 16px 按钮：普通=6px 灰点居中，当前=脉冲环+10px 发光点居中） */}
        <div className="relative flex flex-col items-center gap-4 py-2">
          {sections.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <button key={s.id} type="button" aria-label={s.label} title={s.label}
                aria-current={isActive ? "true" : undefined}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="group relative flex h-4 w-4 shrink-0 items-center justify-center">
                {isActive ? (
                  <>
                    {/* 脉冲光环（雷达波，16px 满容器） */}
                    <span aria-hidden="true"
                      className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-primary/40" />
                    {/* 发光当前节点（10px，居中） */}
                    <span aria-hidden="true"
                      className="fr-rail-active-dot relative block h-2.5 w-2.5 rounded-full
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
