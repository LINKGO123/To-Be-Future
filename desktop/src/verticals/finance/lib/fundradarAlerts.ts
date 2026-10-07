/**
 * 资金雷达工作台 · 异动提醒（刀7）
 * ------------------------------------------------------------
 * 职责：从持仓行情 / 主线数据里检出「值得提醒的异动」，产出异常列表，
 * 供 FrAlertToast 弹提醒。本层只做「检测 + 去重 + 免打扰」，不碰 UI。
 *
 * - 检测（MVP 两类，数据易得）：
 *   1. 持仓涨跌幅超阈值（默认 ±5%，≥9% 记为 strong）—— 用 tx_quotes_batch 的 change_pct；
 *   2. 主线切换 —— 今日主线 Top1 板块（涨停池热度榜首位）与上一交易日不同。
 *   （异常哨兵六维检测完整版后续接，见下方 anomalyJudgeSixDim，与 calc 同口径。）
 * - 去重：localStorage `fr-alert-reminded` 记「当天已提醒」，键 = `${kind}|${code|名称}`，
 *   单股单类日限 1 次；主线切换按「切换后的板块」去重。
 * - 免打扰：盘中 12:30–13:30（本地时间）不弹；MVP 硬编码午间免打扰，
 *   后续接可配置开关（设置页）。
 * - 硬约束：不改 calc/datasources/orchestrator；不新增依赖；不碰密钥。
 */
import {
  frHoldingsQuotes, frTodayKey, loadRadarCore,
} from "./fundradarData";
import { storageGet, storageSet } from "./storage";

/* ---------------- 类型 ---------------- */

export type FrAlertKind = "price_chg" | "mainline_switch";
/** 异动档位（与 calc/fundradar.py anomaly_judge 的 level 同口径：none | normal | strong）。 */
export type FrAnomalyLevel = "normal" | "strong";

/** 一条异动提醒（检查结果单元）。 */
export interface FrAnomaly {
  /** 持仓代码；主线切换等无个股时为 "" */
  code: string;
  /** 个股名 / 板块名 */
  name: string;
  kind: FrAlertKind;
  /** 大白话描述 */
  detail: string;
  level: FrAnomalyLevel;
  /** 涨跌方向：price_chg 用（红涨绿跌）；主线切换等无方向 */
  dir?: "up" | "down";
}

/* ---------------- 阈值与开关（MVP 常量） ---------------- */

/** 持仓涨跌幅异动阈值（%，绝对值）。MVP 默认 ±5%。 */
const CHG_ALERT_THRESHOLD = 5;
/** 涨跌幅达到该绝对值（%）记为 strong（接近 / 触及涨跌停）。 */
const CHG_ALERT_STRONG = 9;

/* ---------------- 存储键 ---------------- */

/** 当天已提醒记录：{ "YYYY-MM-DD": { "<kind>|<code或名称>": true } } */
const ALERT_REMINDED_KEY = "fr-alert-reminded";
/** 上一交易日主线 Top1 板块：{ dataDate, topName }（主线切换对比基线） */
const MAINLINE_LAST_KEY = "fr-mainline-last";

/* ---------------- 午间免打扰 ---------------- */

/**
 * 午间免打扰窗口：12:30–13:30（本地时间）不弹提醒。
 * MVP 硬编码；后续接设置页开关（可配置）。
 */
export function isAlertQuietWindow(now: Date): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 12 * 60 + 30 && mins < 13 * 60 + 30;
}

/* ---------------- 六维异常判定（calc 同口径镜像） ---------------- */

/** 六维输入（与 calc/fundradar.py anomaly_judge 的实参一一对应）。 */
export interface FrSixDimInput {
  fund_z: number | null;
  turnover_pctile: number | null;
  vol_z: number | null;
  board_ratio: number | null;
  zhapu_rate: number | null;
  ladder_delta: number | null;
}

export interface FrSixDimTrigger {
  dim: string;
  value: number | null;
  rule: string;
}

