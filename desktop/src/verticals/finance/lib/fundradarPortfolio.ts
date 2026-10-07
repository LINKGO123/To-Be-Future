/**
 * 资金雷达工作台 · 用户持仓清单（可增删改，全局生效）
 * ------------------------------------------------------------
 * 持仓不再写死在各页面：统一读写 localStorage `fr-holdings`，
 * 无则回退默认 5 只（data/fundradarSample.ts 的 FR_HOLDINGS，成本/数量为空）。
 * 增删改后 saveHoldings 派发 window 自定义事件 fr-holdings-changed，
 * 首页 / 持仓页 / 个股页用 useHoldings() 订阅，增删改后同步刷新。
 *
 * 字段口径：
 *   code  6 位 A 股代码
 *   name  名称（行情端点查不到时手填）
 *   cost  成本价（元）
 *   qty   数量（股）
 * 盈亏计算口径见 FundradarPortfolio 页注释（与 calc pnl 同口径：
 * (现价 - 成本) × 数量），本文件只负责清单的读写与同步，不做计算。
 */
import { useEffect, useState } from "react";
import { FR_HOLDINGS } from "@/data/fundradarSample";
import { storageGet, storageSet } from "./storage";

export interface FrHolding {
  code: string;
  name: string;
  /** 成本价（元）；未录为 undefined */
  cost?: number;
  /** 数量（股）；未录为 undefined */
  qty?: number;
}

/** 持仓清单的 localStorage 键 */
export const FR_HOLDINGS_KEY = "fr-holdings";
/** 持仓增删改后的 window 自定义事件名 */
export const FR_HOLDINGS_CHANGED = "fr-holdings-changed";

/** 默认持仓：写死常量的 code/name 兜底（cost/qty 空）。 */
function defaultHoldings(): FrHolding[] {
  return FR_HOLDINGS.map((h) => ({ code: h.code, name: h.name }));
}

/** 规范化一条持仓（过滤脏数据；code 必须是 6 位数字）。 */
function normalize(item: unknown): FrHolding | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const code = String(o.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(o.name ?? "").trim();
  const cost = typeof o.cost === "number" && Number.isFinite(o.cost) ? o.cost : undefined;
  const qty = typeof o.qty === "number" && Number.isFinite(o.qty) ? o.qty : undefined;
  const holding: FrHolding = { code, name: name || code };
  if (cost !== undefined) holding.cost = cost;
  if (qty !== undefined) holding.qty = qty;
  return holding;
}

/** 读持仓：localStorage `fr-holdings`；无/损坏 → 默认 5 只（cost/qty 空）。 */
export function loadHoldings(): FrHolding[] {
  const raw = storageGet(FR_HOLDINGS_KEY);
  if (!raw) return defaultHoldings();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultHoldings();
    // 存了一份但为空数组 = 用户删光了持仓：尊重空列表，不再回退默认。
    return parsed.map(normalize).filter((h): h is FrHolding => h !== null);
  } catch {
    return defaultHoldings();
  }
}

/** 写持仓并广播 fr-holdings-changed，让在屏页面同步刷新。 */
export function saveHoldings(list: FrHolding[]): void {
  storageSet(FR_HOLDINGS_KEY, JSON.stringify(list));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FR_HOLDINGS_CHANGED));
  }
}

/** 当前持仓代码列表（行情取数 / 自动刷新共用）。 */
export function holdingsCodes(): string[] {
  return loadHoldings().map((h) => h.code);
}

/** code 是否在持仓清单（个股页 ●我的持仓 标记等用）。 */
export function isHolding(code: string): boolean {
  return loadHoldings().some((h) => h.code === code);
}

/**
 * 订阅 fr-holdings-changed：返回当前持仓清单，增删改后自动重渲染。
 * 首页 / 持仓页 / 个股页用本 Hook 读清单，保证全局生效。
 */
export function useHoldings(): FrHolding[] {
  const [list, setList] = useState<FrHolding[]>(() => loadHoldings());
  useEffect(() => {
    const onChange = () => setList(loadHoldings());
    window.addEventListener(FR_HOLDINGS_CHANGED, onChange);
    return () => window.removeEventListener(FR_HOLDINGS_CHANGED, onChange);
  }, []);
  return list;
}
