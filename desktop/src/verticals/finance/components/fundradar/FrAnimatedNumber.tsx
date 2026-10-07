/**
 * 资金雷达工作台 · 数字动效原语（P0 动画生动化 · 刀 1/2/4）
 * ------------------------------------------------------------
 * 1. useCountUp：requestAnimationFrame 数字滚动（旧值→新值，约 300ms ease-out cubic），
 *    尊重 prefers-reduced-motion（降级为立即置位，不滚动）。
 * 2. FrAnimatedNumber：<span> 包装 useCountUp，数字变化时平滑滚动（内容到位/更新的感知）。
 * 3. FrChangePop：涨/跌数字在两个非空值之间变化时，重挂 key 触发 frPopUp/frPopDown 微跳（150ms）。
 * 4. frStaggerDelay：列表错峰滑入的 animationDelay 内联样式（每项 +60ms）。
 *
 * 全部无 npm 依赖；reduced-motion 由 CSS media query 兜底，JS 端再显式 matchMedia 降级。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** ease-out cubic（0 起步快、末尾缓停，符合「生动但不慢」） */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 数字滚动 Hook：从旧值（或 0）平滑滚到新值，约 duration ms ease-out；支持小数。 */
export function useCountUp(value: number | null | undefined, duration = 300): number | null {
  // 初始为 null：首帧渲染占位，挂载后从 0 滚到目标值（「内容来了」的感知）
  const [display, setDisplay] = useState<number | null>(null);
  // 记录「当前已滚到」的值，中断/连续更新时从中间值续滚，避免跳变
  const displayRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const target = value ?? null;
    const from = displayRef.current ?? 0;

    if (target === null || prefersReducedMotion() || from === target) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const cur = from + (target - from) * easeOutCubic(t);
      displayRef.current = cur;
      setDisplay(cur);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        displayRef.current = target;
        setDisplay(target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return display;
}

/** 数字滚动组件：value 变化时从旧值平滑滚到新值；null 显示 placeholder。 */
export function FrAnimatedNumber({
  value,
  format,
  className,
  duration = 300,
  placeholder = "—",
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  className?: string;
  duration?: number;
  placeholder?: string;
}) {
  const display = useCountUp(value, duration);
  return (
    <span className={cn("tabular-nums", className)}>
      {value == null ? placeholder : format(display ?? 0)}
    </span>
  );
}

/** 涨跌微跳：两个非空值之间变化时重挂 key，触发 frPopUp（涨）/frPopDown（跌）一次；
 *  首次挂载、置空、值不变都不跳，避免列表加载时集体跳动。 */
export function FrChangePop({
  value,
  className,
  children,
}: {
  value: number | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const prevRef = useRef<number | null | undefined>(value);
  const [tick, setTick] = useState(0);
  const dir = value == null || value === 0 ? "" : value > 0 ? "up" : "down";

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev == null || value == null || prev === value) return;
    setTick((t) => t + 1);
  }, [value]);

  return (
    <span
      key={tick}
      className={cn("inline-block", tick > 0 && dir ? `fr-pop-${dir}` : undefined, className)}
    >
      {children}
    </span>
  );
}

/** 列表错峰滑入：第 index 项延迟 index*60ms（配合 .fr-stagger-in 类使用）。 */
export function frStaggerDelay(index: number, stepMs = 60): CSSProperties {
  return { animationDelay: `${index * stepMs}ms` };
}
