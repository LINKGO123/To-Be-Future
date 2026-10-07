/**
 * 资金雷达工作台 · 自选清单（评分榜候选池用，与持仓分开）
 * ------------------------------------------------------------
 * 自选与持仓分离：持仓走 lib/fundradarPortfolio.ts（fr-holdings，成本/数量），
 * 自选走本文件 localStorage `fr-watchlist`（只存 code + name，无成本数量）。
 * 增删后 saveWatchlist 派发 window 自定义事件 fr-watchlist-changed，
 * 评分榜页用 useWatchlist() 订阅，增删后同步刷新。
 *
 * 注意：本文件是评分榜候选池的「自选」实现（手动输代码加），与进阶区的
 * 台账自选（lib/watchlist.ts，backend ledger）是两套、互不影响。
 * 字段口径：
 *   code  6 位 A 股代码
 *   name  名称（行情端点查不到时手填/由评分榜回填）
 */
import { useEffect, useState } from "react";

import { storageGet, storageSet } from "./storage";

export interface FrWatchItem {
  code: string;
  name: string;
}

/** 自选清单的 localStorage 键 */
export const FR_WATCHLIST_KEY = "fr-watchlist";
/** 自选增删改后的 window 自定义事件名 */
export const FR_WATCHLIST_CHANGED = "fr-watchlist-changed";

/** 规范化一条自选（过滤脏数据；code 必须是 6 位数字）。 */
function normalize(item: unknown): FrWatchItem | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const code = String(o.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(o.name ?? "").trim();
  return { code, name: name || code };
}

/** 读自选：localStorage `fr-watchlist`；无/损坏 → 空列表（自选默认空，不回退任何硬编码）。 */
export function loadWatchlist(): FrWatchItem[] {
  const raw = storageGet(FR_WATCHLIST_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((w): w is FrWatchItem => w !== null);
  } catch {
    return [];
  }
}

/** 写自选并广播 fr-watchlist-changed，让评分榜页同步刷新。 */
export function saveWatchlist(list: FrWatchItem[]): void {
  storageSet(FR_WATCHLIST_KEY, JSON.stringify(list));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FR_WATCHLIST_CHANGED));
  }
}

/** 加一只自选（按 code 去重；已存在则忽略，返回是否实际新增）。 */
export function addWatchItem(code: string, name: string): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c)) return false;
  const list = loadWatchlist();
  if (list.some((w) => w.code === c)) return false;
  saveWatchlist([...list, { code: c, name: name.trim() || c }]);
  return true;
}

/** 删一只自选（不存在则忽略）。 */
export function removeWatchItem(code: string): void {
  saveWatchlist(loadWatchlist().filter((w) => w.code !== code));
}

/** 当前自选代码列表（批量评分取数用）。 */
export function watchlistCodes(): string[] {
  return loadWatchlist().map((w) => w.code);
}

/**
 * 订阅 fr-watchlist-changed：返回当前自选清单，增删后自动重渲染。
 * 评分榜页用本 Hook 读清单，保证全局生效。
 */
export function useWatchlist(): FrWatchItem[] {
  const [list, setList] = useState<FrWatchItem[]>(() => loadWatchlist());
  useEffect(() => {
    const onChange = () => setList(loadWatchlist());
    window.addEventListener(FR_WATCHLIST_CHANGED, onChange);
    return () => window.removeEventListener(FR_WATCHLIST_CHANGED, onChange);
  }, []);
  return list;
}
