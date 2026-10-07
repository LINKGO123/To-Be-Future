/**
 * 资金雷达工作台 · 长期目标（Goal 模式）
 * ------------------------------------------------------------
 * localStorage `fr-goals` 存目标列表。目标由前端在对话里识别「跟踪 / 每天 / 定时」
 * 意图后建立（不依赖后端新增工具）；盘后批（fundradarAutoRefresh 的 post 阶段）调用
 * runGoalChecks() 用现有取数端点执行检查，结果以文字摘要写回 goal.lastResult。
 * 问进度时前端把列表注入对话，由 AI 大白话逐条汇报。
 *
 * 硬约束：不改 calc/datasources/orchestrator；不新增依赖；复用 fetchFr 取数。
 */
import { num, rows, scalar, str, type Envelope } from "./backend";
import { fetchFr, frTodayKey } from "./fundradarData";
import { storageGet, storageSet } from "./storage";

export type FrGoalKind = "财报" | "公告" | "资金" | "自定义";
export type FrGoalStatus = "active" | "paused" | "done";

export interface FrGoal {
  id: string;
  title: string;
  code?: string;
  kind: FrGoalKind;
  createdAt: number;
  /** epoch ms；0 = 从未检查 */
  lastRunAt: number;
  status: FrGoalStatus;
  /** 最近一次检查的文字摘要 */
  lastResult: string;
}

const KEY = "fr-goals";
/** 盘后目标检查每天只跑一次的日期去重键 */
const GOAL_CHECK_KEY = "fr-last-goal-check";

export function newGoalId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* 隐私模式等环境退化到时间戳 */ }
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parse(raw: string | null): FrGoal[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (g): g is FrGoal =>
          !!g && typeof g === "object"
          && typeof (g as FrGoal).id === "string"
          && typeof (g as FrGoal).title === "string"
          && typeof (g as FrGoal).kind === "string",
      )
      .map((g) => {
        const x = g as FrGoal;
        return {
          ...x,
          status: x.status === "paused" || x.status === "done" ? x.status : "active",
          lastRunAt: typeof x.lastRunAt === "number" ? x.lastRunAt : 0,
          lastResult: typeof x.lastResult === "string" ? x.lastResult : "",
        };
      });
  } catch {
    return [];
  }
}

/** 读目标列表，按最近建立倒序 */
export function loadGoals(): FrGoal[] {
  return parse(storageGet(KEY)).sort((a, b) => b.createdAt - a.createdAt);
}

export function persistGoals(list: FrGoal[]): void {
  storageSet(KEY, JSON.stringify(list));
}

export interface GoalInput {
  title: string;
  code?: string;
  kind: FrGoalKind;
}

export function createGoal(input: GoalInput): FrGoal {
  const goal: FrGoal = {
    id: newGoalId(),
    title: input.title,
    ...(input.code ? { code: input.code } : {}),
    kind: input.kind,
    createdAt: Date.now(),
    lastRunAt: 0,
    status: "active",
    lastResult: "",
  };
  persistGoals([goal, ...loadGoals()]);
  return goal;
}

