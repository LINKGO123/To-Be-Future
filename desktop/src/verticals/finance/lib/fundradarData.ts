/**
 * 资金雷达工作台 · 底座真实数据接入层（刀5）
 * ------------------------------------------------------------
 * 职责：常用五页（首页 / 主线雷达 / 龙虎榜 / 我的持仓 / 每日复盘）从底座
 * 117 数据端点取真实数据；本层只做「取 + 解析 + 缓存」，失败一律抛错，
 * 由页面降级到示例数据并显示提示 —— 页面不能崩。
 *
 * - 取数：复用 backend.fetch（POST /api/fetch；Bearer 由 Vite 代理注入，浏览器不碰 token）
 * - 缓存：localStorage `fr-data-<endpoint>-<data_date>`（带 data_date / cached_on）。
 *   盘后数据当天不变：cached_on == 当天直接读缓存、不重复请求，跨天自动作废重取；
 *   盘中实时行情（tx_quotes_batch）不做当天缓存，靠后端快照（≤5 分钟）去重。
 * - 最近交易日：em_zt_pool / em_zb_pool / em_limit_up_sentiment / em_daily_dragon_tiger /
 *   ths_limit_up_pool 先试当日，空数据（非交易日 / 盘前 / 盘后未更新）回退前一交易日，
 *   最多回看 10 个自然日（节假日靠“数据为空”自然跳过）。
 * - 热度分：与 calc/fundradar.py 的 heat_score 同一公式（涨停×3 + 资金亿×2 + 高度×1，
 *   保留 1 位小数）。后端 calc 工具白名单未含 heat_score（见 calc/tool.py 的 ALLOWED），
 *   故前端本地实现并在注释注明「与 calc heat_score 一致」；后端开放后应改走 POST /tool/calc。
 * - 红线：只展示，不给任何投资动作建议；所有数字来自端点证据，解析失败按空处理。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  backend, noteKV, num, rows, scalar, str,
  type Envelope, type FetchResult,
} from "./backend";
import { loadHoldings } from "./fundradarPortfolio";
import { storageGet, storageSet } from "./storage";

/* ---------------- 端点中文名（出处/数据源展示） ---------------- */

/**
 * 端点英文名 → 中文名。所有出现在「出处 / 数据来源 / 自检清单」里的端点名
 * 一律经 frEndpointCn() 转成中文，用户看不到英文端点名。
 */
export const FR_ENDPOINT_LABELS: Record<string, string> = {
  sina_fund_flow: "新浪资金流",
  fetch_quote: "行情快照",
  fetch_kline: "日K线",
  fetch_pe_history: "PE历史",
  fetch_estimates: "一致预期",
  fetch_financials: "财务数据",
  tx_quotes_batch: "腾讯行情",
  em_global_news: "东财全球要闻",
  rss_news: "RSS要闻",
  em_zt_pool: "涨停池",
  em_zb_pool: "炸板池",
  em_limit_up_sentiment: "市场情绪",
  em_daily_dragon_tiger: "龙虎榜",
  exchange_dragon_tiger: "交易所龙虎榜备源",
  em_fund_flow_minute: "分钟资金流",
  em_fund_flow_120d: "120日资金流",
  akshare_fund_flow_120d: "akshare四维资金流",
  em_concept_blocks: "概念板块",
  bs_valuation_history: "估值历史",
  // 补充（代码库出处里出现的其余端点）
  em_board_fund_flow: "板块资金流",
  ths_limit_up_pool: "涨停原因",
  em_dragon_tiger: "个股龙虎榜",
  bs_kline_qfq: "日K线",
  tdx_bars: "通达信分时",
};

/** 把文本里的端点英文名替换为中文名（多端点串用 / 或 → 分隔也会全部替换）；无匹配则原样返回。 */
export function frEndpointCn(text: string): string {
  let out = text;
  for (const [en, cn] of Object.entries(FR_ENDPOINT_LABELS)) {
    out = out.split(en).join(cn);
  }
  return out;
}

/* ---------------- 持仓静态档案 ---------------- */

/** 默认持仓代码（仅作默认值兜底；实时清单以 lib/fundradarPortfolio.ts 的 loadHoldings() 为准） */
export const FR_HOLDING_CODES = ["600183", "300285", "000938", "000977", "002475"] as const;

/** 持仓档案：代码 / 名称 / 板块。keywords 只用于「板块是否覆盖持仓」的页面展示判断，不是市场数据。 */
export interface FrHoldingMeta {
  code: string;
  name: string;
  sector: string;
  keywords: string[];
}

export const FR_HOLDING_META: readonly FrHoldingMeta[] = [
  { code: "600183", name: "生益科技", sector: "PCB/覆铜板", keywords: ["PCB", "覆铜板"] },
  { code: "300285", name: "国瓷材料", sector: "电子材料", keywords: ["电子材料", "陶瓷"] },
  { code: "000938", name: "紫光股份", sector: "AI服务器", keywords: ["服务器", "计算机设备", "算力"] },
  { code: "000977", name: "浪潮信息", sector: "AI服务器", keywords: ["服务器", "计算机设备", "算力"] },
  { code: "002475", name: "立讯精密", sector: "消费电子", keywords: ["消费电子"] },
];

/* ---------------- 当天缓存（盘后数据一天不变） ---------------- */

const CACHE_PREFIX = "fr-data";
const CACHE_IDX_PREFIX = "fr-data-idx";
const memCache = new Map<string, FrCacheEntry>();

