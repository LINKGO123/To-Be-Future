/**
 * 资金雷达工作台 · 评分榜自定义候选池（手动增删）
 * ------------------------------------------------------------
 * 候选池 = 4 板块硬编码清单（lib/fundradarScorePool.ts）
 *        ∪ 本自定义清单（localStorage `fr-score-pool-custom`，手动输代码加）
 *        ∪ 自选（lib/fundradarWatchlist.ts），三者去重后参与评分。
 *
 * 与自选的区别：自选是「我想跟踪」的清单（与持仓分开）；自定义候选池是
 * 「额外纳入评分范围」的手动清单。评分榜页「管理候选池」区维护本清单，
 * 名称复用 loadStockQuote 查（查不到回退 code，不编名称）。
 *
 * 增删后 saveScorePoolCustom 派发 window 自定义事件
 * fr-score-pool-custom-changed，评分榜页用 useScorePoolCustom() 订阅刷新。
 *
 * 字段口径：
 *   code  6 位 A 股代码
 *   name  名称（行情端点查不到时手填/回退 code）
 */
import { useEffect, useState } from "react";

import { storageGet, storageSet } from "./storage";

export interface FrScorePoolCustomItem {
  code: string;
  name: string;
}

/** 自定义候选池的 localStorage 键 */
export const FR_SCORE_POOL_CUSTOM_KEY = "fr-score-pool-custom";
/** 自定义候选池增删后的 window 自定义事件名 */
export const FR_SCORE_POOL_CUSTOM_CHANGED = "fr-score-pool-custom-changed";

/** 规范化一条自定义候选（过滤脏数据；code 必须是 6 位数字）。 */
function normalize(item: unknown): FrScorePoolCustomItem | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const code = String(o.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(o.name ?? "").trim();
  return { code, name: name || code };
}

/** 读自定义候选池：localStorage `fr-score-pool-custom`；无/损坏 → 空列表（默认空）。 */
export function loadScorePoolCustom(): FrScorePoolCustomItem[] {
  const raw = storageGet(FR_SCORE_POOL_CUSTOM_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((x): x is FrScorePoolCustomItem => x !== null);
  } catch {
    return [];
  }
}

/** 写自定义候选池并广播 fr-score-pool-custom-changed，让评分榜页同步刷新。 */
export function saveScorePoolCustom(list: FrScorePoolCustomItem[]): void {
  storageSet(FR_SCORE_POOL_CUSTOM_KEY, JSON.stringify(list));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FR_SCORE_POOL_CUSTOM_CHANGED));
  }
}

/** 加一只自定义候选（按 code 去重；已存在则忽略，返回是否实际新增）。 */
export function addScorePoolCustomItem(code: string, name: string): boolean {
  const c = code.trim();
  if (!/^\d{6}$/.test(c)) return false;
  const list = loadScorePoolCustom();
  if (list.some((x) => x.code === c)) return false;
  saveScorePoolCustom([...list, { code: c, name: name.trim() || c }]);
  return true;
}

/** 删一只自定义候选（不存在则忽略）。 */
export function removeScorePoolCustomItem(code: string): void {
  saveScorePoolCustom(loadScorePoolCustom().filter((x) => x.code !== code));
}

/** 当前自定义候选代码列表（批量评分拼候选池用）。 */
export function scorePoolCustomCodes(): string[] {
  return loadScorePoolCustom().map((x) => x.code);
}

/**
 * 订阅 fr-score-pool-custom-changed：返回当前自定义候选池，增删后自动重渲染。
 * 评分榜页「管理候选池」区用本 Hook 读清单，保证全局生效。
 */
export function useScorePoolCustom(): FrScorePoolCustomItem[] {
  const [list, setList] = useState<FrScorePoolCustomItem[]>(() => loadScorePoolCustom());
  useEffect(() => {
    const onChange = () => setList(loadScorePoolCustom());
    window.addEventListener(FR_SCORE_POOL_CUSTOM_CHANGED, onChange);
    return () => window.removeEventListener(FR_SCORE_POOL_CUSTOM_CHANGED, onChange);
  }, []);
  return list;
}
