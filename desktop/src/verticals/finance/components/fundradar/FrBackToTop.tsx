/**
 * 资金雷达工作台 · 回顶部悬浮按钮。
 * 监听 main 滚动容器（#workspace-main），滚过一段距离后出现，点击平滑回顶。
 */
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

const SHOW_AFTER = 480;

export function FrBackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const main = document.getElementById("workspace-main");
    if (!main) return;
    const onScroll = () => setShow(main.scrollTop > SHOW_AFTER);
    main.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button type="button"
      onClick={() => document.getElementById("workspace-main")?.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部" title="回到顶部"
      className="fr-icon-btn fixed bottom-6 right-6 z-40 rounded-full border border-border bg-card/90 shadow-lg backdrop-blur">
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}