export interface FrCacheEntry {
  /** 数据日期 YYYY-MM-DD（取自信封 extra.date / 证据 period / fetched_at） */
  data_date: string;
  fetched_at: string;
  /** 写入当天（本地日期）：当天有效；跨天作废、重新取数 */
  cached_on: string;
  payload: FetchResult;
}

export function frTodayKey(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function cacheKeyOf(endpoint: string, date: string): string {
  return `${CACHE_PREFIX}-${endpoint}-${date}`;
}

function cacheIdxKeyOf(endpoint: string): string {
  return `${CACHE_IDX_PREFIX}-${endpoint}`;
}

function readDayCache(endpoint: string): FrCacheEntry | null {
  const mem = memCache.get(endpoint);
  if (mem && mem.cached_on === frTodayKey()) return mem;
  try {
    const idxRaw = storageGet(cacheIdxKeyOf(endpoint));
    if (!idxRaw) return null;
    const idx = JSON.parse(idxRaw) as { data_date?: unknown };
    if (typeof idx?.data_date !== "string") return null;
    const raw = storageGet(cacheKeyOf(endpoint, idx.data_date));
    if (!raw) return null;
    const entry = JSON.parse(raw) as FrCacheEntry;
    if (!entry || typeof entry.data_date !== "string" || typeof entry.cached_on !== "string" || !entry.payload?.envelope) return null;
    if (entry.cached_on !== frTodayKey()) return null; // 跨天：盘后数据已过期，重取
    memCache.set(endpoint, entry);
    return entry;
  } catch {
    return null; // localStorage 不可用 / 内容损坏：当作没有缓存
  }
}

function writeDayCache(endpoint: string, entry: FrCacheEntry): void {
  memCache.set(endpoint, entry);
  storageSet(cacheKeyOf(endpoint, entry.data_date), JSON.stringify(entry));
  storageSet(cacheIdxKeyOf(endpoint), JSON.stringify({ data_date: entry.data_date, cached_on: entry.cached_on }));
}

/* ---------------- 东财端点限流（防封 IP） ---------------- */

/**
 * 东财 push2 系接口共用风控面：批量 / 高频请求会触发封 IP（等 30-60 分钟解封，
 * a-stock-data 实测结论）。腾讯（tx_*）/ 新浪（sina_*）/ baostock（bs_*）不封 IP、
 * 不做限流。这里对所有 `em_` 前缀端点做**全局串行化 + 最小间隔**节流：
 * 相邻两次 em_ 请求至少间隔 EM_THROTTLE_MS（400-600ms 取中值 500ms），
 * 且任何时刻最多一个 em_ 请求在途；缓存命中（dayCache）的 em_ 端点不真发请求、
 * 不经过节流。
 */
const EM_THROTTLE_MS = 500;

const isEastMoneyEndpoint = (endpoint: string): boolean => endpoint.startsWith("em_");

/** 上一个 em_ 请求真正发出的时间戳（进程内共享） */
let lastEastMoneySentAt = 0;
/** 串行化所有 em_ 请求的 promise 链 */
let eastMoneyChain: Promise<void> = Promise.resolve();

function throttleEastMoneyRequest(): Promise<void> {
  const prev = eastMoneyChain;
  const run = prev.then(async () => {
    const wait = lastEastMoneySentAt + EM_THROTTLE_MS - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    lastEastMoneySentAt = Date.now();
  });
  // 链条永不 reject（run 内不抛错），这里兜底一次，防止未来改坏后整条链断掉
  eastMoneyChain = run.then(() => undefined, () => undefined);
  return run;
}

/* ---------------- 基础取数 ---------------- */

export interface FrFetchResult {
  envelope: Envelope;
  fetched_at: string;
  /** 后端是否返回了快照（不同于“前端当天缓存”） */
  cached: boolean;
  data_date: string;
  raw: FetchResult;
}

/**
 * 取一个端点；成功结果按数据日期写入当天缓存（盘后数据当天不变）。
 * `dayCache:false`（行情等盘中变化数据）跳过当天缓存，靠后端快照去重。
 * `refresh:true`（页面重试按钮）跳过前端缓存并强制后端真取一次。
 * `symbol`（个股详情页等单标的端点）原样透传 backend.fetch 的 symbol 字段。
 */
export async function fetchFr(
  endpoint: string,
  args?: Record<string, unknown>,
  opts: { refresh?: boolean; dayCache?: boolean; symbol?: string } = {},
): Promise<FrFetchResult> {
  const useDayCache = opts.dayCache !== false;
  // 🔴 缓存键必须含 symbol：同端点不同个股（fetch_kline 600183 与 000977）是两份数据，
  //    只用 endpoint 当键会让第二个股直接读到第一个股的缓存，页面数字错但不报错。
  const cacheKey = opts.symbol ? `${endpoint}@${opts.symbol}` : endpoint;
  if (!opts.refresh && useDayCache) {
    const hit = readDayCache(cacheKey);
    if (hit) {
      return {
        envelope: hit.payload.envelope,
        fetched_at: hit.payload.fetched_at,
        cached: true,
        data_date: hit.data_date,
        raw: hit.payload,
      };
    }
  }
  // 东财系端点限流防封：em_* 请求串行化 + 最小间隔 500ms（腾讯/新浪/baostock 不受影响）
  if (isEastMoneyEndpoint(endpoint)) {
    await throttleEastMoneyRequest();
  }
  const raw = await backend.fetch(endpoint, {
    ...(args ? { args } : {}),
    ...(opts.symbol ? { symbol: opts.symbol } : {}),
    ...(opts.refresh ? { refresh: true } : {}),
  });
  const data_date = frDataDateOf(raw);
  if (useDayCache) {
    writeDayCache(cacheKey, { data_date, fetched_at: raw.fetched_at, cached_on: frTodayKey(), payload: raw });
  }
  return { envelope: raw.envelope, fetched_at: raw.fetched_at, cached: raw.cached, data_date, raw };
}

/** 数据日期：优先信封 extra.date（打板池），其次证据 period 里的最大日期，再退 fetched_at 的日期 */
export function frDataDateOf(res: FetchResult): string {
  const extra = (res.envelope.extra ?? {}) as Record<string, unknown>;
  const ed = extra.date;
  if (typeof ed === "string" && /^\d{4}-\d{2}-\d{2}/.test(ed)) return ed.slice(0, 10);
  const dates = (res.envelope.evidence ?? [])
    .map((e) => e.period)
    .filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}/.test(p))
    .map((p) => p.slice(0, 10))
    .sort();
  if (dates.length > 0) return dates[dates.length - 1] ?? frTodayKey();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(res.fetched_at ?? "");
  return m?.[1] ?? frTodayKey();
}

