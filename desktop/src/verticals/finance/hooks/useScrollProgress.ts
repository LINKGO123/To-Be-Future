import { useEffect, useState } from "react";

/**
 * main 滚动容器（#workspace-main）的滚动进度 0–1。
 * 内容不足一屏（不可滚动）返回 null；resetKey 变化（如路由切换）时重新计算。
 */
export function useScrollProgress(resetKey: string): number | null {
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const main = document.getElementById("workspace-main");
    if (!main) return;
    const update = () => {
      const max = main.scrollHeight - main.clientHeight;
      setProgress(max > 0 ? main.scrollTop / max : null);
    };
    update();
    main.addEventListener("scroll", update, { passive: true });
    // 内容异步加载会改变 scrollHeight，用 ResizeObserver 兜底刷新
    const ro = new ResizeObserver(update);
    ro.observe(main);
    return () => {
      main.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [resetKey]);

  return progress;
}
