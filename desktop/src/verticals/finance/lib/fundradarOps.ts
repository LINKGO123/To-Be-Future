/**
 * 资金雷达工作台 · Agent 操作前端模块（操作指令协议 [OP]）
 * ------------------------------------------------------------------
 * 复用 Plan 模式的 [PLAN] 标记机制：Agent 在正文里输出
 *   [OP]add_holding code=600183 cost=30 shares=1000[/OP]
 * 前端解析成「操作确认卡」（OpCard），用户点「确认执行」后才真正调用
 * 对应的 localStorage 写函数；取消则标注「已取消」。**先确认再执行**。
 *
 * - parseOp / splitOps：提取 [OP]...[/OP] 并解析成 { action, params }，
 *   action 必须在白名单内、params 键必须合法；流式中 [OP] 已出但 [/OP]
 *   未到时剥开标记，避免把标记当正文渲染（与 splitPlan 同思路）。
 * - describeOp：把操作翻译成中文描述（「加持仓：生益科技(600183)，成本 30 元，1000 股」）。
 * - executeOp：真正执行 —— 只复用现有 localStorage 函数（addWatchItem /
 *   saveHoldings / deleteReportHistoryItem / setReportHistoryLock /
 *   addScorePoolCustomItem / saveFontTier / applyDarkMode），**不重写存储**，
 *   写入后由这些函数自行派发 fr-*-changed 事件让各页刷新。
 * - lookupStockName：操作里只有 code 时，前端兜底查名（先查持仓档案，再走
 *   loadStockQuote 行情端点），查不到回退 code。
 */
import { applyDarkMode } from "@/hooks/useDarkMode";
import { FR_HOLDING_META } from "@/lib/fundradarData";
import { loadHoldings, saveHoldings, type FrHolding } from "@/lib/fundradarPortfolio";
import {
  deleteReportHistoryItem, loadReportHistory, setReportHistoryLock,
} from "@/lib/fundradarReportHistory";
import {
  addScorePoolCustomItem, loadScorePoolCustom, removeScorePoolCustomItem,
} from "@/lib/fundradarScorePoolCustom";
import { FONT_TIERS, saveFontTier, type FontTier } from "@/lib/fundradarTheme";
import { addWatchItem, loadWatchlist, removeWatchItem } from "@/lib/fundradarWatchlist";
import { loadStockQuote } from "@/lib/fundradarStock";

/* ---------------- 操作指令协议 ---------------- */

export interface FrOp {
  /** 固定动作名（见 OP_ACTIONS 白名单） */
  action: string;
  /** 参数键值对（只保留白名单内的键） */
  params: Record<string, string>;
  /** 原始块内容（调试 / 兜底展示） */
  raw: string;
}

export interface FrOpResult {
  ok: boolean;
  message: string;
}

/** 动作白名单：动作名 → 中文标签 + 允许的参数键 + 必填参数键。 */
export const OP_ACTIONS: Record<string, { label: string; params: string[]; required: string[] }> = {
  add_holding: { label: "加持仓", params: ["code", "name", "cost", "shares"], required: ["code"] },
  remove_holding: { label: "删持仓", params: ["code"], required: ["code"] },
  update_holding: { label: "改持仓", params: ["code", "cost", "shares"], required: ["code"] },
  add_watch: { label: "加自选", params: ["code", "name"], required: ["code"] },
  remove_watch: { label: "删自选", params: ["code"], required: ["code"] },
  delete_report: { label: "删报告", params: ["code"], required: ["code"] },
  lock_report: { label: "锁定报告", params: ["code"], required: ["code"] },
  unlock_report: { label: "解锁报告", params: ["code"], required: ["code"] },
  add_pool: { label: "加候选池", params: ["code", "name"], required: ["code"] },
  remove_pool: { label: "删候选池", params: ["code"], required: ["code"] },
  set_font_tier: { label: "改字号", params: ["tier"], required: ["tier"] },
  set_theme: { label: "改深浅色", params: ["mode"], required: ["mode"] },
};