/* ---------------- 最近交易日回退 ---------------- */

export interface FrDateWalkResult {
  result: FrFetchResult;
  /** 取到数据的交易日 YYYY-MM-DD */
  tradeDate: string;
}

/** 最近交易日候选：从今天往回、跳过周末，最多 10 天（节假日靠「数据为空」自然跳过） */
export function frCandidateTradeDates(limit = 10): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < limit) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const p = (n: number) => String(n).padStart(2, "0");
      out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/**
 * 取「最近一个有数据的交易日」：当日无数据（盘前 / 非交易日 / 盘后未更新）自动回退前一交易日。
 * 当天缓存优先；真取数时逐日尝试，找到第一条 meaningful 的即停并写当天缓存。
 */
export async function fetchFrLatest(
  endpoint: string,
  argsFor: (dateYYYYMMDD: string) => Record<string, unknown>,
  meaningful: (envelope: Envelope) => boolean,
  opts: { refresh?: boolean } = {},
): Promise<FrDateWalkResult> {
  if (!opts.refresh) {
    const hit = readDayCache(endpoint);
    if (hit && meaningful(hit.payload.envelope)) {
      return {
        result: {
          envelope: hit.payload.envelope,
          fetched_at: hit.payload.fetched_at,
          cached: true,
          data_date: hit.data_date,
          raw: hit.payload,
        },
        tradeDate: hit.data_date,
      };
    }
  }
  let lastError: unknown = null;
  for (const iso of frCandidateTradeDates()) {
    try {
      const result = await fetchFr(endpoint, argsFor(iso.replace(/-/g, "")), { ...opts, dayCache: false });
      if (!meaningful(result.envelope)) continue;
      // 重试取到的新结果也写当天缓存：本次会话内后续加载直接读缓存，当天不再重复请求
      writeDayCache(endpoint, {
        data_date: result.data_date,
        fetched_at: result.fetched_at,
        cached_on: frTodayKey(),
        payload: result.raw,
      });
      return { result, tradeDate: iso };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${endpoint} 最近交易日无数据`);
}

/* ---------------- 解析：行情（tx_quotes_batch） ---------------- */

export interface FrQuote {
  code: string;
  name: string;
  price: number | null;
  chg: number | null;
  /** 昨收（元）：今日盈亏 =(现价-昨收)×qty 用 */
  lastClose: number | null;
}

/** 持仓行情：按用户当前持仓清单（loadHoldings）取现价/涨跌幅/昨收，不再写死 5 只。 */
export async function frHoldingsQuotes(refresh: boolean): Promise<{ dataDate: string; quotes: FrQuote[] }> {
  const holdings = loadHoldings();
  const codes = holdings.map((h) => h.code);
  const res = await fetchFr("tx_quotes_batch", { codes }, { refresh, dayCache: false });
  const rs = rows(res.envelope);
  const quotes: FrQuote[] = [];
  for (const code of codes) {
    const r = rs.find((x) => x.key === code);
    quotes.push({
      code,
      name: (r ? str(r.fields["security_name"]) : "") || holdings.find((h) => h.code === code)?.name || code,
      price: r ? num(r.fields["price"]) : null,
      chg: r ? num(r.fields["change_pct"]) : null,
      lastClose: r ? num(r.fields["last_close"]) : null,
    });
  }
  if (quotes.every((q) => q.price === null && q.chg === null)) throw new Error("行情为空");
  return { dataDate: res.data_date, quotes };
}

/* ---------------- 解析：情绪（em_limit_up_sentiment） ---------------- */

export interface FrSentiment {
  dataDate: string;
  zt: number;
  zb: number;
  dt: number;
  /** 炸板率 = 炸板 ÷（涨停 + 炸板），百分比整数（页面展示口径） */
  zhaRatePct: number;
  /** 情绪档（高 / 中 / 低） */
  lamp: string;
}

/** 情绪档：偏暖（≥60）/ 平稳（30-59）/ 偏冷（<30）。温度口径取涨停家数（当前唯一可得口径，页面展示用）。 */
export function frLampOf(zt: number): string {
  return zt >= 60 ? "偏暖" : zt >= 30 ? "平稳" : "偏冷";
}

export function parseSentiment(env: Envelope, dataDate: string): FrSentiment | null {
  const zt = num(scalar(env, "limit_up_count"));
  const zb = num(scalar(env, "break_board_count"));
  const dt = num(scalar(env, "limit_down_count"));
  if (zt === null && zb === null) return null;
  const z = zt ?? 0;
  const b = zb ?? 0;
  const d = dt ?? 0;
  const zhaRatePct = z + b > 0 ? Math.round((b / (z + b)) * 100) : 0;
  return { dataDate, zt: z, zb: b, dt: d, zhaRatePct, lamp: frLampOf(z) };
}

/* ---------------- 解析：涨停池 / 炸板池（em_zt_pool / em_zb_pool） ---------------- */

export interface FrZtStock {
  code: string;
  name: string;
  industry: string;
  /** 连板天数 */
  days: number;
  sealTime: string;
}

/**
 * 解析打板池 note："000498 山东路桥 基础建设 1天1板 首封 09:25:00"。
 * 名称可能含空格（如「七 匹 狼」），以「N天M板」为锚：其前一个是行业，
 * 再往前到代码之间的都是名称（去空格拼接）。
 */
function parsePoolNote(note: string): { name: string; industry: string; sealTime: string } {
  const parts = note.split(/\s+/);
  const sealTime = parts[parts.length - 1] ?? "";
  let statIdx = -1;
  for (let i = 1; i < parts.length; i++) {
    if (/^\d+天\d+板$/.test(parts[i] ?? "")) {
      statIdx = i;
      break;
    }
  }
  if (statIdx > 1) {
    return {
      name: parts.slice(1, statIdx - 1).join(""),
      industry: parts[statIdx - 1] ?? "",
      sealTime,
    };
  }
  return { name: parts[1] ?? "", industry: parts[2] ?? "", sealTime };
}

export function parseZtPool(env: Envelope): { count: number; stocks: FrZtStock[] } {
  const stocks: FrZtStock[] = [];
  for (const r of rows(env)) {
    const days = num(r.fields["pool_limit_days"]);
    if (days === null) continue;
    const { name, industry, sealTime } = parsePoolNote(r.note ?? "");
    stocks.push({ code: String(r.key), name, industry, days, sealTime });
  }
  const count = num(scalar(env, "limit_up_pool_count")) ?? stocks.length;
  return { count, stocks };
}

export interface FrZbStock {
  code: string;
  name: string;
  industry: string;
  /** 连板高度（note 里的「N天M板」的 M）；解析不出为 null */
  days: number | null;
  sealTime: string;
}

export function parseZbPool(env: Envelope): { total: number; rows: FrZbStock[] } {
  const list: FrZbStock[] = [];
  for (const r of rows(env)) {
    const { name, industry, sealTime } = parsePoolNote(r.note ?? "");
    // 连板高度在 note 的「N天M板」里（炸板池没有 pool_limit_days 字段）
    const m = /(\d+)天(\d+)板/.exec(r.note ?? "");
    list.push({
      code: String(r.key),
      name,
      industry,
      days: m ? Number(m[2]) : null,
      sealTime,
    });
  }
  const total = num(scalar(env, "break_board_pool_count")) ?? list.length;
  return { total, rows: list };
}

export interface FrLadderRow { t: string; n: number; }

/** 涨停梯队（首板→5板+），由涨停池逐股连板天数聚合 */
export function buildLadder(stocks: FrZtStock[]): FrLadderRow[] {
  const counts = new Map<number, number>();
  for (const s of stocks) counts.set(s.days, (counts.get(s.days) ?? 0) + 1);
  let fivePlus = 0;
  for (const [d, n] of counts) if (d >= 5) fivePlus += n;
  return [
    { t: "首板", n: counts.get(1) ?? 0 },
    { t: "2板", n: counts.get(2) ?? 0 },
    { t: "3板", n: counts.get(3) ?? 0 },
    { t: "4板", n: counts.get(4) ?? 0 },
    { t: "5板+", n: fivePlus },
  ];
}

/* ---------------- 解析：板块资金流（em_board_fund_flow） ---------------- */

/** 板块名 → 主力净流入（亿元，仅单位换算，展示用）。端点不可用时调用方拿到空 Map。 */
export function parseBoardFlow(env: Envelope): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows(env)) {
    const v = num(r.fields["board_main_net_today"]);
    if (v === null) continue;
    // note 形状："半导体 排名 1"
    const name = (r.note ?? "").replace(/\s*排名\s*\d+\s*$/, "").trim();
    if (!name) continue;
    map.set(name, Math.round((v / 1e8) * 100) / 100);
  }
  return map;
}

/* ---------------- 解析：涨停原因（ths_limit_up_pool） ---------------- */

/** 代码 → 涨停原因（题材） */
export function parseThsReasons(env: Envelope): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of env.evidence ?? []) {
    if (e.field !== "limit_up_reason" || e.record_key == null) continue;
    const v = str(e);
    if (v) map.set(String(e.record_key), v);
  }
  return map;
}

/* ---------------- 热度分与主线热度榜 ---------------- */

/**
 * 主线热度分。**与 calc/fundradar.py 的 heat_score 一致**：
 * 涨停家数×3 + 资金净流入(亿元)×2 + 最高连板×1，保留 1 位小数。
 * 后端 calc 工具白名单未含 heat_score（见 calc/tool.py 的 ALLOWED），故前端本地实现同一公式；
 * 后端开放 heat_score 后应改走 POST /tool/calc，避免两处口径分叉。
 */
export function frHeatScore(zt: number, flowYi: number, height: number): number {
  return Math.round((zt * 3 + flowYi * 2 + height) * 10) / 10;
}

export interface FrHeatRow {
  name: string;
  zt: number;
  height: number;
  /** 主力净流入（亿元）；板块资金端点不可用时为 null（页面显示「—」并按 0 计热度） */
  flow: number | null;
  hot: number;
  cover: boolean;
  /** 该板块覆盖的持仓名称（展示判断：板块含持仓代码，或名称命中持仓板块关键词） */
  coverNames: string[];
  /** 该板块最高连板股的涨停原因（ths_limit_up_pool）；不可用为 null */
  reason: string | null;
  /** 该板块最高连板股名称（涨停池映射）；无涨停池数据时为 null → 个股入口降级不可点 */
  topName: string | null;
  /** 该板块最高连板股代码（涨停池映射）；跳转 /stock/<code> 用 */
  topCode: string | null;
}

export function buildHeatRank(
  ztStocks: FrZtStock[],
  flowMap: Map<string, number>,
  reasonMap: Map<string, string>,
): FrHeatRow[] {
  const byIndustry = new Map<string, FrZtStock[]>();
  for (const s of ztStocks) {
    const ind = s.industry || "其他";
    const bucket = byIndustry.get(ind);
    if (bucket) bucket.push(s);
    else byIndustry.set(ind, [s]);
  }
  const out: FrHeatRow[] = [];
  for (const [name, stocks] of byIndustry) {
    const height = stocks.reduce((m, s) => Math.max(m, s.days), 0);
    const flow = flowMap.get(name) ?? null;
    const hot = frHeatScore(stocks.length, flow ?? 0, height);
    const codes = new Set(stocks.map((s) => s.code));
    const coverNames: string[] = [];
    for (const h of FR_HOLDING_META) {
      if (codes.has(h.code) || h.keywords.some((k) => name.includes(k))) coverNames.push(h.name);
    }
    const top = stocks.reduce((a, b) => (b.days > a.days ? b : a), stocks[0]!);
    out.push({
      name,
      zt: stocks.length,
      height,
      flow,
      hot,
      cover: coverNames.length > 0,
      coverNames,
      reason: reasonMap.get(top.code) ?? null,
      topName: top.name,
      topCode: top.code,
    });
  }
  out.sort((a, b) => b.hot - a.hot);
  return out.slice(0, 12);
}

/** 前 N 个主线板块覆盖的持仓名称（去重） */
export function frCoveredHoldings(heat: FrHeatRow[], topN = 5): string[] {
  const names: string[] = [];
  for (const r of heat.slice(0, topN)) {
    for (const n of r.coverNames) if (!names.includes(n)) names.push(n);
  }
  return names;
}

/* ---------------- 解析：龙虎榜（em_daily_dragon_tiger） ---------------- */

export interface FrLhbRow {
  code: string;
  name: string;
  reason: string;
  /** 净买额（亿元） */
  net: number;
  chg: number | null;
  /** 交易所官方备源只给「成交金额」原值（cjje，单位以交易所表头为准）；主源无此字段 = null */
  amount: string | null;
}

export interface FrLhbSummary {
  date: string;
  count: number;
  netBuyTotal: number;
  netSellTotal: number;
  topName: string;
  topNet: number;
}

export interface FrLhbLive {
  dataDate: string;
  rows: FrLhbRow[];
  summary: FrLhbSummary;
  /** true = 东财主源失败,降级到交易所官方备源(无净买额口径,仅成交金额 + 上榜原因) */
  backup: boolean;
}

/** 龙虎榜「有数据」判据（一键更新与页面共用同一口径，避免两处判断分叉）。 */
export const meaningfulLhb = (env: Envelope): boolean =>
  (env.evidence ?? []).some((e) => e.field === "dragon_tiger_market_net_buy" && e.value !== null && e.value !== "");

/** 交易所官方备源「有数据」判据：至少有一条深交所结构化上榜记录。 */
export const meaningfulLhbBackup = (env: Envelope): boolean =>
  (env.evidence ?? []).some((e) => e.field === "dragon_tiger_backup_code" && e.value !== null && e.value !== "");

export function parseLhb(env: Envelope): FrLhbRow[] {
  const list: FrLhbRow[] = [];
  for (const r of rows(env)) {
    const netWan = num(r.fields["dragon_tiger_market_net_buy"]);
    if (netWan === null) continue;
    const chg = num(r.fields["dragon_tiger_market_change_pct"]);
    const code = String(r.key).split("|")[0] ?? "";
    // note 形状："000592 平潭发展:日涨幅偏离值达到7%的前5只证券"
    const m = /^(\d{6})\s+([^:]+):(.*)$/.exec(r.note ?? "");
    list.push({
      code,
      name: m?.[2] ?? code,
      reason: m?.[3] ?? (r.note ?? ""),
      net: Math.round((netWan / 10000) * 100) / 100,
      chg,
      amount: null,
    });
  }
  list.sort((a, b) => b.net - a.net);
  return list;
}

export function summarizeLhb(rows: FrLhbRow[], date: string): FrLhbSummary {
  let buy = 0;
  let sell = 0;
  for (const r of rows) {
    if (r.net >= 0) buy += r.net;
    else sell -= r.net;
  }
  const top = rows[0];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    date,
    count: rows.length,
    netBuyTotal: r2(buy),
    netSellTotal: r2(sell),
    topName: top?.name ?? "",
    topNet: top?.net ?? 0,
  };
}

/** 解析交易所官方备源：只取深交所结构化行（code/name/reason/amount）；净买额无此口径 → net=0（页面按 backup 分支隐藏）。 */
export function parseLhbBackup(env: Envelope): FrLhbRow[] {
  const list: FrLhbRow[] = [];
  for (const r of rows(env)) {
    const code = str(r.fields["dragon_tiger_backup_code"]);
    if (!/^\d{6}$/.test(code)) continue;
    list.push({
      code,
      name: str(r.fields["dragon_tiger_backup_name"]) || code,
      reason: str(r.fields["dragon_tiger_backup_reason"]),
      net: 0,
      chg: null,
      amount: str(r.fields["dragon_tiger_backup_amount"]) || null,
    });
  }
  return list;
}

export async function loadLhbLive(refresh: boolean): Promise<FrLhbLive> {
  // 主源：东财全市场龙虎榜（datacenter-web，净买额 + 涨跌幅）
  try {
    const walk = await fetchFrLatest(
      "em_daily_dragon_tiger",
      (ymd) => ({ trade_date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` }),
      meaningfulLhb,
      { refresh },
    );
    const rowsParsed = parseLhb(walk.result.envelope);
    if (rowsParsed.length === 0) throw new Error("龙虎榜为空");
    return { dataDate: walk.tradeDate, rows: rowsParsed, summary: summarizeLhb(rowsParsed, walk.tradeDate), backup: false };
  } catch {
    /* 东财主源失败 → 落下一级：交易所官方备源 */
  }
  // 备源：交易所官方（深交所结构化 + 上交所全文），零鉴权；只给成交金额与上榜原因，无净买额
  const walk = await fetchFrLatest(
    "exchange_dragon_tiger",
    (ymd) => ({ trade_date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` }),
    meaningfulLhbBackup,
    { refresh },
  );
  const rowsParsed = parseLhbBackup(walk.result.envelope);
  if (rowsParsed.length === 0) throw new Error("龙虎榜官方备源为空");
  return { dataDate: walk.tradeDate, rows: rowsParsed, summary: summarizeLhb(rowsParsed, walk.tradeDate), backup: true };
}

/* ---------------- 解析：新闻（em_global_news 主 / rss_news 备） ---------------- */

export interface FrNewsItem {
  title: string;
  src: string;
  tag: string;
  /** MM-DD HH:MM（拿不到为空串） */
  time: string;
  hot: boolean;
  /** 摘要/正文（em_global_news 的 summary，约 120 字截断；拿不到为空串） */
  summary?: string;
  /** 原文链接（rss_news 的 link；拿不到为空串） */
  url?: string;
}

const RSS_TAG_LABELS: Record<string, string> = {
  ai: "AI", semi: "半导体", robot: "机器人", auto: "汽车", energy: "能源", bio: "医药",
  space: "航天", security: "安全", tech: "科技", consumer: "消费", macro: "宏观", science: "科学",
};

export function parseGlobalNews(env: Envelope): FrNewsItem[] {
  const out: FrNewsItem[] = [];
  for (const e of env.evidence ?? []) {
    if (e.field !== "market_news_title") continue;
    const title = str(e);
    if (!title) continue;
    const rk = String(e.record_key ?? "");
    // em_global_news 的 note 形如 "summary=……"（单键），摘要约 120 字截断；无 URL（取数层未提取文章链接）。
    const summary = /summary=([\s\S]*)$/.exec(e.note ?? "")?.[1]?.trim() ?? "";
    out.push({ title, src: "东财 7x24", tag: "全球", time: rk.split("|")[0]?.slice(5, 16) ?? "", hot: false, summary });
  }
  const first = out[0];
  if (first) first.hot = true;
  return out;
}

export function parseRssNews(env: Envelope): FrNewsItem[] {
  const out: FrNewsItem[] = [];
  for (const e of env.evidence ?? []) {
    if (e.field !== "news_title") continue;
    const title = str(e);
    if (!title) continue;
    const kv = noteKV(e.note);
    const redline = /(?:^|;)redline=([^;]+)/.exec(e.note ?? "");
    // rss_news 的 note 形如 "source=…;industry=…;link=…;redline=…"：有 link（原文 URL），无 summary（mapper 未透传摘要）。
    out.push({
      title,
      src: kv.source || "RSS 策展",
      tag: RSS_TAG_LABELS[kv.industry ?? ""] ?? "产业",
      time: typeof e.period === "string" ? e.period.replace(/^\d{4}-/, "") : "",
      hot: Boolean(redline?.[1]),
      url: kv.link ?? "",
    });
  }
  const first = out[0];
  if (first && !out.some((n) => n.hot)) first.hot = true;
  return out;
}

/** 全球要闻目标条数（首页/复盘页每页 10 条 ≈ 3 页；晨报生成复用同一取数、取前几条展示）。 */
export const FR_GLOBAL_NEWS_TARGET = 30;

/**
 * 全球要闻前 N 条：主源 em_global_news（东财 7x24）一次取满 FR_GLOBAL_NEWS_TARGET 条，
 * 不足 N 条时用备源 rss_news（策展源）补齐并按标题去重；两源都空抛错由页面降级。
 * - em_global_news 显式传 page_size（东财默认条数可能偏少），一次请求取够 30 条、不额外打上游；
 *   rss_news 只在主源不足 N 条时才打（限流意识，避免每次加载都拉一遍 RSS）。
 */
export async function frNews(n: number, refresh: boolean): Promise<FrNewsItem[]> {
  const merged: FrNewsItem[] = [];
  const seen = new Set<string>();
  const add = (items: FrNewsItem[]) => {
    for (const it of items) {
      const k = it.title.trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(it);
    }
  };
  try {
    const res = await fetchFr("em_global_news", { page_size: FR_GLOBAL_NEWS_TARGET }, { refresh });
    add(parseGlobalNews(res.envelope));
  } catch {
    /* 主源失败 → 落备源 */
  }
  if (merged.length < n) {
    try {
      const res = await fetchFr("rss_news", { max_sources: 12, per_source: 3, recent_days: 2 }, { refresh });
      add(parseRssNews(res.envelope));
    } catch {
      /* 两源都失败 → 抛给页面降级为示例 */
    }
  }
  if (merged.length > 0) return merged.slice(0, n);
  throw new Error("新闻源全部失败");
}

/* ---------------- 主线雷达核心（涨停池 + 炸板池 + 情绪 + 板块资金 + 涨停原因） ---------------- */

export interface FrRadarLive {
  dataDate: string;
  sentiment: FrSentiment;
  maxBoard: number | null;
  ladder: FrLadderRow[];
  heat: FrHeatRow[];
  zha: { total: number; rows: FrZbStock[] };
  flowAvailable: boolean;
  reasonsAvailable: boolean;
  /** 已降级的块名（板块资金 / 涨停原因 / 炸板池） */
  missing: string[];
}

/** 涨停池「有数据」判据（一键更新与页面共用同一口径）。 */
export const meaningfulZtPool = (env: Envelope): boolean =>
  (env.evidence ?? []).some((e) => e.record_key != null && e.field === "pool_limit_days");

/** 炸板池「有数据」判据（一键更新与页面共用同一口径）。 */
export const meaningfulZbPool = (env: Envelope): boolean =>
  (env.evidence ?? []).some((e) => e.record_key != null && e.field === "pool_break_times");

/** 情绪「有数据」判据（一键更新与页面共用同一口径）。 */
export const meaningfulSentiment = (env: Envelope): boolean =>
  (num(scalar(env, "limit_up_count")) ?? 0) > 0 || (num(scalar(env, "break_board_count")) ?? 0) > 0;

const meaningfulThs = (env: Envelope): boolean =>
  (num(scalar(env, "ths_limit_up_count")) ?? 0) > 0
  || (env.evidence ?? []).some((e) => e.field === "limit_up_reason");

export async function loadRadarCore(refresh: boolean): Promise<FrRadarLive | null> {
  let zt: { count: number; stocks: FrZtStock[] } | null = null;
  let zb: { total: number; rows: FrZbStock[] } | null = null;
  let sent: FrSentiment | null = null;
  let tradeDate = frTodayKey();
  try {
    const walk = await fetchFrLatest("em_zt_pool", (ymd) => ({ date: ymd }), meaningfulZtPool, { refresh });
    zt = parseZtPool(walk.result.envelope);
    tradeDate = walk.tradeDate;
  } catch {
    zt = null;
  }
  try {
    const walk = await fetchFrLatest("em_zb_pool", (ymd) => ({ date: ymd }), meaningfulZbPool, { refresh });
    zb = parseZbPool(walk.result.envelope);
  } catch {
    zb = null;
  }
  try {
    const walk = await fetchFrLatest("em_limit_up_sentiment", (ymd) => ({ date: ymd }), meaningfulSentiment, { refresh });
    sent = parseSentiment(walk.result.envelope, walk.tradeDate);
    if (!sent) throw new Error("情绪为空");
  } catch {
    sent = null;
  }
  // 核心取数失败（涨停池 / 情绪）→ 返回 null，页面整体降级为示例数据
  if (!zt || !sent) return null;

  const missing: string[] = [];
  let flowMap = new Map<string, number>();
  try {
    const f = await fetchFr("em_board_fund_flow", { board_type: "industry", period: "today", top_n: 500 }, { refresh });
    flowMap = parseBoardFlow(f.envelope);
  } catch {
    missing.push("板块资金");
  }
  let reasonMap = new Map<string, string>();
  try {
    const t = await fetchFrLatest("ths_limit_up_pool", (ymd) => ({ date: ymd }), meaningfulThs, { refresh });
    reasonMap = parseThsReasons(t.result.envelope);
  } catch {
    missing.push("涨停原因");
  }
  if (!zb) missing.push("炸板池");

  const heat = buildHeatRank(zt.stocks, flowMap, reasonMap);
  const ladder = buildLadder(zt.stocks);
  const maxBoard = zt.stocks.length > 0 ? zt.stocks.reduce((m, s) => Math.max(m, s.days), 0) : null;
  return {
    dataDate: tradeDate,
    sentiment: sent,
    maxBoard,
    ladder,
    heat,
    zha: zb ?? { total: 0, rows: [] },
    flowAvailable: flowMap.size > 0,
    reasonsAvailable: reasonMap.size > 0,
    missing,
  };
}

/* ---------------- 各页数据装配 ---------------- */

export interface FrHomeLive {
  dataDate: string;
  quotes: FrQuote[];
  radar: FrRadarLive | null;
  news: FrNewsItem[] | null;
  missing: string[];
}

export async function loadHomeLive(refresh: boolean): Promise<FrHomeLive | null> {
  let quotes: FrQuote[] | null = null;
  try {
    quotes = (await frHoldingsQuotes(refresh)).quotes;
  } catch {
    quotes = null;
  }
  if (!quotes || quotes.length === 0) return null; // 核心失败 → 整页示例
  const radar = await loadRadarCore(refresh);
  let news: FrNewsItem[] | null = null;
  try {
    news = await frNews(FR_GLOBAL_NEWS_TARGET, refresh);
  } catch {
    news = null;
  }
  const missing: string[] = [];
  if (!radar) missing.push("情绪与主线");
  if (!news) missing.push("全球要闻");
  return { dataDate: radar?.dataDate ?? frTodayKey(), quotes, radar, news, missing };
}

export interface FrPortfolioLive {
  dataDate: string;
  quotes: FrQuote[];
  radar: FrRadarLive | null;
  missing: string[];
}

export async function loadPortfolioLive(refresh: boolean): Promise<FrPortfolioLive | null> {
  let quotes: FrQuote[] | null = null;
  try {
    quotes = (await frHoldingsQuotes(refresh)).quotes;
  } catch {
    quotes = null;
  }
  if (!quotes || quotes.length === 0) return null; // 核心失败 → 整页示例
  const radar = await loadRadarCore(refresh);
  const missing: string[] = [];
  if (!radar) missing.push("今日情绪");
  return { dataDate: radar?.dataDate ?? frTodayKey(), quotes, radar, missing };
}

export interface FrReviewLive {
  dataDate: string;
  radar: FrRadarLive;
  lhb: FrLhbLive | null;
  news: FrNewsItem[] | null;
  missing: string[];
}

export async function loadReviewLive(refresh: boolean): Promise<FrReviewLive | null> {
  const radar = await loadRadarCore(refresh);
  if (!radar) return null; // 核心失败 → 整页示例
  let lhb: FrLhbLive | null = null;
  try {
    lhb = await loadLhbLive(refresh);
  } catch {
    lhb = null;
  }
  let news: FrNewsItem[] | null = null;
  try {
    news = await frNews(FR_GLOBAL_NEWS_TARGET, refresh);
  } catch {
    news = null;
  }
  const missing: string[] = [];
  if (!lhb) missing.push("龙虎榜摘要");
  if (!news) missing.push("晨报要闻");
  return { dataDate: radar.dataDate, radar, lhb, news, missing };
}

/* ---------------- 加载态 Hook ---------------- */

/**
 * 数据已更新事件（window 自定义事件）：「一键更新数据」成功取到至少一项后派发，
 * 在屏页面的 useFrLoader 监听到后以 refresh=false 重取 —— 盘后数据直接读刚写入的
 * 当天缓存、行情读后端刚刷新过的快照，不重复打上游。
 */
export const FR_DATA_REFRESHED = "fr-data-refreshed";

/**
 * 数据刷新轻反馈：一键更新（fr-data-refreshed）完成后，给在屏数据卡片一个
 * 极淡高亮 flash（opacity 1→0.85→1，300ms，一次性）。通过移除/重排/加回
 * .fr-data-flash 类保证连续刷新也能重新触发；动画本身有限时长、不循环。
 */
export function flashDataCards(): void {
  if (typeof document === "undefined") return;
  const cards = document.querySelectorAll<HTMLElement>("[data-fr-page] .fr-glass");
  cards.forEach((el) => {
    el.classList.remove("fr-data-flash");
    void el.offsetWidth; // 强制重排，确保连续刷新也能重新触发动画
    el.classList.add("fr-data-flash");
    window.setTimeout(() => el.classList.remove("fr-data-flash"), 320);
  });
}

/**
 * 最近一次「更新成功」的本地时间戳（ISO 字符串）。
 * 由「一键更新」fundradarUpdate 与「盘中自动刷新」fundradarAutoRefresh 在成功时写入；
 * 首页状态指示器 / 顶栏徽标 / 设置页共用它显示「数据已更新至 HH:MM」。
 */
export const FR_LAST_REFRESH_KEY = "fr-last-refresh";

export interface FrLoaderState<T> {
  loading: boolean;
  live: T | null;
  failed: boolean;
  /** 点击重试：强制后端真取一次（跳过前端当天缓存与后端快照） */
  retry: () => void;
}

/**
 * 页面取数 Hook：挂载即取（refresh=false 走当天缓存），失败 → live=null 由页面降级；
 * 重试按钮 → refresh=true 强制真取。所有异常都在 loader 内部收口（返回 null），
 * 页面据此渲染示例数据 + 提示，绝不因取数异常白屏。
 * 另外监听 fr-data-refreshed：一键更新数据完成后在屏页面自动重取（refresh=false），
 * 从刚写入的当天缓存/后端新快照读到新数据。
 */
export function useFrLoader<T>(load: (refresh: boolean) => Promise<T | null>): FrLoaderState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  // 数据更新事件触发的重取代数（与 attempt 分开：事件重取走缓存，不算用户强刷）
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<{ loading: boolean; live: T | null; failed: boolean }>({
    loading: true,
    live: null,
    failed: false,
  });
  useEffect(() => {
    const onDataRefreshed = () => {
      setEpoch((e) => e + 1);
      // 数据刷新轻反馈：稍等缓存重取落地后给在屏数据卡片极淡高亮（一次性）
      window.setTimeout(flashDataCards, 380);
    };
    window.addEventListener(FR_DATA_REFRESHED, onDataRefreshed);
    return () => window.removeEventListener(FR_DATA_REFRESHED, onDataRefreshed);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, failed: false }));
    loadRef.current(attempt > 0)
      .then((v) => {
        if (!cancelled) setState({ loading: false, live: v, failed: v === null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, live: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, epoch]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}

/* ---------------- 日期文案 ---------------- */

/** "2026-09-25" → "2026-09-25 周五" */
export function frDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()] ?? "";
  return `${iso} ${wd}`;
}

/** "2026-09-25" → "9月25日 周五" */
export function frDateCn(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()] ?? "";
  return `${Number(m[2])}月${Number(m[3])}日 ${wd}`;
}
