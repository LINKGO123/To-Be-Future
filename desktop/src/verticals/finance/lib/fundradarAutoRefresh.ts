/**
 * 资金雷达工作台 · 盘中定时自动刷新（默认 3 分钟，可配置）
 * ------------------------------------------------------------
 * 职责（改造 2）：
 *   - isTradingTime(now)：交易日 + 交易时段判断（简化实现：周一至周五，本地时间；
 *     节假日精确判断待后续接交易日历，先用「周末休市」近似，见函数注释）。
 *   - startAutoRefresh(cb) / stopAutoRefresh()：setInterval 调度；仅在标签页可见
 *     （document.visibilityState === "visible"）时执行刷新，切后台跳过。
 *   - 盘中（9:30-11:30 / 13:00-15:00）：只刷「实时类」端点
 *     tx_quotes_batch / em_fund_flow_minute（持仓逐只）/ em_zt_pool / em_zb_pool /
 *     em_limit_up_sentiment。
 *   - 盘后（15:30 后，且当天未跑过盘后批）：跑完整 updateAllFrData（含龙虎榜 /
 *     全球要闻等盘后批）；用 localStorage `fr-last-eod-refresh=日期` 记当天已跑，去重。
 *   - 板块新闻每小时刷新（独立于行情与盘后批）：每次 tick 判断距上次生成 ≥1 小时
 *     （fr-sector-news-last-gen）就 void generateSectorNews()；交易 / 非交易时段都刷。
 *     盘后批里的 generateSectorNews 保留，那次也算一次刷新并重置「上次生成时间」。
 *   - 刷新成功写 localStorage `fr-last-refresh`（ISO 时间戳）并派发既有 fr-data-refreshed
 *     事件，在屏页面 useFrLoader 监听到后以 refresh=false 重取（复用现有机制）。
 *   - 每秒派发轻量事件 fr-auto-refresh-status（detail = 状态），供顶栏 / 首页指示器
 *     渲染「数据更新时间 + 下次自动刷新倒计时」。
 *
 * 硬约束：不改 calc/datasources/orchestrator；不新增依赖；定时器在 stopAutoRefresh 里清理。
 */
import { useEffect, useState } from "react";
import {
  fetchFr, fetchFrLatest, FR_DATA_REFRESHED, FR_LAST_REFRESH_KEY,
  frTodayKey, meaningfulSentiment, meaningfulZbPool, meaningfulZtPool,
} from "./fundradarData";
import { generateDailyReview, generateMorningBrief } from "./fundradarMorningBrief";
import { generateNextWatch } from "./fundradarNextWatch";
import { generateSectorNews, recordSectorNewsGenAt, sectorNewsDue } from "./fundradarSectorNews";
import { holdingsCodes } from "./fundradarPortfolio";
import { runGoalChecks } from "./fundradarGoals";
import { runEodScoreBatch } from "./fundradarScoreBatch";
import { updateAllFrData } from "./fundradarUpdate";
import { storageGet, storageSet } from "./storage";

/* ---------------- 交易时段（简化） ---------------- */

export type FrMarketPhase = "pre" | "intraday" | "post" | "closed";

/**
 * 判断是否交易日 + 交易时段（简化实现，用本地时间）。
 * - 周一至周五；周末休市。节假日精确判断待后续接交易日历，先用「周末休市」近似
 *   （非交易日会有「数据为空」自然回退兜底，见 fetchFrLatest）。
 * - 盘中：上午 9:30-11:30、下午 13:00-15:00。
 * - 盘后：15:30 之后（15:00-15:30 为收盘竞价，不算盘中）。
 * - 盘前：09:30 之前（08:30 附近为盘前晨报时点）；午间休市（11:30-13:00）与
 *   收盘竞价（15:00-15:30）归入「非盘中」，不做盘中实时刷新。
 */
export function isTradingTime(now: Date): FrMarketPhase {
  const day = now.getDay();
  if (day === 0 || day === 6) return "closed";
  const mins = now.getHours() * 60 + now.getMinutes();
  if ((mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30) || (mins >= 13 * 60 && mins <= 15 * 60)) return "intraday";
  if (mins >= 15 * 60 + 30) return "post";
  return "pre";
}

/* ---------------- 设置（localStorage） ---------------- */

export const FR_AUTO_REFRESH_STATUS = "fr-auto-refresh-status";
export const FR_AUTO_ENABLED_KEY = "fr-auto-refresh-enabled";
export const FR_AUTO_INTERVAL_KEY = "fr-auto-refresh-interval";
const FR_LAST_EOD_KEY = "fr-last-eod-refresh";

export const FR_AUTO_INTERVAL_OPTIONS = [3, 5, 10] as const;
export type FrAutoInterval = (typeof FR_AUTO_INTERVAL_OPTIONS)[number];
export const FR_AUTO_DEFAULT_INTERVAL: FrAutoInterval = 3;

export function loadAutoRefreshEnabled(): boolean {
  // 默认开启：没存过 / 存坏了一律开（产品打开即自动盯盘）
  return storageGet(FR_AUTO_ENABLED_KEY) !== "off";
}