/** 动作名 → 中文标签（OpCard 头部/描述用）。 */
export const OP_ACTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(OP_ACTIONS).map(([action, spec]) => [action, spec.label]),
);

const TIER_LABELS: Record<string, string> = { compact: "紧凑", standard: "标准", large: "加大", xlarge: "超大" };

/* ---------------- 解析 ---------------- */

/** 解析单个 [OP] 块的内容（不含标记）：action + key=value 参数；不合法返回 null。 */
function parseOpBlock(inner: string): FrOp | null {
  const text = inner.trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const action = tokens[0]!;
  const spec = OP_ACTIONS[action];
  if (!spec) return null; // action 不在白名单
  const params: Record<string, string> = {};
  for (const tok of tokens.slice(1)) {
    const eq = tok.indexOf("=");
    if (eq <= 0) continue; // 跳过没有 key= 的零散词
    const key = tok.slice(0, eq);
    if (!spec.params.includes(key)) continue; // 忽略白名单外的键
    params[key] = tok.slice(eq + 1);
  }
  for (const req of spec.required) {
    if (!(req in params)) return null; // 缺必填参数
  }
  return { action, params, raw: text };
}

/** 从文本里提取第一个 [OP]...[/OP] 并解析；没有则 null。 */
export function parseOp(text: string): FrOp | null {
  const m = /\[OP\]([\s\S]*?)\[\/OP\]/i.exec(text);
  if (!m) return null;
  return parseOpBlock(m[1] ?? "");
}

/**
 * 拆出正文里的全部 [OP]...[/OP] 操作块：解析成 FrOp 数组，其余文字照常显示。
 * 流式中 [OP] 已出但 [/OP] 未到 → 剥开标记（避免闪），不产出操作。
 */
export function splitOps(content: string): { outside: string; ops: FrOp[] } {
  const re = /\[OP\]([\s\S]*?)\[\/OP\]/gi;
  const ops: FrOp[] = [];
  let m: RegExpExecArray | null;
  let anyClosed = false;
  while ((m = re.exec(content))) {
    anyClosed = true;
    const op = parseOpBlock(m[1] ?? "");
    if (op) ops.push(op);
  }
  if (anyClosed) {
    return { outside: content.replace(/\[OP\][\s\S]*?\[\/OP\]/gi, "").trim(), ops };
  }
  if (/\[OP\]/i.test(content)) {
    return { outside: content.replace(/\[OP\]/gi, "").trim(), ops: [] };
  }
  return { outside: content, ops: [] };
}

/* ---------------- 中文描述 ---------------- */

/** 「名称（代码）」或仅代码；名称 = 操作自带的 name > 兜底查到的 name > 空。 */
function stockLabel(code: string, name?: string): string {
  const c = code.trim();
  const nm = (name ?? "").trim();
  return nm && nm !== c ? `${nm}（${c}）` : c;
}

/** 操作 → 中文描述（供操作确认卡展示）。 */
export function describeOp(op: FrOp, name?: string): string {
  const code = (op.params.code ?? "").trim();
  const nm = (op.params.name ?? name ?? "").trim();
  const p = op.params;
  switch (op.action) {
    case "add_holding": {
      const parts = [`加持仓：${stockLabel(code, nm)}`];
      if (p.cost != null && p.cost !== "") parts.push(`成本 ${p.cost} 元`);
      if (p.shares != null && p.shares !== "") parts.push(`${p.shares} 股`);
      return parts.join("，");
    }
    case "update_holding": {
      const parts = [`改持仓：${stockLabel(code, nm)}`];
      if (p.cost != null && p.cost !== "") parts.push(`成本 ${p.cost} 元`);
      if (p.shares != null && p.shares !== "") parts.push(`${p.shares} 股`);
      return parts.join("，");
    }
    case "remove_holding": return `删持仓：${stockLabel(code, nm)}`;
    case "add_watch": return `加自选：${stockLabel(code, nm)}`;
    case "remove_watch": return `删自选：${stockLabel(code, nm)}`;
    case "delete_report": return `删报告：${stockLabel(code, nm)}`;
    case "lock_report": return `锁定报告：${stockLabel(code, nm)}`;
    case "unlock_report": return `解锁报告：${stockLabel(code, nm)}`;
    case "add_pool": return `加候选池：${stockLabel(code, nm)}`;
    case "remove_pool": return `删候选池：${stockLabel(code, nm)}`;
    case "set_font_tier": return `改字号：${TIER_LABELS[p.tier ?? ""] ?? p.tier ?? ""}`;
    case "set_theme": return `改深浅色：${p.mode === "dark" ? "深色" : "浅色"}`;
    default: return op.raw;
  }
}