export function updateGoal(id: string, patch: Partial<Omit<FrGoal, "id">>): void {
  persistGoals(loadGoals().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

export function deleteGoal(id: string): void {
  persistGoals(loadGoals().filter((g) => g.id !== id));
}

/* ---------------- 意图识别 ---------------- */

export interface GoalIntent {
  code?: string;
  kind: FrGoalKind;
  title: string;
}

function detectKind(text: string): FrGoalKind {
  if (/财报|业绩|季报|年报|中报|盈利/.test(text)) return "财报";
  if (/公告|披露|重大事项|停牌|减持|增持|举牌/.test(text)) return "公告";
  if (/资金|主力|流向|净流入|净流出/.test(text)) return "资金";
  return "自定义";
}

/** 识别「跟踪 / 每天 / 定时」类目标意图；无触发词且无标的时返回 null。 */
export function detectGoalIntent(text: string): GoalIntent | null {
  const trigger = /跟踪|每天|每日|定时|盯梢|盯住|自动检查|每日盘后/.test(text);
  if (!trigger) return null;
  const code = /(\d{6})/.exec(text)?.[1];
  const kind = detectKind(text);
  if (!code && kind === "自定义") return null;
  const base = code ? (kind === "自定义" ? code : `${code} ${kind}`) : kind;
  return { ...(code ? { code } : {}), kind, title: `跟踪 ${base}` };
}

/* ---------------- 问进度 / 注入 AI ---------------- */

/** 是否在问「我的目标进度」。 */
export function isGoalProgressQuery(text: string): boolean {
  return /我的目标|目标进度|目标列表|目标怎么|查看.*目标|目标.*进度|目标.*怎么样/.test(text);
}

/** 把目标列表转成一段给 AI 看的纯文本（截断上限，防止消息超长）。 */
export function formatGoalsForPrompt(): string {
  const goals = loadGoals();
  if (!goals.length) return "（无目标）";
  return goals
    .slice(0, 10)
    .map((g) => {
      const status = g.status === "active" ? "进行中" : g.status === "paused" ? "已暂停" : "已完成";
      const last = g.lastRunAt ? new Date(g.lastRunAt).toLocaleString() : "尚未检查";
      return `- ${g.title}（${g.kind}）｜状态：${status}｜上次检查：${last}｜最新：${g.lastResult || "暂无结果"}`;
    })
    .join("\n");
}

/* ---------------- 盘后自动检查 ---------------- */

const KIND_ENDPOINTS: Record<FrGoalKind, string[]> = {
  财报: ["fetch_financials"],
  公告: ["fetch_announcements", "cninfo_announcements"],
  资金: ["em_fund_flow_120d", "sina_fund_flow"],
  自定义: [],
};

function fmtYi(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round((v / 1e8) * 100) / 100} 亿元`;
}

/** 把取数信封压成一句文字摘要（按目标类别读对应字段）。 */
function summarize(env: Envelope, kind: FrGoalKind): string {
  if (kind === "公告") {
    const titles = (env.evidence ?? [])
      .filter((e) => e.field === "announcement_title")
      .map((e) => str(e))
      .filter(Boolean);
    if (!titles.length) return "暂无新公告";
    return `最新公告 ${titles.length} 条：${titles.slice(0, 3).join("；")}${titles.length > 3 ? "…" : ""}`;
  }
  if (kind === "资金") {
    const rs = rows(env)
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.key))
      .sort((a, b) => a.key.localeCompare(b.key));
    const latest = rs[rs.length - 1];
    const main = num(latest?.fields["fund_flow_main_net"]);
    if (main !== null) {
      const d = latest?.key ?? "";
      return `${d} 主力净${main >= 0 ? "流入" : "流出"} ${fmtYi(Math.abs(main))}`;
    }
    const s = num(scalar(env, "fund_net_inflow_daily_latest"));
    return s === null ? "资金流数据暂不可用" : `最新主力净${s >= 0 ? "流入" : "流出"} ${fmtYi(Math.abs(s))}`;
  }
  if (kind === "财报") {
    // fetch_financials 证据无 record_key，rows() 取不到 → 按 period 直接读 evidence（同 financialsOf / loadStockFinancials 口径）
    const CORE = ["revenue_cum", "net_profit_parent_cum", "eps_basic_cum"];
    const periods = [...new Set((env.evidence ?? []).filter((e) => CORE.includes(e.field)).map((e) => e.period))].sort();
    const latest = periods[periods.length - 1] ?? null;
    const at = (field: string) => (latest === null ? undefined : env.evidence.find((x) => x.field === field && x.period === latest));
    const revenue = num(at("revenue_cum"));
    const net = num(at("net_profit_parent_cum"));
    const period = latest ?? "";
    if (revenue === null && net === null) return "财务数据暂不可用";
    return `${period || "最新报告期"}：营收 ${fmtYi(revenue)}、归母净利 ${fmtYi(net)}`;
  }
  return "（自定义目标，无自动检查）";
}

/**
 * 盘后遍历所有「进行中且有代码」的目标，执行对应端点检查并写回 lastResult / lastRunAt。
 * 每天只真跑一次（force 跳过日期去重）；空目标列表无开销。
 */
export async function runGoalChecks(force = false): Promise<{ ok: number; fail: number }> {
  const today = frTodayKey();
  if (!force && storageGet(GOAL_CHECK_KEY) === today) return { ok: 0, fail: 0 };
  const goals = loadGoals();
  const active = goals.filter((g) => g.status === "active" && g.code);
  if (!active.length) {
    storageSet(GOAL_CHECK_KEY, today);
    return { ok: 0, fail: 0 };
  }
  let ok = 0;
  let fail = 0;
  const patches = new Map<string, { lastRunAt: number; lastResult: string }>();
  for (const g of active) {
    const endpoints = KIND_ENDPOINTS[g.kind] ?? [];
    if (!endpoints.length) continue; // 自定义目标不自动检查
    let result = "检查失败：数据源暂不可用";
    let success = false;
    for (const ep of endpoints) {
      try {
        const res = await fetchFr(ep, {}, { refresh: true, symbol: g.code });
        result = summarize(res.envelope, g.kind);
        success = true;
        break;
      } catch {
        /* 落下一级备源 */
      }
    }
    patches.set(g.id, { lastRunAt: Date.now(), lastResult: result });
    if (success) ok += 1;
    else fail += 1;
  }
  if (patches.size) {
    persistGoals(goals.map((g) => {
      const p = patches.get(g.id);
      return p ? { ...g, ...p } : g;
    }));
  }
  storageSet(GOAL_CHECK_KEY, today);
  return { ok, fail };
}