export function saveAutoRefreshEnabled(on: boolean): void {
  enabled = on;
  storageSet(FR_AUTO_ENABLED_KEY, on ? "on" : "off");
  applySchedule();
}

export function loadAutoRefreshInterval(): FrAutoInterval {
  const raw = storageGet(FR_AUTO_INTERVAL_KEY);
  const n = raw === null ? NaN : Number(raw);
  return (FR_AUTO_INTERVAL_OPTIONS as readonly number[]).includes(n) ? (n as FrAutoInterval) : FR_AUTO_DEFAULT_INTERVAL;
}

export function saveAutoRefreshInterval(min: FrAutoInterval): void {
  intervalMin = min;
  storageSet(FR_AUTO_INTERVAL_KEY, String(min));
  applySchedule();
}

/* ---------------- 调度状态（模块级单例） ---------------- */

export interface FrAutoRefreshStatus {
  /** 主调度 interval 是否在跑（开关开 = 在盯盘） */
  running: boolean;
  enabled: boolean;
  intervalMin: FrAutoInterval;
  /** 最近一次成功刷新时间（epoch ms；0 = 从未） */
  lastRefreshAt: number;
  /** 下一次调度时间（epoch ms；0 = 无排程） */
  nextTickAt: number;
  phase: FrMarketPhase;
  lastOk: number | null;
  lastFail: number | null;
}

let intervalId: number | null = null;
let tickerId: number | null = null;
let enabled = loadAutoRefreshEnabled();
let intervalMin = loadAutoRefreshInterval();
let nextTickAt = 0;
let lastPhase: FrMarketPhase = "closed";
let lastOk: number | null = null;
let lastFail: number | null = null;
let busy = false;
let tickCb: (() => Promise<void> | void) | undefined;

function readLastRefreshAt(): number {
  const raw = storageGet(FR_LAST_REFRESH_KEY);
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function currentStatus(): FrAutoRefreshStatus {
  return {
    running: intervalId !== null,
    enabled,
    intervalMin,
    // 每次现读 localStorage：手动「一键更新」与自动刷新写入后都能即时反映，不必依赖内存态
    lastRefreshAt: readLastRefreshAt(),
    nextTickAt,
    phase: lastPhase,
    lastOk,
    lastFail,
  };
}

function emitStatus(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FrAutoRefreshStatus>(FR_AUTO_REFRESH_STATUS, { detail: currentStatus() }));
}

function applySchedule(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  if (!enabled) {
    nextTickAt = 0;
    emitStatus();
    return;
  }
  nextTickAt = Date.now() + intervalMin * 60_000;
  intervalId = window.setInterval(() => { void runTick(); }, intervalMin * 60_000);
  emitStatus();
}

/** 写最后刷新时间并（成功 ≥1 项时）派发既有 fr-data-refreshed 让在屏页重取。 */
function recordRefresh(ok: number, fail: number): void {
  storageSet(FR_LAST_REFRESH_KEY, new Date().toISOString());
  lastOk = ok;
  lastFail = fail;
  if (ok >= 1) {
    window.dispatchEvent(new CustomEvent<{ ok: number; fail: number; dataDate: string }>(FR_DATA_REFRESHED, {
      detail: { ok, fail, dataDate: frTodayKey() },
    }));
  }
  emitStatus();
}

