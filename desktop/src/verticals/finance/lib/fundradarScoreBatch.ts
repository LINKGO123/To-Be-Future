/**
 * 资金雷达工作台 · 评分榜批量评分（复用报告页同一套评分口径）
 * ------------------------------------------------------------
 * 职责：对候选池每只股票「取数 → 算分」，落 localStorage `fr-score-cache`。
 * - 取数：复用 lib/fundradarStock.ts 的 loadStockQuote / loadStockKline /
 *   loadStockFundFlow / loadStockValuation（只取评分与展示需要的 4 块，不取
 *   板块归属 / 龙虎榜，比 loadStockReport 更轻）。
 * - 算分：复用 lib/fundradarIndicators.ts 的 scoreComposite（技术面 50% +
 *   资金面 30% + 估值面 20%），**不重写评分口径**。
 * - 缺失处理（评分榜口径，不改 scoreComposite 本体）：资金 / 估值取不到
 *   → 该项子分记 0，并在 missing[] 标注「资金 / 估值」；综合分按与
 *   scoreComposite 相同的 50/30/20 权重重算（子分仍由 scoreComposite 算出，
 *   只对「缺失」这一项覆盖为 0）。
 * - 性能：runBatchScore 内置并发限流（默认 2，东财防封；东财 em_* 端点已在
 *   fetchFr 层做全局 500ms 间隔节流），失败跳过，避免打爆底座；每只成功后
 *   增量写缓存，进度经 onProgress 回传。
 * - 红线：只产出评分 / 分级，不提供任何投资动作建议。
 */
import { frTodayKey } from "./fundradarData";
import {
  scoreComposite,
  type CompositeScoreResult,
  type FlowScoreInput,
  type ValuationScoreInput,
} from "./fundradarIndicators";
import { SCORE_POOL_SECTORS } from "./fundradarScorePool";
import { scorePoolCustomCodes } from "./fundradarScorePoolCustom";
import {
  consecutiveFlow,
  loadStockFundFlow,
  loadStockKline,
  loadStockQuote,
  loadStockValuation,
} from "./fundradarStock";
import { watchlistCodes } from "./fundradarWatchlist";
import { storageGet, storageSet } from "./storage";

/* ---------------- 缓存结构 ---------------- */

export interface ScoreSubscores {
  tech: number;
  flow: number;
  valuation: number;
}

export interface ScoreCacheItem {
  code: string;
  name: string;
  /** 综合评分 0-100（整数；缺失项按 0 重算权重后的值） */
  score: number;
  /** 分级：偏多(≥60) / 中性(40-59) / 偏空(<40) */
  grade: "偏多" | "中性" | "偏空";
  subscores: ScoreSubscores;
  /** 涨跌幅 %（行情取不到为 null） */
  chg: number | null;
  /** 当日主力净流入（元；资金取不到为 null） */
  flow: number | null;
  /** 数据日期 YYYY-MM-DD */
  dataDate: string;
  /** 缺失点名：行情 / K线 / 资金 / 估值 */
  missing: string[];
}

export const FR_SCORE_CACHE_KEY = "fr-score-cache";
export const FR_SCORE_CACHE_UPDATED_KEY = "fr-score-cache-updated";
/** 批量评分落盘后派发的事件名（评分榜页订阅刷新） */
export const FR_SCORE_CACHE_CHANGED = "fr-score-cache-changed";

function isScoreCacheItem(x: unknown): x is ScoreCacheItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return /^\d{6}$/.test(String(o.code ?? ""))
    && typeof o.score === "number"
    && typeof o.subscores === "object" && o.subscores !== null;
}

/** 读评分缓存：localStorage `fr-score-cache`（数组）；无/损坏 → 空数组。 */
export function loadScoreCache(): ScoreCacheItem[] {
  const raw = storageGet(FR_SCORE_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScoreCacheItem);
  } catch {
    return [];
  }
}

/** 写评分缓存（整表覆盖）。 */
function saveScoreCache(items: ScoreCacheItem[]): void {
  storageSet(FR_SCORE_CACHE_KEY, JSON.stringify(items));
}

/** 缓存更新时间（ISO 字符串；无则为 null）。 */
export function loadScoreCacheUpdated(): string | null {
  return storageGet(FR_SCORE_CACHE_UPDATED_KEY);
}

/* ---------------- 单只取数算分 ---------------- */

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));

/**
 * 对单只股票取数算分（可复用函数）：行情 / K线 / 资金 / 估值四块并行取、
 * 各自降级，复用 scoreComposite 算综合分与三因子子分；资金/估值缺失记 0 分。
 * 本函数**永不 throw**：任何一块失败都降级为 null 并在 missing 点名。
 */
