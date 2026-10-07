/**
 * 资金雷达工作台 · 综合评分圆环（P0 动画生动化 · 刀 3）
 * ------------------------------------------------------------
 * 把报告页 0-100 综合评分从纯数字改成 SVG 环形进度条：
 * - 页面加载（挂载）时从 0 填充到分值，约 400ms ease-out，一次；
 * - 圆环颜色按评分分级：≥60 红（偏多）、40-59 灰（中性）、<40 绿（偏空），
 *   复用 A 股红涨绿跌 token（--color-up/--color-flat/--color-down）；
 * - 中间大数字同 useCountUp 平滑滚动。
 * - SVG circle stroke-dasharray/stroke-dashoffset + CSS transition，不引库。
 * - reduced-motion：CSS 关闭 transition + JS matchMedia 立即置位。
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCountUp } from "./FrAnimatedNumber";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 圆环颜色分级：≥60 红 / 40-59 灰 / <40 绿（与 A 股红涨绿跌 token 一致）。 */
export function frScoreRingColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  return s >= 60 ? "var(--color-up)" : s < 40 ? "var(--color-down)" : "var(--color-flat)";
}

export function FrScoreRing({ score, className }: { score: number; className?: string }) {
  // viewBox 固定 100×100，渲染尺寸随字号档 --fs-num 缩放（尊重四档字号系统）
  const r = 44;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const color = frScoreRingColor(clamped);
  // 初始 strokeDashoffset = 周长（空环），挂载后过渡到目标偏移（CSS transition 400ms）
  const [offset, setOffset] = useState(c);
  const display = useCountUp(clamped, 400);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setOffset(c - (clamped / 100) * c);
      return;
    }
    // 双 rAF：先保证空环被绘制一帧，再切到目标偏移，确保 CSS transition 从 0 开始
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setOffset(c - (clamped / 100) * c));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [c, clamped]);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: "calc(var(--fs-num) * 2.8)", height: "calc(var(--fs-num) * 2.8)" }}
    >
      <svg
        className="fr-score-ring h-full w-full"
        viewBox="0 0 100 100"
        role="img"
        aria-label={`综合评分 ${Math.round(clamped)} 分（满分 100）`}
      >
        {/* 底轨 */}
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        {/* 进度环：从顶部起顺时针填充 */}
        <circle
          className="fr-ring-progress"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="fr-num" style={{ fontSize: "calc(var(--fs-num) * 0.95)", lineHeight: 1 }}>
          {Math.round(display ?? 0)}
        </span>
        <span className="fr-sub font-bold text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}