/** 盘中「实时类」端点子集刷新（不含盘后批的龙虎榜 / 全球要闻）。 */
async function refreshRealtime(): Promise<{ ok: number; fail: number }> {
  // 盘中实时类端点按用户当前持仓清单取（增删改后立即生效）
  const codes = holdingsCodes();
  const jobs: { label: string; run: () => Promise<unknown> }[] = [
    {
      label: "持仓行情",
      run: () => fetchFr("tx_quotes_batch", { codes }, { refresh: true, dayCache: false }),
    },
    ...codes.map((code) => ({
      label: `分钟资金流 ${code}`,
      run: () => fetchFr("em_fund_flow_minute", {}, { refresh: true, dayCache: false, symbol: code }),
    })),
    {
      label: "涨停池",
      run: () => fetchFrLatest("em_zt_pool", (ymd) => ({ date: ymd }), meaningfulZtPool, { refresh: true }),
    },
    {
      label: "炸板池",
      run: () => fetchFrLatest("em_zb_pool", (ymd) => ({ date: ymd }), meaningfulZbPool, { refresh: true }),
    },
    {
      label: "市场情绪",
      run: () => fetchFrLatest("em_limit_up_sentiment", (ymd) => ({ date: ymd }), meaningfulSentiment, { refresh: true }),
    },
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const ok = settled.filter((s) => s.status === "fulfilled").length;
  return { ok, fail: jobs.length - ok };
}

/**
 * 每小时板块新闻刷新（独立于盘中实时刷与盘后批）：新闻 24 小时都有，交易/非交易时段都刷。
 * 距上次生成 ≥1 小时就 fire-and-forget 重新生成（取最新 RSS + AI 批量判断）。
 * 先占位记一次时间，失败也不至于每拍（3 分钟）重试打爆 AI 后端。返回是否刚触发了一次生成。
 */
function maybeRefreshSectorNews(): boolean {
  if (!sectorNewsDue()) return false;
  recordSectorNewsGenAt();
  void generateSectorNews();
  return true;
}

/** 默认每次调度做的事：每小时新闻 + 盘中刷实时类；盘后跑一次完整盘后批（当天去重）；盘前/休市只刷新闻。 */
async function defaultTick(): Promise<void> {
  const phase = isTradingTime(new Date());
  lastPhase = phase;

  // 每小时板块新闻刷新（24h 都刷，独立于行情）。返回是否刚触发了一次生成。
  const newsRefreshed = maybeRefreshSectorNews();

  if (phase === "intraday") {
    const r = await refreshRealtime();
    if (r.ok > 0) {
      recordRefresh(r.ok, r.fail);
    } else {
      lastOk = null;
      lastFail = r.fail;
      emitStatus();
    }
    return;
  }
  if (phase === "post") {
    // 盘后批当天只跑一次；全失败不记「已跑」，下次调度重试
    if (storageGet(FR_LAST_EOD_KEY) !== frTodayKey()) {
      const o = await updateAllFrData(); // 内部已写 fr-last-refresh + 派发 fr-data-refreshed
      lastOk = o.ok;
      lastFail = o.fail;
      if (o.ok > 0) {
        storageSet(FR_LAST_EOD_KEY, frTodayKey());
        // 盘后批量评分（可选，后续可拆独立定时）：跑一次全量评分，fire-and-forget 不阻塞状态刷新
        void runEodScoreBatch();
        // 盘后 AI 生成（次日晨报 + 复盘文案）：fire-and-forget，失败内部降级返回 null、不阻塞状态刷新
        void generateMorningBrief();
        void generateDailyReview();
        // 盘后次日关注清单（确定性规则，非 AI）：fire-and-forget，失败内部降级返回 null
        void generateNextWatch();
        // 盘后板块利好利空新闻（保留）：若本拍已由每小时刷新触发过则跳过，避免重复打 AI；
        // 否则盘后批也算一次刷新（成功即重置「上次生成时间」）。
        if (!newsRefreshed) void generateSectorNews();
      }
    }
    // 长期目标盘后检查（Goal 模式）：遍历 goals 执行对应取数、写回 lastResult；内部按天去重，空列表无开销
    void runGoalChecks();
    emitStatus();
    return;
  }
  // pre / closed：盘前与休市不刷行情，但板块新闻已由顶部 maybeRefreshSectorNews 每小时刷
  emitStatus();
}

async function runTick(): Promise<void> {
  if (busy) return; // 上一次还没跑完，跳过这一拍，防止请求首尾叠加
  if (typeof document === "undefined" || document.visibilityState !== "visible") return; // 标签页切后台跳过
  busy = true;
  try {
    if (tickCb) await tickCb();
    else await defaultTick();
  } finally {
    busy = false;
    // 每次调度执行完都要重置下一次调度时间，否则倒计时到 0 后卡在 00:00 不重新计时
    nextTickAt = Date.now() + intervalMin * 60_000;
    emitStatus();
  }
}

/** 启动自动刷新（产品打开即自动盯盘）。卸载时必须调 stopAutoRefresh 清理定时器，避免泄漏。 */
export function startAutoRefresh(cb?: () => Promise<void> | void): void {
  if (typeof window === "undefined") return;
  stopAutoRefresh();
  tickCb = cb;
  enabled = loadAutoRefreshEnabled();
  intervalMin = loadAutoRefreshInterval();
  tickerId = window.setInterval(emitStatus, 1000); // 每秒心跳，供 UI 倒计时
  applySchedule();
}

export function stopAutoRefresh(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  if (tickerId !== null) {
    window.clearInterval(tickerId);
    tickerId = null;
  }
  nextTickAt = 0;
  tickCb = undefined;
  emitStatus();
}

/* ---------------- React 状态订阅 ---------------- */

/** 订阅 fr-auto-refresh-status 事件，返回当前自动刷新状态（每秒更新，供倒计时）。 */
export function useAutoRefreshStatus(): FrAutoRefreshStatus {
  const [status, setStatus] = useState<FrAutoRefreshStatus>(currentStatus);
  useEffect(() => {
    setStatus(currentStatus());
    const on = (e: Event) => setStatus((e as CustomEvent<FrAutoRefreshStatus>).detail);
    window.addEventListener(FR_AUTO_REFRESH_STATUS, on);
    return () => window.removeEventListener(FR_AUTO_REFRESH_STATUS, on);
  }, []);
  return status;
}

/* ---------------- 文案 ---------------- */

/** epoch ms → "HH:MM"；0 → "尚未更新"。 */
export function frLastRefreshLabel(lastRefreshAt: number): string {
  if (!lastRefreshAt) return "尚未更新";
  const d = new Date(lastRefreshAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 下次刷新倒计时 "2:47"；未启用 / 无排程返回空串。 */
export function frCountdownLabel(nextTickAt: number, enabledFlag: boolean): string {
  if (!enabledFlag || !nextTickAt) return "";
  const remain = Math.max(0, nextTickAt - Date.now());
  const totalSec = Math.ceil(remain / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
