/**
 * 资金雷达工作台 · 顶栏面包屑下拉。
 * 点击当前页名弹出同级页面列表（常用区 + 进阶区一级页面），点击直达；
 * 与侧栏共用 fundradarNav 数据源。点击外部或再次点击关闭。
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { NAV_ADV, NAV_CORE, type NavItem } from "@/lib/fundradarNav";
import { cn } from "@/lib/utils";

function BreadcrumbItem({ item, active, onGo }: { item: NavItem; active: boolean; onGo: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onGo}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted/60",
      )}>
      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}

export function FrBreadcrumbMenu({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="menu" aria-label="切换页面"
        className="flex max-w-full items-center gap-1 rounded-btn px-2 py-1 font-medium hover:bg-muted/60">
        <strong className="truncate">{current}</strong>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="页面列表"
          className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-60 overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">常用区域</p>
          {NAV_CORE.filter((n) => n.to !== "/").map((n) => (
            <BreadcrumbItem key={n.to} item={n} active={pathname === n.to} onGo={() => go(n.to)} />
          ))}
          <p className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">进阶研究区</p>
          {NAV_ADV.map((n) => (
            <BreadcrumbItem key={n.to} item={n} active={pathname === n.to} onGo={() => go(n.to)} />
          ))}
        </div>
      )}
    </div>
  );
}
