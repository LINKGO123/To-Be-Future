/**
 * 资金雷达工作台 · 个股详情页取数层（/stock/:code）
 * ------------------------------------------------------------------
 * 复用 lib/fundradarData.ts 的 fetchFr 机制（当天缓存 / 后端快照 / 信封证据）。
 * 本页需要的每个区块各自取数、各自降级，**任何一块失败都不拖垮整页**：
 *
 * ① 头卡：tx_quotes_batch（现价/涨跌幅/名称/换手/量比）+ em_concept_blocks（板块归属）
 * ② K 线：fetch_kline（日 K 前复权）。信封只有「最新收盘 + 条数 + 起止」（序列在底座 raw 文件），
 *    → 蜡烛全序列经 /api/fetch-raw 接缝读 raw 的腾讯 qfqday 序列（前端与底座已批复开放该路由；
 *    未开放 / 读不到 → 块级降级为「最新收盘摘要 + 序列未开放说明」，不编数据）。
 *    分时：tdx_bars(frequency=8 一分钟) 失败 → 降级腾讯分钟 K（ifzq.gtimg.cn 零鉴权不封 IP）；
 *    两者都失败 → 隐藏分时标签并说明。
 * ③ 资金流向（四维）降级链：em_fund_flow_minute（分钟，当日累计 main/super/large，
 *    中单/小单经 raw 接缝补读）→ em_fund_flow_120d（push2his 本机不通，失败属预期）→
 *    akshare_fund_flow_120d（akshare 直连东财 120 日四维，含中单/小单；底层同 push2his，封 IP 时失败属预期）→
 *    sina_fund_flow（日度：主力 netamount + 超大单 r0_net + 收盘 trade + 净流入率 ratioamount，
 *    大单 = 主力 − 超大单 推导，中单/小单不可得）→ 全部失败由页面渲染示例数据 + 「资金数据暂不可用」。
 *    5 日 / 20 日合计与趋势曲线 / 强度指标需要日序列：优先 em_fund_flow_120d raw（四维日序列），
 *    备 sina raw（主力 + 超大单日序列）；都读不到 → 该项显示「—」并说明。
 * ④ 龙虎榜：em_dragon_tiger（个股近 30 日上榜次数 + 逐条原因/净买额 + 最新一日席位 extra.seats）
 * ⑤ AI 解读：页面按钮写 sessionStorage 后跳 /agent-chat（预填输入框）。
 *
 * 红线：只展示端点证据与 raw 原始序列；周/月聚合与指标为展示层确定性变换（纯函数在
 * fundradarIndicators.ts，口径注释齐备），不产出研究报告数字。
 */
import { FR_HOLDING_META, fetchFr, frDataDateOf, frTodayKey } from "./fundradarData";
import { isHolding } from "./fundradarPortfolio";
import { backend, num, noteKV, round2, rows, scalar, str, type Envelope } from "./backend";
import type { KlineBar } from "./fundradarIndicators";

/* ---------------- raw 接缝（底座 /api/fetch-raw，Bearer 由 Vite 代理注入） ---------------- */

/**
 * 读一条证据 raw_ref 指向的原始响应文件（底座 .local/mcp/<session>/raw/）。
 * 接缝路由未开放 / 形状非法 / 文件不存在 → 抛错，调用方按「序列不可读」降级。
 * 前端对 raw 内容只做**本页需要的最小解析**（K 线数组、资金流数组），
 * 这些解析器与取数层脚本的读取口径逐字段对齐（见各 parse 函数注释）。
 */
export async function fetchFrRaw(rawRef: string | null | undefined, session = "default"): Promise<unknown> {
  if (!rawRef) throw new Error("无 raw_ref");
  const normalized = rawRef.replace(/\\/g, "/");
  if (!/^raw\/[^/\x00-\x1f\x7f]{1,200}$/.test(normalized)) throw new Error(`raw_ref 形状非法:${rawRef}`);
  const res = await fetch(`/api/fetch-raw?ref=${encodeURIComponent(normalized)}&session=${encodeURIComponent(session)}`);
  if (!res.ok) throw new Error(`fetch-raw HTTP ${res.status}`);
  // 底座 GET /fetch-raw 的契约：JSON 信封 { ok, ref, session, size, content }，
  // content 是 raw 文件的原文字符串 —— 若原文本身是 JSON 再解一层。
  const envelope = (await res.json()) as { ok?: boolean; content?: unknown };
  const content = envelope?.content;
  if (typeof content !== "string") return content ?? null;
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(content) as unknown;
    } catch {
      return content; // 半截/非标准 JSON：按原文返回，解析器自会因形状不符得到空
    }
  }
  return content;
}

/** 信封里某个 field 的证据的 raw_ref（单标的端点一般只有一条） */
function rawRefOf(env: Envelope, field: string): string | null {
  const e = (env.evidence ?? []).find((x) => x.field === field && typeof x.raw_ref === "string" && x.raw_ref.length > 0);
  return e?.raw_ref ?? null;
}

/* ---------------- 名称/代码 → 6 位 A 股代码（报告页与首页共用） ---------------- */

/** 端点目录（CATALOG）模块级缓存：只读一次，失败记空（名称搜索据此降级为「输代码」） */
let catalogPromise: Promise<{ id: string; enabled: boolean }[]> | null = null;
function endpointCatalog(): Promise<{ id: string; enabled: boolean }[]> {
  catalogPromise ??= backend
    .endpoints()
    .then((list) => list.map((e) => ({ id: e.id, enabled: e.enabled !== false })))
    .catch(() => []);
  return catalogPromise;
}

/**
 * 名称 / 6 位代码 → { code, name }：
 * - 6 位数字直接作为代码（name 留空，由行情端点补名）；
 * - 中文名称先查本地持仓档案（持仓名已知代码）；
 * - 再读 CATALOG 走 iwencai_query 名称解析（需 IWENCAI_API_KEY，未配置属预期）；
 * - 都不可用 → 返回 null，调用方提示「请输入 6 位 A 股代码」，不编结果。
 */
