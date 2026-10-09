/**
 * 资金雷达工作台 · 菜单搜索弹层（Cmd+K / Ctrl+K）。
 * 复用 fundradarNav 的导航数据（与侧栏同一数据源），关键词过滤 + 键盘选择 + 回车跳转。
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { buildNavSearchIndex, filterNavItems, type NavSearchEntry } from "@/lib/fundradarNav";

export function FrCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const index = useMemo(() => buildNavSearchIndex(), []);
  const results = useMemo(() => filterNavItems(query, index), [query, index]);
  // active 可能因结果缩短越界，取当前结果里的安全项
  const current = results[Math.min(active, Math.max(results.length - 1, 0))];

  // 打开时重置查询并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = (item: NavSearchEntry | undefined) => {
    if (!item) return;
    navigate(item.to);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(current);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]"
      role="dialog" aria-modal="true" aria-label="页面搜索">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="关闭搜索"
        onClick={onClose} tabIndex={-1} />
      <div className="fr-glass relative w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-xl">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="搜索页面（回车跳转）…"
            aria-label="搜索页面"
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(""); setActive(0); inputRef.current?.focus(); }}
              aria-label="清空搜索" className="text-xs text-muted-foreground hover:text-foreground">清空</button>
          )}
        </div>
        <ul className="max-h-[50vh] overflow-auto py-2" role="listbox" aria-label="搜索结果">
          {results.length === 0 && (
            <li className="px-5 py-4 text-sm text-muted-foreground">没有匹配的页面</li>
          )}
          {results.map((item, i) => (
            <li key={item.to} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => go(item)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors ${
                  i === active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                }`}>
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.zone}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-border px-5 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden="true" /> 跳转</span>
          <span>↑↓ 选择</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
