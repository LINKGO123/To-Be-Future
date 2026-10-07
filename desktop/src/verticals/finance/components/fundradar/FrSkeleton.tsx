/**
 * 资金雷达工作台 · 骨架屏组件（刀6）
 * ------------------------------------------------------------
 * 解决「刷新数据时无动画反馈，用户误以为卡住、反复点击」：数据加载/刷新
 * 期间用 shadcn 风格骨架屏（灰色圆角块 + animate-pulse 脉冲）按内容形状占位，
 * 替代原先的「正在取数…」小字；内容到位后骨架卸载、页面整体 fr-fade-in 淡入。
 *
 * - 颜色走 CSS 变量 --fr-skeleton / --fr-skeleton-strong（fundradar-theme.css 按
 *   fr-elder-page 浅色 / html.fr-elder-dark 深色 / fr-screen-dark 跟随全局深浅分别定义）。
 * - 高度跟随字号档 --fs-*（浅色常用页四档；深色大屏固定 :root 紧凑档），
 *   与真实内容近似，避免加载完成后布局跳动过大。
 * - 全部用 Tailwind 自带 animate-pulse / animate-spin，不新增 npm 依赖。
 */
import type { CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** 通用骨架块：任意宽高圆角块（宽高走 className / style），底色走主题变量 */
export function FrSkeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={cn("fr-skeleton animate-pulse motion-reduce:animate-none rounded-lg", className)}
      style={{ backgroundColor: "var(--fr-skeleton)", ...style }}
    />
  );
}

/** 文字行骨架：高度随字号档 --fs-sub（约占一行辅助文字），宽度走 className */
export function FrSkeletonLine({ className }: { className?: string }) {
  return (
    <FrSkeleton
      className={cn("rounded-md", className)}
      style={{ height: "calc(var(--fs-sub) * 1.1)" }}
    />
  );
}

/** 卡片骨架：标题条 + 若干行文字条（占位卡片正文） */
export function FrSkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-busy="true">
      <span className="sr-only">正在加载…</span>
      <FrSkeleton className="w-2/5 rounded-md" style={{ height: "calc(var(--fs-title) * 0.9)" }} />
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <FrSkeletonLine key={i} className={i === lines - 1 ? "w-2/3" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

/** 图表骨架：大矩形占位 + 可选居中转圈图标 */
export function FrSkeletonChart({
  height = 320,
  className,
  spinner = true,
}: {
  height?: number;
  className?: string;
  spinner?: boolean;
}) {
  return (
    <div
      className={cn("relative flex items-center justify-center rounded-lg", className)}
      style={{ backgroundColor: "var(--fr-skeleton)", height }}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">图表加载中…</span>
      {spinner && (
        <LoaderCircle
          className="h-8 w-8 animate-spin"
          style={{ color: "var(--fr-skeleton-strong)" }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** 列表行骨架：左侧圆头像 + 两行文字 + 右侧短块 */
export function FrSkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)} aria-hidden="true">
      <FrSkeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <FrSkeletonLine className="w-1/3" />
        <FrSkeletonLine className="w-2/3" />
      </div>
      <FrSkeleton className="h-6 w-16 shrink-0 rounded-md" />
    </div>
  );
}

/** 列表骨架：N 行列表（行间分隔线随主题 --border） */
export function FrSkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="sr-only">列表加载中…</span>
      {Array.from({ length: rows }, (_, i) => (
        <FrSkeletonRow key={i} className="border-b border-border last:border-b-0" />
      ))}
    </div>
  );
}