export interface FrSixDimResult {
  level: "none" | "normal" | "strong";
  /** 触发维度数（不含 skipped） */
  matched: number;
  triggers: FrSixDimTrigger[];
}

const STRONG_RULES = new Set(["|fund_z| ≥ 3", "board_ratio ≥ 3", "zhapu_rate ≥ 45"]);

/**
 * 六维异常判定 —— 与 calc/fundradar.py 的 anomaly_judge 同口径（前端镜像，注释注明）：
 *   strong ← |fund_z|≥3 或 board_ratio≥3 或 zhapu_rate≥45；
 *   normal ← |fund_z|≥2 或 turnover_pctile≥90 或 vol_z≥2.5 或 board_ratio≥2 或 |ladder_delta|≥2；
 *   均不触发 → none；输入为 None 的维度跳过（rule="skipped"）。
 * 说明：calc 会校验 turnover_pctile 越界 / zhapu_rate 为负 / ladder_delta 非整数 / 布尔输入并报错；
 *       本镜像为展示级实现，不重复这些入参校验（输入来自前端自己解析的数值，取值域已受控）。
 * 目前 checkAnomalies 尚未接入六维（所需 fund_z / turnover_pctile / vol_z / board_ratio /
 *   zhapu_rate / ladder_delta 未在前端数据层齐备），完整版后续接；本函数先落地同一口径防分叉。
 */
export function anomalyJudgeSixDim(input: FrSixDimInput): FrSixDimResult {
  const dims: { name: string; value: number | null }[] = [
    { name: "fund_z", value: input.fund_z },
    { name: "turnover_pctile", value: input.turnover_pctile },
    { name: "vol_z", value: input.vol_z },
    { name: "board_ratio", value: input.board_ratio },
    { name: "zhapu_rate", value: input.zhapu_rate },
    { name: "ladder_delta", value: input.ladder_delta },
  ];
  const triggers: FrSixDimTrigger[] = [];
  for (const d of dims) {
    const v = d.value;
    if (v === null) {
      triggers.push({ dim: d.name, value: null, rule: "skipped" });
      continue;
    }
    switch (d.name) {
      case "fund_z":
        if (Math.abs(v) >= 3) triggers.push({ dim: d.name, value: v, rule: "|fund_z| ≥ 3" });
        else if (Math.abs(v) >= 2) triggers.push({ dim: d.name, value: v, rule: "|fund_z| ≥ 2" });
        break;
      case "turnover_pctile":
        if (v >= 90) triggers.push({ dim: d.name, value: v, rule: "turnover_pctile ≥ 90" });
        break;
      case "vol_z":
        if (v >= 2.5) triggers.push({ dim: d.name, value: v, rule: "vol_z ≥ 2.5" });
        break;
      case "board_ratio":
        if (v >= 3) triggers.push({ dim: d.name, value: v, rule: "board_ratio ≥ 3" });
        else if (v >= 2) triggers.push({ dim: d.name, value: v, rule: "board_ratio ≥ 2" });
        break;
      case "zhapu_rate":
        if (v >= 45) triggers.push({ dim: d.name, value: v, rule: "zhapu_rate ≥ 45" });
        break;
      case "ladder_delta":
        if (Math.abs(v) >= 2) triggers.push({ dim: d.name, value: v, rule: "|ladder_delta| ≥ 2" });
        break;
    }
  }
  const matched = triggers.filter((t) => t.rule !== "skipped");
  const level = matched.some((t) => STRONG_RULES.has(t.rule))
    ? "strong"
    : matched.length > 0 ? "normal" : "none";
  return { level, matched: matched.length, triggers };
}

/* ---------------- 去重（当天已提醒） ---------------- */

interface RemindedDay { [key: string]: boolean; }
interface RemindedMap { [date: string]: RemindedDay; }

function loadReminded(): RemindedMap {
  const raw = storageGet(ALERT_REMINDED_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as RemindedMap;
  } catch {
    /* 损坏当作无记录 */
  }
  return {};
}

