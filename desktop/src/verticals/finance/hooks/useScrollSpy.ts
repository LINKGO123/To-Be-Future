import { useEffect, useState } from "react";

/**
 * 页内区块滚动高亮：IntersectionObserver 监听区块 id，返回当前「进入视口靠上位置」的区块 id。
 * 用 rootMargin 在视口顶部留一条检测带（15%–25%），滚动到该位置的区块才算活跃；
 * 不依赖滚动事件节流，性能无感。
 */
export function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join("|");

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // 用 join 后的字符串做依赖：页面里传字面量数组时不会每次渲染重建 observer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}