export async function resolveStockCode(input: string): Promise<{ code: string; name: string } | null> {
  const t = input.trim();
  if (!t) return null;
  if (/^\d{6}$/.test(t)) return { code: t, name: "" };
  const meta = FR_HOLDING_META.find((h) => h.name === t);
  if (meta) return { code: meta.code, name: meta.name };
  try {
    const eps = await endpointCatalog();
    if (!eps.some((e) => e.id === "iwencai_query" && e.enabled)) return null;
    const res = await fetchFr("iwencai_query", { query: `${t} 股票代码`, limit: 5 }, { dayCache: false });
    for (const e of res.envelope.evidence ?? []) {
      if (e.field !== "iwencai_query_row" || typeof e.value !== "string") continue;
      try {
        const row = JSON.parse(e.value) as Record<string, unknown>;
        for (const v of Object.values(row)) {
          if (typeof v === "string" && /^\d{6}$/.test(v.trim())) return { code: v.trim(), name: t };
        }
      } catch {
        /* 该行截断/非对象：跳过，看下一行 */
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* ---------------- ① 头卡：行情 + 板块 ---------------- */

export interface FrStockQuote {
  code: string;
  name: string;
  price: number | null;
  chg: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  lastClose: number | null;
  /** 换手率 % */
  turnover: number | null;
  /** 量比（倍） */
  volRatio: number | null;
  /** 总市值（亿元） */
  mcap: number | null;
  asOf: string;
}

export async function loadStockQuote(code: string, refresh: boolean): Promise<FrStockQuote> {
  const res = await fetchFr("tx_quotes_batch", { codes: [code] }, { refresh, dayCache: false });
  const r = rows(res.envelope).find((x) => x.key === code);
  const f = r?.fields ?? {};
  return {
    code,
    name: (r ? str(f["security_name"]) : "") || code,
    price: r ? num(f["price"]) : null,
    chg: r ? num(f["change_pct"]) : null,
    open: r ? num(f["open"]) : null,
    high: r ? num(f["high"]) : null,
    low: r ? num(f["low"]) : null,
    lastClose: r ? num(f["last_close"]) : null,
    turnover: r ? num(f["turnover_rate"]) : null,
    volRatio: r ? num(f["volume_ratio"]) : null,
    mcap: r ? num(f["market_cap"]) : null,
    asOf: frDataDateOf(res.raw),
  };
}

/** 板块归属（em_concept_blocks 的 board_membership 证据 value，取前 N 个去重） */
export async function loadStockBoards(code: string, refresh: boolean, topN = 3): Promise<string[]> {
  const res = await fetchFr("em_concept_blocks", {}, { refresh, symbol: code });
  const names: string[] = [];
  for (const e of res.envelope.evidence ?? []) {
    if (e.field !== "board_membership") continue;
    const v = str(e);
    if (v && !names.includes(v)) names.push(v);
    if (names.length >= topN) break;
  }
  return names;
}

/* ---------------- ② K 线 ---------------- */

export interface FrKlineLive {
  /** 最后一根 K 线日期 */
  dataDate: string;
  /** 信封口径：合格行数 */
  bars: number;
  start: string;
  end: string;
  latestClose: number | null;
  /** 蜡烛全序列（raw 接缝可用时）；null = 序列未开放，页面降级显示摘要 */
  daily: KlineBar[] | null;
  source: string;
  /** 序列是否来自底座 raw（true 才能画蜡烛/指标） */
  seriesOk: boolean;
}

/**
 * 腾讯 fqkline raw 解析：data.<sh|sz><code>.qfqday（或 .day）=
 * [date, open, close, high, low, vol]，与 fetch_kline.py src_tencent 的列序一致。
 * 北交所（8/4 开头）腾讯 fqkline 无对应键 → 返回空。
 */
export function parseTxKlineRaw(raw: unknown, code: string): KlineBar[] {
  const prefix = code.startsWith("6") ? "sh" : code.startsWith("0") || code.startsWith("3") ? "sz" : null;
  if (!prefix) return [];
  const data = (raw as { data?: Record<string, { qfqday?: unknown; day?: unknown }> } | null)?.data?.[`${prefix}${code}`];
  const arr = (data?.qfqday ?? data?.day ?? []) as unknown[];
  const out: KlineBar[] = [];
  for (const k of arr) {
    if (!Array.isArray(k) || k.length < 6) continue;
    const d = String(k[0] ?? "").slice(0, 10);
    const o = Number(k[1]);
    const c = Number(k[2]);
    const h = Number(k[3]);
    const l = Number(k[4]);
    const v = Number(k[5]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || ![o, c, h, l, v].every(Number.isFinite)) continue;
    out.push({ date: d, open: o, close: c, high: h, low: l, volume: v });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * baostock 前复权日 K raw（extracted JSON）解析：{query, rows:[{date,open,high,low,close,volume,turn,tradestatus}]}，
 * 与 baostock_src.baostock_kdata 的落盘形状一致；只取 tradestatus=1（交易）行。
 */
export function parseBsKlineRaw(raw: unknown): KlineBar[] {
  const rowsArr = (raw as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rowsArr)) return [];
  const out: KlineBar[] = [];
  for (const r of rowsArr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (String(o["tradestatus"] ?? "") !== "1") continue;
    const date = String(o["date"] ?? "").slice(0, 10);
    const open = Number(o["open"]);
    const close = Number(o["close"]);
    const high = Number(o["high"]);
    const low = Number(o["low"]);
    const volume = Number(o["volume"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ![open, close, high, low, volume].every(Number.isFinite)) continue;
    out.push({ date, open, close, high, low, volume });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function loadStockKline(code: string, refresh: boolean): Promise<FrKlineLive> {
  // fetch_kline 是 legacy 端点：默认 250 根前复权日 K，不接受 args；主源腾讯，失败再落备源 bs_kline_qfq。
  let res;
  let primary = "";
  try {
    res = await fetchFr("fetch_kline", {}, { refresh, symbol: code });
    primary = typeof res.envelope.primary_source === "string" ? res.envelope.primary_source : "";
  } catch {
    // 备源：baostock 前复权日 K（extracted raw rows）
    res = await fetchFr("bs_kline_qfq", {}, { refresh, symbol: code });
    primary = "baostock";
  }
  const env = res.envelope;
  const extra = (env.extra ?? {}) as Record<string, unknown>;
  const latest = num(scalar(env, "close_qfq_latest"));
  const bars = num(scalar(env, "kline_points"));
  const start = typeof extra.start === "string" ? extra.start : "";
  const end = typeof extra.end === "string" ? extra.end : "";
  let daily: KlineBar[] | null = null;
  let seriesOk = false;
  try {
    const ref = primary === "baostock"
      ? rawRefOf(env, "kline_close_qfq_latest")
      : rawRefOf(env, "close_qfq_latest");
    const raw = await fetchFrRaw(ref);
    const parsed = primary === "baostock" ? parseBsKlineRaw(raw) : parseTxKlineRaw(raw, code);
    if (parsed.length > 0) {
      daily = parsed;
      seriesOk = true;
    }
  } catch {
    daily = null; // 序列未开放 / raw 不可读：降级为摘要
  }
  return {
    dataDate: end || (daily?.[daily.length - 1]?.date ?? res.data_date),
    bars: bars ?? daily?.length ?? 0,
    start,
    end,
    latestClose: latest,
    daily,
    source: `fetch_kline(${primary}${seriesOk ? " raw 序列" : " 信封摘要"})${primary === "baostock" ? " ← bs_kline_qfq 备源" : ""}`,
    seriesOk,
  };
}

/* ---------------- 分时（专业模式懒探测：tdx_bars → 腾讯分钟 K 降级） ---------------- */

export interface FrIntraday {
  /** 一分钟价格序列 */
  minutes: KlineBar[] | null;
  source: string;
  note: string;
}

/** 主源：tdx_bars 一分钟（mootdx 已死返回空 / 本机断连超时）→ 解析 raw 序列；失败/空返回 null。 */
async function loadTdxMinute(code: string): Promise<KlineBar[] | null> {
  try {
    // frequency=8 一分钟（mootdx_src.tdx_bars 口径）；mootdx 在本机网络超时属预期。
    // 给 tdx_bars 一个 8s 上限：它若挂死会吃掉整段探测时间，导致腾讯备源永远没机会跑。
    const res = await Promise.race([
      fetchFr("tdx_bars", { frequency: 8, offset: 240 }, { refresh: false, dayCache: false, symbol: code }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("tdx_bars 超时")), 8_000)),
    ]);
    // 信封 extra.last3 只有最后 3 根 → 全序列需 raw 接缝（extracted JSON {rows:[{datetime|date,open,high,low,close,volume}]}）
    const ref = rawRefOf(res.envelope, "tdx_close_unadjusted");
    const raw = (await fetchFrRaw(ref)) as { rows?: unknown[] } | null;
    const rowsArr = raw?.rows ?? [];
    const out: KlineBar[] = [];
    for (const r of rowsArr) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      // 分钟序列保留 HH:MM（date 形如 "YYYY-MM-DD HH:MM"），分时图按时间画横轴
      const d = String(o["datetime"] ?? o["date"] ?? "").slice(0, 16);
      const open = Number(o["open"]);
      const close = Number(o["close"]);
      const high = Number(o["high"]);
      const low = Number(o["low"]);
      const volume = Number(o["volume"]);
      if (!/^\d{4}-\d{2}-\d{2}/.test(d) || ![open, close, high, low, volume].every(Number.isFinite)) continue;
      out.push({ date: d, open, close, high, low, volume });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * 备源：腾讯分钟分时（ifzq.gtimg.cn/appstock/app/minute/query，零鉴权、CORS *、
 * 不封 IP，见 a-stock-data「备用源速查」）。响应形状：
 *   data.<sh|sz><code>.data.data = ["HHMM price 累计量(手) 累计额(元)", ...]（时间升序）
 *   data.<sh|sz><code>.data.date = "YYYYMMDD"
 * 每点 price 为该分钟成交价；第 4 字段是累计成交额（元 = price × 累计量(手) × 100），
 * 分时图成交量用「本分钟量 = 相邻累计量之差」还原（不直接用累计量，避免画出单调递增的假量柱）。
 */
export async function loadStockMinute(code: string): Promise<FrIntraday> {
  const prefix = code.startsWith("6") ? "sh"
    : code.startsWith("0") || code.startsWith("3") ? "sz"
    : code.startsWith("8") || code.startsWith("4") ? "bj"
    : null;
  if (!prefix) throw new Error("该市场代码不支持腾讯分时");
  const url = `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${prefix}${code}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`腾讯分时 HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    data?: Record<string, { data?: { data?: string[]; date?: string } }>;
  };
  const node = json.data?.[`${prefix}${code}`];
  const lines = node?.data?.data ?? [];
  const ymd = node?.data?.date ?? "";
  const day = /^\d{8}$/.test(ymd)
    ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
    : frTodayKey();
  const minutes: KlineBar[] = [];
  let prevCumVol = 0;
  for (const line of lines) {
    const m = /^(\d{2})(\d{2})\s+([\d.]+)\s+(\d+)/.exec(line.trim());
    if (!m) continue;
    const hh = m[1]!;
    const mm = m[2]!;
    const price = Number(m[3]);
    const cumVol = Number(m[4]);
    if (!Number.isFinite(price) || !Number.isFinite(cumVol)) continue;
    // 本分钟成交量 = 相邻累计量之差（首根用首根累计量；异常回退 0，不为负）
    const vol = minutes.length === 0 ? cumVol : cumVol - prevCumVol;
    minutes.push({
      date: `${day} ${hh}:${mm}`,
      open: price, close: price, high: price, low: price,
      volume: vol >= 0 ? vol : 0,
    });
    prevCumVol = cumVol;
  }
  if (minutes.length === 0) throw new Error("腾讯分时无数据");
  return {
    minutes,
    source: "tx_minute（腾讯分钟分时，零鉴权）",
    note: `共 ${minutes.length} 个分钟点（腾讯 ifzq.gtimg.cn）`,
  };
}

/** 分时取数：tdx_bars 失败时降级腾讯分钟 K；两者都失败返回空分钟序列（页面隐藏分时标签）。 */
export async function loadStockIntraday(code: string): Promise<FrIntraday> {
  // 主源：tdx_bars 一分钟（mootdx 已死 → 通常空/超时）
  const tdx = await loadTdxMinute(code);
  if (tdx) return { minutes: tdx, source: "tdx_bars(1分)", note: `共 ${tdx.length} 个分钟点` };
  // 备源：腾讯分钟 K（零鉴权不封 IP）
  try {
    return await loadStockMinute(code);
  } catch {
    /* 两个源都失败 → 空，页面隐藏分时标签 */
  }
  return { minutes: null, source: "", note: "分时不可用：tdx_bars 与腾讯分钟 K 均未取到。" };
}

/* ---------------- ③ 资金流向（四维 + 降级链） ---------------- */

/** 五档净流入（元）；null = 该源不提供该档 */
export interface FrFlowDims {
  main: number | null;
  superLarge: number | null;
  large: number | null;
  mid: number | null;
  small: number | null;
  /** 数据时点（当日累计至 / 日度日期） */
  asOf: string;
}

/** 资金流日序列单点（按日期升序）；趋势曲线与强度指标共用口径 */
export interface FrFlowPoint {
  date: string;
  /** 主力净流入（元）= 超大单 + 大单 */
  main: number;
  /** 超大单净流入（元）；null = 该源不提供 */
  superLarge: number | null;
  /** 大单净流入（元）= 主力 − 超大单；null = 无法推导 */
  large: number | null;
  /** 中单净流入（元）；null = 该源不提供（新浪不提供中单/小单） */
  mid: number | null;
  /** 小单净流入（元）；null = 该源不提供 */
  small: number | null;
  /** 收盘价（元）：新浪 raw trade 字段；东财 120d 无 → null（趋势图用 K 线补） */
  close: number | null;
  /** 主力净流入率（新浪 ratioamount，小数 = 主力净流入 ÷ 成交额）；无 → null */
  ratio: number | null;
}

export interface FrFlowLive {
  /** 当日（最新交易日）五档 */
  today: FrFlowDims | null;
  /** 5 日主力净流入合计（元；仅日序列可得） */
  sum5: number | null;
  /** 20 日主力净流入合计（元；仅日序列可得） */
  sum20: number | null;
  /** 5 日五档合计（元；null 档 = 该源不提供） */
  dims5: FrFlowDims | null;
  /** 20 日五档合计（元；null 档 = 该源不提供） */
  dims20: FrFlowDims | null;
  /** 日序列（升序）；趋势曲线 + 强度指标用；为空 = 日序列不可得 */
  series: FrFlowPoint[];
  /** 当前生效的源（降级链命中的那一级） */
  source: string;
  note: string;
  /** 序列是否可得（决定 5日/20日 是否显示「—」） */
  seriesOk: boolean;
  /** 命中分钟源（盘中每 5 分钟刷新当日值的判据） */
  intraday: boolean;
}

/** 连续流入/流出：从日序列尾部逐日取符号（正=流入，负=流出，0=中性不计入也不延续） */
export interface FrConsecutiveFlow {
  dir: "in" | "out" | null;
  days: number;
}

export function consecutiveFlow(series: { main: number }[]): FrConsecutiveFlow {
  if (series.length === 0) return { dir: null, days: 0 };
  const sign = (v: number): 1 | -1 | 0 => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const last = sign(series[series.length - 1]!.main);
  if (last === 0) return { dir: null, days: 0 };
  let days = 0;
  for (let i = series.length - 1; i >= 0 && sign(series[i]!.main) === last; i--) days++;
  return { dir: last > 0 ? "in" : "out", days };
}

/**
 * 当日主力净占比（小数）：优先新浪 ratioamount（= 主力净流入 ÷ 成交额，与任务口径一致），
 * 无 ratio 时兜底 = 主力 ÷（K 线 volume×100×close；腾讯 vol 为「手」、1 手=100 股，近似成交额）。
 * 都不可得 → null（页面显示「—」并注明）。
 */
export function mainNetRatio(
  point: FrFlowPoint | undefined,
  klineBar: { close: number; volume: number } | undefined,
): number | null {
  if (!point) return null;
  if (point.ratio != null && Number.isFinite(point.ratio)) return point.ratio;
  const close = klineBar?.close;
  const amount = close != null && Number.isFinite(close) && klineBar?.volume != null && Number.isFinite(klineBar.volume)
    ? klineBar.volume * 100 * close
    : NaN;
  if (!Number.isFinite(amount) || amount === 0) return null;
  return point.main / amount;
}

/** 东财分钟资金流 raw：data.klines 逗号行 = time, main, small, mid, large, super（当日累计，元） */
export function parseEmMinuteFlowRaw(raw: unknown): {
  time: string; main: number; small: number; mid: number; large: number; superLarge: number;
}[] {
  const lines = (raw as { data?: { klines?: unknown } } | null)?.data?.klines;
  const out: { time: string; main: number; small: number; mid: number; large: number; superLarge: number }[] = [];
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const p = String(line).split(",");
    if (p.length < 6) continue;
    const vals = p.slice(1, 6).map((x) => Number(x));
    if (!vals.every(Number.isFinite)) continue;
    out.push({ time: p[0] ?? "", main: vals[0]!, small: vals[1]!, mid: vals[2]!, large: vals[3]!, superLarge: vals[4]! });
  }
  return out;
}

/** 东财 120 日资金流 raw：data.klines 逗号行 = date, main, small, mid, large, super, …（元/日） */
export function parseEm120dFlowRaw(raw: unknown): {
  date: string; main: number; small: number; mid: number; large: number; superLarge: number;
}[] {
  const lines = (raw as { data?: { klines?: unknown } } | null)?.data?.klines;
  const out: { date: string; main: number; small: number; mid: number; large: number; superLarge: number }[] = [];
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const p = String(line).split(",");
    if (p.length < 6) continue;
    const vals = p.slice(1, 6).map((x) => (x === "-" || x === "" ? 0 : Number(x)));
    if (!vals.every(Number.isFinite)) continue;
    out.push({ date: p[0] ?? "", main: vals[0]!, small: vals[1]!, mid: vals[2]!, large: vals[3]!, superLarge: vals[4]! });
  }
  return out;
}

/**
 * 新浪资金流 raw：响应带前缀（var/注释等），数组段 = 首 '[' 到末 ']'，与 sina.py 的截取口径一致。
 * 单点字段（实测全字段）：opendate=日期、trade=收盘价、changeratio=涨跌幅(小数)、
 * netamount=主力净流入(元)、ratioamount=主力净流入率(小数, =netamount/成交额)、r0_net=超大单净流入(元)、
 * r0_ratio=超大单净流入率；另含 r0x_ratio / cnt_r0x_ratio / cate_ra / cate_na 等统计字段。
 * 无 r1/r2/r3（大单/中单/小单）→ 大单 = 主力 − 超大单 推导，中单/小单不可得。
 */
export function parseSinaFlowRaw(raw: unknown): FrFlowPoint[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.indexOf("[");
    const e = raw.lastIndexOf("]");
    if (s < 0 || e <= s) return [];
    try {
      arr = JSON.parse(raw.slice(s, e + 1)) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: FrFlowPoint[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const date = String(o["opendate"] ?? "").slice(0, 10);
    const main = Number(o["netamount"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(main)) continue;
    const superLarge = Number(o["r0_net"]);
    const close = Number(o["trade"]);
    const ratio = Number(o["ratioamount"]);
    out.push({
      date,
      main,
      superLarge: Number.isFinite(superLarge) ? superLarge : null,
      large: Number.isFinite(superLarge) ? main - superLarge : null,
      mid: null,
      small: null,
      close: Number.isFinite(close) ? close : null,
      ratio: Number.isFinite(ratio) ? ratio : null,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * akshare 个股资金流 raw（extracted JSON，由 sources/akshare.py record_raw 落盘）：
 * [{date, main_net, small_net, mid_net, large_net, super_net, close, change_pct}]（元）。
 * 与东财 120d 同口径四维，只是序列本身为 JSON 数组而非 push2 的 data.klines 逗号行。
 */
export function parseAkshareFlowRaw(raw: unknown): FrFlowPoint[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const numOrNull = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const out: FrFlowPoint[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const date = String(o["date"] ?? "").slice(0, 10);
    const main = Number(o["main_net"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(main)) continue;
    out.push({
      date,
      main,
      superLarge: numOrNull(o["super_net"]),
      large: numOrNull(o["large_net"]),
      mid: numOrNull(o["mid_net"]),
      small: numOrNull(o["small_net"]),
      close: numOrNull(o["close"]),
      ratio: null,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** 取证据里某个 field 的 raw 并解析成日序列（东财 120d → 四维 / akshare → 四维 / 新浪 → 主力+超大单），读不到返回空 */
async function flowDailySeries(env: Envelope, field: string, kind: "em120d" | "akshare" | "sina"): Promise<FrFlowPoint[]> {
  try {
    const ref = rawRefOf(env, field);
    const raw = await fetchFrRaw(ref);
    if (kind === "em120d") {
      return parseEm120dFlowRaw(raw).map((r) => ({
        date: r.date, main: r.main, superLarge: r.superLarge, large: r.large, mid: r.mid, small: r.small,
        close: null, ratio: null,
      }));
    }
    if (kind === "akshare") {
      return parseAkshareFlowRaw(raw);
    }
    return parseSinaFlowRaw(raw);
  } catch {
    return [];
  }
}

/** 日序列尾 n 条的五档合计（null 档保持 null，表示源不提供） */
function tailSumDims(series: FrFlowPoint[], n: number): FrFlowDims | null {
  if (series.length === 0) return null;
  const tail = series.slice(-n);
  const sum = (pick: (r: (typeof tail)[number]) => number | null): number | null => {
    let s = 0;
    let any = false;
    for (const r of tail) {
      const v = pick(r);
      if (v == null) continue;
      s += v;
      any = true;
    }
    return any ? s : null;
  };
  const last = tail[tail.length - 1]!;
  return {
    main: sum((r) => r.main),
    superLarge: sum((r) => r.superLarge),
    large: sum((r) => r.large),
    mid: sum((r) => r.mid),
    small: sum((r) => r.small),
    asOf: `${tail[0]!.date}..${last.date}`,
  };
}

/** 最近 n 日主力净流入合计（日序列按日期升序取尾部 n 条求和；纯展示聚合） */
function tailSum(series: { main: number }[], n: number): number | null {
  if (series.length === 0) return null;
  const tail = series.slice(-n);
  return tail.reduce((s, r) => s + r.main, 0);
}

/** 日级源降级链（120d → akshare → sina）：返回五档日序列；都失败返回空数组 */
async function loadDailyFlowSeries(code: string, refresh: boolean): Promise<
  { source: string; note: string; series: FrFlowPoint[] }
> {
  // 2a) em_fund_flow_120d（push2his 在本机不通，失败属预期）
  try {
    const res = await fetchFr("em_fund_flow_120d", {}, { refresh, symbol: code });
    const env = res.envelope;
    if (num(scalar(env, "main_net_inflow_daily_latest")) === null) throw new Error("120d 资金流为空");
    const series = await flowDailySeries(env, "main_net_inflow_daily_latest", "em120d");
    return {
      source: "em_fund_flow_120d（东财日级四维）",
      note: series.length > 0 ? "5日/20日合计由 120d raw 日序列求和" : "日序列未开放（raw 接缝不可读），5日/20日不可得",
      series,
    };
  } catch {
    /* 落下一级 */
  }
  // 2b) akshare_fund_flow_120d（直连 push2his，120 日四维含中单/小单；封 IP 时与 120d 一样失败属预期）
  try {
    const res = await fetchFr("akshare_fund_flow_120d", {}, { refresh, symbol: code });
    const env = res.envelope;
    if (num(scalar(env, "main_net_inflow_daily_latest")) === null) throw new Error("akshare 资金流为空");
    const series = await flowDailySeries(env, "main_net_inflow_daily_latest", "akshare");
    return {
      source: "akshare_fund_flow_120d（akshare直连东财四维）",
      note: series.length > 0 ? "5日/20日合计由 akshare 120 日四维 raw 求和" : "日序列未开放（raw 接缝不可读），5日/20日不可得",
      series,
    };
  } catch {
    /* 落下一级 */
  }
  // 2c) sina_fund_flow（日度，主力 + 超大单；中单/小单不可得）
  try {
    const res = await fetchFr("sina_fund_flow", {}, { refresh, symbol: code });
    const env = res.envelope;
    if (num(scalar(env, "fund_net_inflow_daily_latest")) === null) throw new Error("新浪资金流为空");
    const series = await flowDailySeries(env, "fund_net_inflow_daily_latest", "sina");
    return {
      source: "sina_fund_flow（新浪日度主力+超大单）",
      note: "新浪口径给主力 + 超大单（大单=主力−超大单推导）；中单/小单不可得",
      series,
    };
  } catch {
    /* 全部失败 → 空序列 */
  }
  return { source: "", note: "日序列源全部失败", series: [] };
}

/**
 * 四维资金流降级链：
 * - 当日：em_fund_flow_minute（分钟，当日累计）→ 失败落日级源的「最新一日」；
 * - 5日/20日：em_fund_flow_120d raw（四维日序列）→ akshare_fund_flow_120d raw（四维日序列）→ sina_fund_flow raw（主力+超大单）；
 * - 两个方向都失败 → 返回 null，页面渲染示例 + 「资金数据暂不可用」。
 * 分钟源与日序列源并行取：分钟只服务「当日」，日序列只服务「5日/20日」，互不拖累。
 */
export async function loadStockFundFlow(code: string, refresh: boolean): Promise<FrFlowLive | null> {
  const [minuteRes, dailyRes] = await Promise.allSettled([
    (async (): Promise<{ dims: FrFlowDims; note: string } | null> => {
      // 1) em_fund_flow_minute（盘中才有；盘后 klines 为空 → failed 属预期，落下一级）
      try {
        const res = await fetchFr("em_fund_flow_minute", {}, { refresh, dayCache: false, symbol: code });
        const env = res.envelope;
        const main = num(scalar(env, "main_net_inflow_intraday_cum"));
        const superLarge = num(scalar(env, "super_net_inflow_intraday_cum"));
        const large = num(scalar(env, "large_net_inflow_intraday_cum"));
        if (main === null && superLarge === null && large === null) throw new Error("分钟资金流为空");
        let mid: number | null = null;
        let small: number | null = null;
        try {
          const raw = await fetchFrRaw(rawRefOf(env, "main_net_inflow_intraday_cum"));
          const last = parseEmMinuteFlowRaw(raw).at(-1);
          if (last) {
            mid = last.mid;
            small = last.small;
          }
        } catch {
          /* raw 不可读：中单/小单显示「—」，不编值 */
        }
        const asOf = (env.evidence ?? []).find((e) => e.field === "main_net_inflow_intraday_cum")?.period ?? res.data_date;
        return {
          dims: { main, superLarge, large, mid, small, asOf },
          note: mid === null ? "中单/小单单列值需底座 raw 读取（未开放则显示「—」）" : "四档由分钟 raw 单列",
        };
      } catch {
        return null;
      }
    })(),
    loadDailyFlowSeries(code, refresh),
  ]);

  const minute = minuteRes.status === "fulfilled" ? minuteRes.value : null;
  const daily = dailyRes.status === "fulfilled" ? dailyRes.value : null;
  if (!minute && (!daily || daily.series.length === 0)) return null; // 两个方向都失败 → 页面示例

  // 当日值：分钟优先；分钟不可用则用日序列最新一日
  let today: FrFlowDims | null = null;
  let source = "";
  let note = "";
  let intraday = false;
  if (minute) {
    today = minute.dims;
    source = "em_fund_flow_minute（东财分钟，当日累计）";
    note = minute.note;
    intraday = true;
  } else if (daily && daily.series.length > 0) {
    const last = daily.series[daily.series.length - 1]!;
    today = {
      main: last.main,
      superLarge: last.superLarge,
      large: last.large,
      mid: last.mid,
      small: last.small,
      asOf: last.date,
    };
    source = `${daily.source}（最新一日）`;
    note = daily.note;
    intraday = false;
  }
  const series = daily?.series ?? [];
  const seriesOk = series.length > 0;
  if (daily && seriesOk) {
    source = intraday ? `${source}；5/20日=${daily.source}` : source;
    note = daily.note;
  }
  return {
    today,
    sum5: tailSum(series, 5),
    sum20: tailSum(series, 20),
    dims5: tailSumDims(series, 5),
    dims20: tailSumDims(series, 20),
    series,
    source,
    note,
    seriesOk,
    intraday,
  };
}

/* ---------------- ④ 龙虎榜（个股） ---------------- */

export interface FrLhbSeat {
  name: string;
  buyWan: number;
  sellWan: number;
  netWan: number;
}

export interface FrLhbStockRecord {
  date: string;
  reason: string;
  netWan: number;
  turnoverPct: number | null;
}

export interface FrLhbStock {
  /** 回看窗口 [起,止]（近 30 天） */
  window: [string, string];
  count: number;
  /** 逐条上榜记录（按日期倒序，源已排序） */
  records: FrLhbStockRecord[];
  /** 最新一次机构净额（万元） */
  institutionNetWan: number | null;
  /** 最新一次上榜的买卖席位（extra.seats，万元） */
  seats: { buy: FrLhbSeat[]; sell: FrLhbSeat[] };
}

export async function loadStockLhb(code: string, refresh: boolean): Promise<FrLhbStock> {
  const res = await fetchFr("em_dragon_tiger", {}, { refresh, symbol: code });
  const env = res.envelope;
  const count = num(scalar(env, "dragon_tiger_count")) ?? 0;
  const records: FrLhbStockRecord[] = [];
  for (const r of rows(env)) {
    const netWan = num(r.fields["dragon_tiger_net_buy"]);
    if (netWan === null) continue;
    const kv = noteKV(r.note);
    const date = String(r.key).split("|")[0] ?? "";
    records.push({
      date,
      reason: kv["上榜原因"] ?? r.note ?? "",
      netWan,
      turnoverPct: num(r.fields["dragon_tiger_turnover"]),
    });
  }
  records.sort((a, b) => b.date.localeCompare(a.date));
  const extra = (env.extra ?? {}) as Record<string, unknown>;
  const rawSeats = (extra.seats ?? {}) as { buy?: unknown[]; sell?: unknown[] };
  const seatOf = (list: unknown[] | undefined): FrLhbSeat[] =>
    (list ?? []).flatMap((s) => {
      if (!s || typeof s !== "object") return [];
      const o = s as Record<string, unknown>;
      const name = String(o["name"] ?? "");
      if (!name) return [];
      return [{
        name,
        buyWan: Number(o["buy_amt"] ?? 0),
        sellWan: Number(o["sell_amt"] ?? 0),
        netWan: Number(o["net"] ?? 0),
      }];
    });
  const windowRaw = extra.window as [string, string] | undefined;
  const window: [string, string] = Array.isArray(windowRaw) && windowRaw.length === 2 && typeof windowRaw[0] === "string" && typeof windowRaw[1] === "string"
    ? [windowRaw[0], windowRaw[1]]
    : [frTodayKey(), frTodayKey()];
  return {
    window,
    count,
    records,
    institutionNetWan: num(scalar(env, "dragon_tiger_institution_net")),
    seats: { buy: seatOf(rawSeats.buy), sell: seatOf(rawSeats.sell) },
  };
}

/* ---------------- 整页装配 ---------------- */

export interface FrStockLive {
  dataDate: string;
  quote: FrStockQuote | null;
  boards: string[];
  kline: FrKlineLive | null;
  flow: FrFlowLive | null;
  lhb: FrLhbStock | null;
  /** 块级降级点名（顶部提示用） */
  missing: string[];
}

/**
 * 个股页整页取数：六个区块各自 try/catch，互不拖累；本函数**永不 throw**，
 * 各块为 null 时页面渲染对应占位（头卡失败 → 仅显示代码与「行情暂不可用」）。
 */
export async function loadStockLive(code: string, refresh: boolean): Promise<FrStockLive> {
  const missing: string[] = [];
  let quote: FrStockQuote | null = null;
  let boards: string[] = [];
  let kline: FrKlineLive | null = null;
  let flow: FrFlowLive | null = null;
  let lhb: FrLhbStock | null = null;
  let dataDate = frTodayKey();

  const [q, b, k, f, l] = await Promise.allSettled([
    loadStockQuote(code, refresh),
    loadStockBoards(code, refresh),
    loadStockKline(code, refresh),
    loadStockFundFlow(code, refresh),
    loadStockLhb(code, refresh),
  ]);
  if (q.status === "fulfilled") {
    quote = q.value;
    dataDate = q.value.asOf || dataDate;
  } else {
    missing.push("行情");
  }
  if (b.status === "fulfilled") boards = b.value;
  else missing.push("板块归属");
  if (k.status === "fulfilled") {
    kline = k.value;
    if (!k.value.seriesOk) missing.push("K线序列");
  } else {
    missing.push("K线");
  }
  if (f.status === "fulfilled" && f.value) flow = f.value;
  else missing.push("资金流向");
  if (l.status === "fulfilled") lhb = l.value;
  else missing.push("龙虎榜");

  return { dataDate, quote, boards, kline, flow, lhb, missing };
}

/* ---------------- ⑤ 估值（PE/PB 及历史分位，报告页用） ---------------- */

export interface FrValuationLive {
  /** PE_TTM（倍）；<=0 视为亏损，页面显示「亏损」并诚实说明 */
  pe: number | null;
  /** PB（倍） */
  pb: number | null;
  /** PE / PB 历史分位（0-100，越低越便宜）；null = 序列不可读/未获取 */
  pePercentile: number | null;
  pbPercentile: number | null;
  /** 历史序列样本条数（tradestatus=1） */
  points: number | null;
  asOf: string;
  source: string;
  note: string;
}

/**
 * 分位口径（纯展示）：当前值在历史交易日序列中的「低于占比」% = count(v ≤ current) / n × 100。
 * 分位越高 = 当前估值越贵。此函数只服务报告页估值卡展示；研究报告的估值分位以 calc percentile_rank 为准。
 */
function percentileRank(series: readonly number[], current: number): number | null {
  if (series.length === 0 || !Number.isFinite(current)) return null;
  let le = 0;
  for (const v of series) if (v <= current) le++;
  return Math.round((le / series.length) * 100);
}

/** fetch_pe_history 的 raw CSV 解析：列 date,code,close,peTTM,pbMRQ,psTTM,turn,tradestatus,isST；只取 tradestatus=1 行。 */
function parsePeHistoryCsv(text: string): { pe: number[]; pb: number[] } {
  const pe: number[] = [];
  const pb: number[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { pe, pb };
  const header = lines[0]!.split(",");
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h.trim()] = i; });
  const peI = idx["peTTM"];
  const pbI = idx["pbMRQ"];
  const tsI = idx["tradestatus"];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    if (tsI !== undefined && cols[tsI] !== "1") continue;
    if (peI !== undefined) {
      const v = Number(cols[peI]);
      if (Number.isFinite(v)) pe.push(v);
    }
    if (pbI !== undefined) {
      const v = Number(cols[pbI]);
      if (Number.isFinite(v)) pb.push(v);
    }
  }
  return { pe, pb };
}

/** bs_valuation_history 的 raw JSON 解析：rows[].peTTM/pbMRQ（tradestatus=1） */
function parseValuationJson(raw: unknown): { pe: number[]; pb: number[] } {
  const pe: number[] = [];
  const pb: number[] = [];
  const rowsArr = (raw as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rowsArr)) return { pe, pb };
  for (const r of rowsArr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (String(o["tradestatus"] ?? "") !== "1") continue;
    const p = Number(o["peTTM"]);
    const b = Number(o["pbMRQ"]);
    if (Number.isFinite(p)) pe.push(p);
    if (Number.isFinite(b)) pb.push(b);
  }
  return { pe, pb };
}

/**
 * 估值取数：主源 fetch_pe_history（legacy，baostock PE_TTM/PB 日频 5 年），
 * 备源 bs_valuation_history（同 baostock，字段 pe_ttm/pb_mrq）。
 * 分位从 raw 序列（CSV / JSON rows）确定性计算；两个源都失败 → 返回 null，
 * 报告页估值卡显示「—」并诚实说明（不编值）。
 */
export async function loadStockValuation(code: string, refresh: boolean): Promise<FrValuationLive | null> {
  const readSeries = async (env: Envelope): Promise<{ pe: number[]; pb: number[] }> => {
    const ref = rawRefOf(env, "pe_ttm_latest") ?? rawRefOf(env, "pb_mrq_latest");
    const raw = await fetchFrRaw(ref);
    return typeof raw === "string" ? parsePeHistoryCsv(raw) : parseValuationJson(raw);
  };
  // 主源：fetch_pe_history
  try {
    const res = await fetchFr("fetch_pe_history", {}, { refresh, symbol: code });
    const env = res.envelope;
    const pe = num(scalar(env, "pe_ttm_latest"));
    const pb = num(scalar(env, "pb_mrq_latest"));
    const points = num(scalar(env, "pe_ttm_traded_history_points"));
    let series: { pe: number[]; pb: number[] } | null = null;
    try {
      series = await readSeries(env);
    } catch {
      series = null;
    }
    return {
      pe,
      pb,
      pePercentile: pe !== null && series ? percentileRank(series.pe, pe) : null,
      pbPercentile: pb !== null && series ? percentileRank(series.pb, pb) : null,
      points,
      asOf: frDataDateOf(res.raw),
      source: "fetch_pe_history（baostock PE/PB 日频 5 年）",
      note: series
        ? (points != null ? `分位基于 ${points} 个交易日历史序列（tradestatus=1）` : "历史序列可读，但条数未取到")
        : "历史序列不可读（raw 接缝未开放），分位未获取",
    };
  } catch {
    /* 落备源 */
  }
  // 备源：bs_valuation_history
  try {
    const res = await fetchFr("bs_valuation_history", {}, { refresh, symbol: code });
    const env = res.envelope;
    const pe = num(scalar(env, "pe_ttm_latest"));
    const pb = num(scalar(env, "pb_mrq_latest"));
    const points = num(scalar(env, "pe_ttm_points"));
    let series: { pe: number[]; pb: number[] } | null = null;
    try {
      series = await readSeries(env);
    } catch {
      series = null;
    }
    return {
      pe,
      pb,
      pePercentile: pe !== null && series ? percentileRank(series.pe, pe) : null,
      pbPercentile: pb !== null && series ? percentileRank(series.pb, pb) : null,
      points,
      asOf: frDataDateOf(res.raw),
      source: "bs_valuation_history（baostock 估值历史）",
      note: series
        ? (points != null ? `分位基于 ${points} 个交易日历史序列（tradestatus=1）` : "历史序列可读，但条数未取到")
        : "历史序列不可读（raw 接缝未开放），分位未获取",
    };
  } catch {
    /* 两个源都失败 → null */
  }
  return null;
}

/* ---------------- ⑥ 财务摘要（报告页基本面风险用） ---------------- */

/**
 * 财务摘要（fetch_financials 端点，报告期累计值 YTD）。
 * 口径与 lib/api.ts 的 financialsOf 一致：最近一期 = 核心字段（营收/归母净利/EPS）里最大的那一期；
 * 同比 = 与去年同期比，去年同期缺失或非正时不算（给 null 比给夸张数字诚实）。
 * 与 financialsOf 的差异：这里给**原始数值**（元 / %），供 buildRisks 做阈值判定；界面文案再格式化。
 */
export interface FrStockFinancials {
  /** 最新报告期（核心字段里最大的那一期）；null = 端点无有效报告期 */
  period: string | null;
  /** 营业总收入（元，报告期累计值 YTD）；null = 未取到 */
  revenue: number | null;
  /** 营收同比（%）；null = 无去年同期 / 去年同期非正 / 未取到 */
  revenueYoy: number | null;
  /** 归母净利润（元，YTD）；null = 未取到 */
  netProfit: number | null;
  /** 归母净利同比（%）；null = 无去年同期 / 去年同期非正 / 未取到 */
  netProfitYoy: number | null;
  /** 基本每股收益（元/股，YTD）；null = 未取到 */
  eps: number | null;
  /**
   * 资产负债率（%）。fetch_financials（新浪摘要/利润表）当前**不产出** debt_asset_ratio，
   * 此处防御性读取：未来端点带出则一并取；未带出恒为 null（「负债率偏高」判定自然不触发）。
   */
  debtRatio: number | null;
}

/**
 * 报告页财务取数：复用 fetchFr("fetch_financials")（与整页其它块同一取数/当天缓存机制）。
 * 核心字段（营收/归母净利/EPS）一个都没取到 → 返回 null，页面诚实降级为「财务数据未获取」。
 * 永不 throw（fetchFr 抛错在此收口）。
 */
export async function loadStockFinancials(code: string, refresh: boolean): Promise<FrStockFinancials | null> {
  try {
    const res = await fetchFr("fetch_financials", {}, { refresh, symbol: code });
    const env = res.envelope;
    const CORE = ["revenue_cum", "net_profit_parent_cum", "eps_basic_cum"];
    const periods = [...new Set((env.evidence ?? []).filter((x) => CORE.includes(x.field)).map((x) => x.period))].sort();
    const latest = periods[periods.length - 1] ?? null;
    const at = (field: string, period: string | null) =>
      period === null ? undefined : env.evidence.find((x) => x.field === field && x.period === period);
    // 去年同期：period 若不是 `YYYY-...` 形状（FY2026 / 带时间戳），切年份会得到 NaN 键 → 明确不算
    const prevYear = latest && /^\d{4}/.test(latest)
      ? String(Number(latest.slice(0, 4)) - 1) + latest.slice(4)
      : null;
    const yoy = (field: string): number | null => {
      const now = num(at(field, latest));
      const before = num(at(field, prevYear));
      return now !== null && before !== null && before > 0 ? round2(((now - before) / before) * 100) : null;
    };
    const revenue = num(at("revenue_cum", latest));
    const netProfit = num(at("net_profit_parent_cum", latest));
    const eps = num(at("eps_basic_cum", latest));
    if (revenue === null && netProfit === null && eps === null) return null;
    return {
      period: latest,
      revenue,
      revenueYoy: yoy("revenue_cum"),
      netProfit,
      netProfitYoy: yoy("net_profit_parent_cum"),
      eps,
      debtRatio: num(at("debt_asset_ratio", latest)),
    };
  } catch {
    return null;
  }
}

/* ---------------- 报告页整页装配 ---------------- */

export interface FrStockReportLive extends FrStockLive {
  valuation: FrValuationLive | null;
  /** 财务摘要（fetch_financials）；null = 端点不可用/核心字段未取到 → 基本面风险降级「财务数据未获取」 */
  financials: FrStockFinancials | null;
}

/**
 * 报告页整页取数：复用 loadStockLive（行情/板块/K线/资金/龙虎榜）+ 估值 + 财务，各自 try/catch 互不拖累。
 * 本函数**永不 throw**；估值/财务不可用 → 对应字段为 null 并在 missing 里点名，页面显示「— / 未获取」。
 */
export async function loadStockReport(code: string, refresh: boolean): Promise<FrStockReportLive> {
  const [live, valuation, financials] = await Promise.allSettled([
    loadStockLive(code, refresh),
    loadStockValuation(code, refresh),
    loadStockFinancials(code, refresh),
  ]);
  const base: FrStockLive = live.status === "fulfilled"
    ? live.value
    : {
        dataDate: frTodayKey(), quote: null, boards: [], kline: null, flow: null, lhb: null,
        missing: ["行情", "板块归属", "K线", "资金流向", "龙虎榜"],
      };
  const val = valuation.status === "fulfilled" ? valuation.value : null;
  const fin = financials.status === "fulfilled" ? financials.value : null;
  const missing = [...base.missing];
  if (val === null) missing.push("估值");
  if (fin === null) missing.push("财务");
  return { ...base, valuation: val, financials: fin, missing };
}

/* ---------------- 持仓标记 ---------------- */

/** 是否在用户持仓清单（页面头卡 ●我的持仓 标记用；读 loadHoldings，不写死 5 只） */
export function isHoldingCode(code: string): boolean {
  return isHolding(code);
}