function isReminded(date: string, key: string): boolean {
  return loadReminded()[date]?.[key] === true;
}

function markReminded(date: string, key: string): void {
  const map = loadReminded();
  const day = map[date] ?? {};
  day[key] = true;
  map[date] = day;
  storageSet(ALERT_REMINDED_KEY, JSON.stringify(map));
}

/* ---------------- 主线切换基线 ---------------- */

interface MainlineLast { dataDate: string; topName: string; }

function loadMainlineLast(): MainlineLast | null {
  const raw = storageGet(MAINLINE_LAST_KEY);
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      if (typeof o.dataDate === "string" && typeof o.topName === "string" && o.topName) {
        return { dataDate: o.dataDate, topName: o.topName };
      }
    }
  } catch {
    /* 损坏当作无记录 */
  }
  return null;
}

function saveMainlineLast(v: MainlineLast): void {
  storageSet(MAINLINE_LAST_KEY, JSON.stringify(v));
}

/* ---------------- 检测主入口 ---------------- */

/** 涨跌幅绝对值 → 提醒档位（≥9% strong，否则 normal）。 */
function chgLevel(absChg: number): FrAnomalyLevel {
  return absChg >= CHG_ALERT_STRONG ? "strong" : "normal";
}

/**
 * 检查异动：午间免打扰窗口直接返回空（且不做任何检测 / 记录，午后再查时仍会正常提醒）；
 * 否则检持仓涨跌幅超阈值 + 主线切换，过滤掉「当天已提醒」后返回**新**异常（并标记已提醒）。
 * 任何一步取数失败都降级为空 / 跳过，不抛错、不崩页面。
 */
export async function checkAnomalies(): Promise<FrAnomaly[]> {
  if (isAlertQuietWindow(new Date())) return [];
  const today = frTodayKey();
  const out: FrAnomaly[] = [];

  // 1) 持仓涨跌幅超阈值（数据易得：tx_quotes_batch 的 change_pct）
  try {
    const { quotes } = await frHoldingsQuotes(false);
    for (const q of quotes) {
      const chg = q.chg;
      if (chg == null) continue;
      const abs = Math.abs(chg);
      if (abs < CHG_ALERT_THRESHOLD) continue;
      const key = `price_chg|${q.code}`;
      if (isReminded(today, key)) continue;
      markReminded(today, key);
      out.push({
        code: q.code,
        name: q.name,
        kind: "price_chg",
        detail: `${q.name} 今日${chg >= 0 ? "涨" : "跌"} ${abs.toFixed(1)}%（超过 ±${CHG_ALERT_THRESHOLD}% 阈值）`,
        level: chgLevel(abs),
        dir: chg >= 0 ? "up" : "down",
      });
    }
  } catch {
    /* 行情取不到：跳过，不抛错 */
  }

  // 2) 主线切换（今日主线 Top1 板块 vs 上一交易日）
  try {
    const radar = await loadRadarCore(false);
    if (radar) {
      const top = radar.heat[0]?.name;
      if (top) {
        const prev = loadMainlineLast();
        const isNewDay = prev !== null && prev.dataDate !== "" && prev.dataDate < radar.dataDate;
        if (isNewDay && prev.topName !== top) {
          const key = `mainline_switch|${top}`;
          if (!isReminded(today, key)) {
            markReminded(today, key);
            out.push({
              code: "",
              name: top,
              kind: "mainline_switch",
              detail: `主线方向切换：${prev.topName} → ${top}`,
              level: "normal",
            });
          }
        }
        // 记录基线：首见（无记录）或跨交易日时才写，保证「上一交易日」基线整天稳定
        if (prev === null || isNewDay) {
          saveMainlineLast({ dataDate: radar.dataDate, topName: top });
        }
      }
    }
  } catch {
    /* 主线取不到：跳过 */
  }

  return out;
}
