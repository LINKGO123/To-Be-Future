/**
 * 资金雷达工作台 · 一键更新数据（首页大按钮 + 侧栏小入口共用）
 * ------------------------------------------------------------
 * 并行拉取 7 个数据端点（refresh:true 强制后端真取）：
 *   tx_quotes_batch（用户持仓清单）/ em_zt_pool / em_zb_pool / em_limit_up_sentiment /
 *   em_daily_dragon_tiger / em_global_news / em_board_fund_flow（单点失败容错）。
 * 取数口径与页面一致：
 *   - 行情走 fetchFr(dayCache:false)（盘中实时，不做前端当天缓存）；
 *   - 榜类/情绪/龙虎榜走 fetchFrLatest 按最近交易日回退（非交易日自然回退，
 *     「有数据」判据与 loadRadarCore / loadLhbLive 共用同一批导出函数）；
 *   - 新闻/板块资金走 fetchFr 当天缓存。
 * 全部完成后统计成功/失败项数，取「数据日期」；成功 ≥1 项时派发 window 自定义
 * 事件 fr-data-refreshed —— 在屏页面 useFrLoader 监听到后以 refresh=false 重取
 * （盘后数据读刚写入的当天缓存、行情读后端新快照），实现页面即时刷新。
 */
import {
  fetchFr, fetchFrLatest, FR_DATA_REFRESHED, FR_LAST_REFRESH_KEY, frTodayKey,
  meaningfulLhb, meaningfulSentiment, meaningfulZbPool, meaningfulZtPool,
} from "./fundradarData";
import { holdingsCodes } from "./fundradarPortfolio";
import { storageSet } from "./storage";

/** 一个更新任务：key=端点 id，label=失败统计用中文名，run 返回取数结果。 */
interface FrUpdateJob {
  key: string;
  label: string;
  run: () => Promise<{ dataDate: string; market: boolean }>;
}

/** 与页面 loadRadarCore / loadLhbLive / frHoldingsQuotes / frNews 同一组端点与参数。
 *  market=true：dataDate 是「最近交易日回退」得到的真实交易日（zt/zb/情绪/龙虎榜）；
 *  market=false：dataDate 是取数日期（行情/新闻/板块资金）。 */
const JOBS: FrUpdateJob[] = [
  {
    key: "tx_quotes_batch",
    label: "持仓行情",
    run: async () => {
      // 持仓行情按用户当前持仓清单取（增删改后立即生效）
      const r = await fetchFr("tx_quotes_batch", { codes: holdingsCodes() }, { refresh: true, dayCache: false });
      return { dataDate: r.data_date, market: false };
    },
  },
  {
    key: "em_zt_pool",
    label: "涨停池",
    run: () => fetchFrLatest("em_zt_pool", (ymd) => ({ date: ymd }), meaningfulZtPool, { refresh: true })
      .then((w) => ({ dataDate: w.tradeDate, market: true })),
  },
  {
    key: "em_zb_pool",
    label: "炸板池",
    run: () => fetchFrLatest("em_zb_pool", (ymd) => ({ date: ymd }), meaningfulZbPool, { refresh: true })
      .then((w) => ({ dataDate: w.tradeDate, market: true })),
  },
  {
    key: "em_limit_up_sentiment",
    label: "市场情绪",
    run: () => fetchFrLatest("em_limit_up_sentiment", (ymd) => ({ date: ymd }), meaningfulSentiment, { refresh: true })
      .then((w) => ({ dataDate: w.tradeDate, market: true })),
  },
  {
    key: "em_daily_dragon_tiger",
    label: "龙虎榜",
    run: () => fetchFrLatest(
      "em_daily_dragon_tiger",
      (ymd) => ({ trade_date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` }),
      meaningfulLhb,
      { refresh: true },
    ).then((w) => ({ dataDate: w.tradeDate, market: true })),
  },
  {
    key: "em_global_news",
    label: "全球要闻",
    run: async () => {
      const r = await fetchFr("em_global_news", {}, { refresh: true });
      return { dataDate: r.data_date, market: false };
    },
  },
  {
    key: "em_board_fund_flow",
    label: "板块资金",
    run: async () => {
      const r = await fetchFr("em_board_fund_flow", { board_type: "industry", period: "today", top_n: 30 }, { refresh: true });
      return { dataDate: r.data_date, market: false };
    },
  },
];

export interface FrUpdateOutcome {
  /** 成功项数 */
  ok: number;
  /** 失败项数 */
  fail: number;
  /** 失败端点中文名（统计与提示用） */
  failedLabels: string[];
  /** 数据日期 YYYY-MM-DD：取「最近交易日回退类端点」的最晚交易日；全挂时回退行情取数日期 */
  dataDate: string;
}

/** 并行执行全部更新任务（单点失败容错），统计结果并在成功 ≥1 项时派发 fr-data-refreshed。 */
export async function updateAllFrData(): Promise<FrUpdateOutcome> {
  const settled = await Promise.allSettled(JOBS.map((j) => j.run()));
  let ok = 0;
  const failedLabels: string[] = [];
  const tradeDates: string[] = [];
  const fetchDates: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      ok += 1;
      const { dataDate, market } = s.value;
      if (!dataDate) return;
      (market ? tradeDates : fetchDates).push(dataDate);
    } else {
      failedLabels.push(JOBS[i]?.label ?? "未知端点");
    }
  });
  const fail = JOBS.length - ok;
  const dataDate = (tradeDates.length > 0 ? tradeDates : fetchDates).sort().at(-1) ?? frTodayKey();
  if (ok >= 1) {
    // 至少一项更新成功 → 通知在屏页面重取（读新缓存/新快照）；全部失败时不打扰
    window.dispatchEvent(new CustomEvent<{ ok: number; fail: number; dataDate: string }>(FR_DATA_REFRESHED, {
      detail: { ok, fail, dataDate },
    }));
    // 记录最后成功刷新时间：首页状态指示器 / 顶栏徽标 / 设置页读它显示「数据已更新至 HH:MM」
    storageSet(FR_LAST_REFRESH_KEY, new Date().toISOString());
  }
  return { ok, fail, failedLabels, dataDate };
}

/** "2026-09-25" → "9月25日"（一键更新成功提示用）。 */
export function frMnD(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : iso;
}