export async function scoreSingleStock(code: string, refresh: boolean): Promise<ScoreCacheItem> {
  const [q, k, f, v] = await Promise.allSettled([
    loadStockQuote(code, refresh),
    loadStockKline(code, refresh),
    loadStockFundFlow(code, refresh),
    loadStockValuation(code, refresh),
  ]);
  const quote = q.status === "fulfilled" ? q.value : null;
  const kline = k.status === "fulfilled" ? k.value : null;
  const flow = f.status === "fulfilled" ? f.value : null;
  const valuation = v.status === "fulfilled" ? v.value : null;

  const missing: string[] = [];
  if (!quote) missing.push("行情");
  if (!kline) missing.push("K线");
  if (!flow) missing.push("资金");
  if (!valuation) missing.push("估值");

  const closes = kline?.daily?.map((b) => b.close) ?? [];
  const flowInput: FlowScoreInput | null = flow
    ? {
        mainToday: flow.today?.main ?? null,
        consecutive: consecutiveFlow(flow.series),
        sum5: flow.sum5,
        sum20: flow.sum20,
      }
    : null;
  const valuationInput: ValuationScoreInput | null = valuation
    ? {
        pe: valuation.pe,
        pb: valuation.pb,
        pePercentile: valuation.pePercentile,
        pbPercentile: valuation.pbPercentile,
      }
    : null;

  const core: CompositeScoreResult = scoreComposite({ closes, flow: flowInput, valuation: valuationInput });

  // 缺失处理：资金/估值缺失 → 该项记 0（评分榜口径）；综合分按 50/30/20 同权重重算。
  const flowMissing = flow === null;
  const valMissing = valuation === null;
  const tech = core.tech;
  const flowSub = flowMissing ? 0 : core.flow;
  const valSub = valMissing ? 0 : core.valuation;
  const score = clamp100(Math.round(tech * 0.5 + flowSub * 0.3 + valSub * 0.2));
  const grade: ScoreCacheItem["grade"] = score >= 60 ? "偏多" : score >= 40 ? "中性" : "偏空";

  return {
    code,
    name: quote?.name || code,
    score,
    grade,
    subscores: { tech, flow: flowSub, valuation: valSub },
    chg: quote?.chg ?? null,
    flow: flow?.today?.main ?? null,
    dataDate: kline?.dataDate || quote?.asOf || frTodayKey(),
    missing,
  };
}

/* ---------------- 批量评分（并发限流） ---------------- */

export interface BatchProgress {
  total: number;
  done: number;
  ok: number;
  failed: number;
  /** 当前正在处理的代码 */
  current: string;
}

export interface RunBatchOptions {
  /** 要评分的代码列表（候选池按所选板块 + 自选拼出） */
  codes: string[];
  /** 并发数（默认 2；东财端点已全局限流 500ms，建议保持 2 避免封 IP） */
  concurrency?: number;
  /** 是否强制后端真取（默认 false，走当天缓存 / 后端快照） */
  refresh?: boolean;
  /** 进度回调（每完成一只触发一次） */
  onProgress?: (p: BatchProgress) => void;
}

/**
 * 批量评分：并发限流地取数算分，结果按 code 合并写入 `fr-score-cache`，
 * 失败跳过（保留既有缓存）；结束时写更新时间并派发 fr-score-cache-changed。
 * 返回本次成功算出的条目（合并后的全量缓存由 loadScoreCache() 读取）。
 */
export async function runBatchScore(opts: RunBatchOptions): Promise<ScoreCacheItem[]> {
  const { codes, concurrency = 2, refresh = false, onProgress } = opts;
  const map = new Map<string, ScoreCacheItem>();
  for (const it of loadScoreCache()) map.set(it.code, it);
  const results: ScoreCacheItem[] = [];

  const progress: BatchProgress = { total: codes.length, done: 0, ok: 0, failed: 0, current: "" };
  const emit = (): void => { onProgress?.({ ...progress }); };

  const limit = Math.min(Math.max(1, concurrency), Math.max(1, codes.length));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= codes.length) return;
      const code = codes[i]!;
      progress.current = code;
      emit();
      try {
        const item = await scoreSingleStock(code, refresh);
        map.set(item.code, item);
        results.push(item);
        progress.ok += 1;
        saveScoreCache([...map.values()]); // 增量落盘：中断/刷新也能拿到已算部分
      } catch {
        progress.failed += 1;
      }
      progress.done += 1;
      emit();
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  storageSet(FR_SCORE_CACHE_UPDATED_KEY, new Date().toISOString());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FR_SCORE_CACHE_CHANGED));
  }
  return results;
}

/* ---------------- 盘后批：跑一次全量评分（供 fundradarAutoRefresh 接入） ---------------- */

/** 全量候选池代码（4 板块 + 自定义 + 自选，去重）。 */
export function allPoolCodes(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of SCORE_POOL_SECTORS) {
    for (const st of s.stocks) {
      if (!seen.has(st.code)) {
        seen.add(st.code);
        out.push(st.code);
      }
    }
  }
  for (const c of scorePoolCustomCodes()) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  for (const c of watchlistCodes()) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** 盘后批量跑一次全量评分（失败不抛出，供定时批 fire-and-forget 调用）。 */
export async function runEodScoreBatch(): Promise<ScoreCacheItem[]> {
  try {
    return await runBatchScore({ codes: allPoolCodes(), concurrency: 2, refresh: false });
  } catch {
    return [];
  }
}