/* ---------------- 查名兜底 ---------------- */

/** 6 位代码 → 名称：先查持仓档案（即时、离线），查不到走 loadStockQuote；仍查不到回退代码。 */
export async function lookupStockName(code: string): Promise<string> {
  const meta = FR_HOLDING_META.find((h) => h.code === code);
  if (meta?.name) return meta.name;
  try {
    const q = await loadStockQuote(code, false);
    if (q.name && q.name !== code) return q.name;
  } catch {
    /* 行情不可用 → 回退 code */
  }
  return code;
}

/* ---------------- 执行 ---------------- */

/** 解析可选数字：空 → undefined；数字 → 值；非法 → null。 */
function parseNum(s: string | undefined): number | null | undefined {
  if (s == null || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function codeError(): FrOpResult {
  return { ok: false, message: "股票代码需为 6 位数字" };
}

/**
 * 真正执行一个操作（同步，只写 localStorage，复用现有函数，不重写存储）。
 * 调用方（OpCard）必须在用户点「确认执行」后才调用本函数。
 * extraName：前端查名兜底出的名称（操作里只有 code 时由 OpCard 先查好再传入）。
 */
export function executeOp(op: FrOp, extraName?: string): FrOpResult {
  const p = op.params;
  const code = (p.code ?? "").trim();
  const nm = (p.name ?? extraName ?? "").trim() || code;

  switch (op.action) {
    case "add_holding": {
      if (!/^\d{6}$/.test(code)) return codeError();
      const cost = parseNum(p.cost);
      const shares = parseNum(p.shares);
      if (cost === null) return { ok: false, message: "成本价请填数字" };
      if (shares === null) return { ok: false, message: "数量请填数字" };
      const list = loadHoldings();
      const existing = list.find((h) => h.code === code);
      if (existing) {
        // 已在持仓：用户真实意图是给该股填成本/数量 → 自动转成更新，而不是拒绝
        if (cost === undefined && shares === undefined) {
          return { ok: false, message: `已在持仓清单里（要改成本或数量，请说「更新/改 ${code} 成本 30」）` };
        }
        const next: FrHolding = { ...existing };
        if (cost !== undefined) next.cost = cost;
        if (shares !== undefined) next.qty = shares;
        saveHoldings(list.map((h) => (h.code === code ? next : h)));
        const updated: string[] = [];
        if (cost !== undefined) updated.push(`成本 ${cost} 元`);
        if (shares !== undefined) updated.push(`数量 ${shares} 股`);
        return { ok: true, message: `已在持仓，已更新${updated.join(" / ")}` };
      }
      const holding: FrHolding = { code, name: nm };
      if (cost !== undefined) holding.cost = cost;
      if (shares !== undefined) holding.qty = shares;
      saveHoldings([...list, holding]);
      return { ok: true, message: `已加持仓：${stockLabel(code, nm)}` };
    }
    case "remove_holding": {
      if (!/^\d{6}$/.test(code)) return codeError();
      const list = loadHoldings();
      if (!list.some((h) => h.code === code)) return { ok: false, message: `持仓清单里没有 ${code}` };
      saveHoldings(list.filter((h) => h.code !== code));
      return { ok: true, message: `已删持仓：${stockLabel(code, nm)}` };
    }
    case "update_holding": {
      if (!/^\d{6}$/.test(code)) return codeError();
      const cost = parseNum(p.cost);
      const shares = parseNum(p.shares);
      if (cost === null) return { ok: false, message: "成本价请填数字" };
      if (shares === null) return { ok: false, message: "数量请填数字" };
      if (cost === undefined && shares === undefined) {
        return { ok: false, message: "请至少给出 cost（成本）或 shares（数量）" };
      }
      const list = loadHoldings();
      const cur = list.find((h) => h.code === code);
      if (!cur) return { ok: false, message: `持仓清单里没有 ${code}` };
      const next: FrHolding = { ...cur };
      if (cost !== undefined) next.cost = cost;
      if (shares !== undefined) next.qty = shares;
      saveHoldings(list.map((h) => (h.code === code ? next : h)));
      return { ok: true, message: `已改持仓：${stockLabel(code, nm)}` };
    }
    case "add_watch": {
      if (!/^\d{6}$/.test(code)) return codeError();
      if (loadWatchlist().some((w) => w.code === code)) return { ok: false, message: `${stockLabel(code, nm)} 已在自选清单里` };
      addWatchItem(code, nm);
      return { ok: true, message: `已加自选：${stockLabel(code, nm)}` };
    }
    case "remove_watch": {
      if (!/^\d{6}$/.test(code)) return codeError();
      if (!loadWatchlist().some((w) => w.code === code)) return { ok: false, message: `自选清单里没有 ${code}` };
      removeWatchItem(code);
      return { ok: true, message: `已删自选：${stockLabel(code, nm)}` };
    }
    case "delete_report": {
      if (!/^\d{6}$/.test(code)) return codeError();
      const matches = loadReportHistory().filter((x) => x.code === code);
      if (matches.length === 0) return { ok: false, message: `没有找到 ${code} 的报告` };
      let deleted = 0;
      for (const m of matches) if (deleteReportHistoryItem(m.code, m.ts)) deleted += 1;
      if (deleted === 0) return { ok: false, message: `报告已锁定或不存在，未删除` };
      return { ok: true, message: `已删报告：${stockLabel(code, matches[0]?.name)}` };
    }
    case "lock_report":
    case "unlock_report": {
      if (!/^\d{6}$/.test(code)) return codeError();
      const locked = op.action === "lock_report";
      const matches = loadReportHistory().filter((x) => x.code === code);
      if (matches.length === 0) return { ok: false, message: `没有找到 ${code} 的报告` };
      for (const m of matches) setReportHistoryLock(m.code, m.ts, locked);
      return { ok: true, message: `${locked ? "已锁定" : "已解锁"}报告：${stockLabel(code, matches[0]?.name)}` };
    }
    case "add_pool": {
      if (!/^\d{6}$/.test(code)) return codeError();
      if (loadScorePoolCustom().some((x) => x.code === code)) return { ok: false, message: `${stockLabel(code, nm)} 已在候选池里` };
      addScorePoolCustomItem(code, nm);
      return { ok: true, message: `已加候选池：${stockLabel(code, nm)}` };
    }
    case "remove_pool": {
      if (!/^\d{6}$/.test(code)) return codeError();
      if (!loadScorePoolCustom().some((x) => x.code === code)) return { ok: false, message: `候选池里没有 ${code}` };
      removeScorePoolCustomItem(code);
      return { ok: true, message: `已删候选池：${stockLabel(code, nm)}` };
    }
    case "set_font_tier": {
      const tier = p.tier ?? "";
      if (!FONT_TIERS.some((t) => t.key === tier)) {
        return { ok: false, message: "字号档位需为 compact / standard / large / xlarge" };
      }
      saveFontTier(tier as FontTier);
      return { ok: true, message: `已改字号：${TIER_LABELS[tier] ?? tier}` };
    }
    case "set_theme": {
      const mode = p.mode ?? "";
      if (mode !== "dark" && mode !== "light") return { ok: false, message: "深浅色需为 dark 或 light" };
      applyDarkMode(mode === "dark");
      return { ok: true, message: `已改深浅色：${mode === "dark" ? "深色" : "浅色"}` };
    }
    default:
      return { ok: false, message: `未知操作：${op.action}` };
  }
}
