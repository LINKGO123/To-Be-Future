/**
 * 资金雷达工作台 · 个股页技术指标纯函数库（零依赖，前端自算）
 * ------------------------------------------------------------------
 * 用途：个股详情页 K 线副图（MACD/BOLL/KDJ）与均线（MA5/10/20）全部在这里算。
 * 口径说明（写在每个函数头上）：
 * - 输入一律是「按日期升序」的收盘价序列（前复权日 K，fetch_kline 腾讯 qfqday 口径；
 *   周/月线由日 K 聚合后再进指标，见 fundradarStock.ts 的 aggregateKline）。
 * - 序列前段数据不足的窗口一律输出 null（ECharts 画成断点），**不编值**。
 * - 与 calc/ 的指标口径对齐（MA=SMA；MACD(12,26,9) 柱 = (DIF-DEA)×2；
 *   BOLL(20,2) 用总体标准差；KDJ(9,3,3) 用 SMA(x, n, 1) 递推）。
 *   这里的计算只用于页面展示副图，不产出研究报告数字；报告口径仍以 calc/ 为准。
 */

export interface KlineBar {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/* ---------------- MA（简单移动平均） ---------------- */

/**
 * SMA(n)：最近 n 根收盘价的简单算术平均。
 * 口径：sum(close[i-n+1..i]) / n；前 n-1 根输出 null（窗口不足）。
 */
export function sma(values: readonly number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/* ---------------- EMA（指数移动平均，MACD 组件） ---------------- */

/**
 * EMA(n)：α = 2/(n+1)；种子取前 n 根的 SMA（与国内行情软件常见口径一致，
 * 比「首根收盘直接当种子」收敛更稳；差异只在前 n 根，尾部几乎无差别）。
 * 前 n-1 根输出 null。注意：KDJ 的 K/D 用的是 SMA(x,n,1) 递推，**不是**这里的 EMA。
 */
export function ema(values: readonly number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const alpha = 2 / (n + 1);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += values[i]!;
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = alpha * values[i]! + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/* ---------------- MACD(12,26,9) ---------------- */

export interface MacdPoint {
  /** DIF = EMA12 − EMA26 */
  dif: number | null;
  /** DEA = EMA(DIF, 9) */
  dea: number | null;
  /** MACD 柱 = (DIF − DEA) × 2（A 股软件常见 ×2 口径） */
  hist: number | null;
}

/**
 * MACD(12,26,9)：DIF=EMA12-EMA26；DEA=EMA(DIF,9)（对 DIF 序列取 EMA，
 * DIF 尚为 null 的位置跳过）；柱 = (DIF-DEA)×2。任一子值缺失即整点 null。
 */
export function macd(values: readonly number[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const difFull = ema(values, fast);
  const deaFull = ema(values, slow);
  const out: MacdPoint[] = new Array(values.length);
  // 先算 DIF；DEA 只对非 null 的 DIF 做 EMA(9)
  const difs: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const f = difFull[i] ?? null;
    const s = deaFull[i] ?? null;
    if (f !== null && s !== null) difs[i] = f - s;
  }
  // 对 DIF 序列做 EMA(signal)：把 null 段当作序列起点之后才起算
  const nonNull: number[] = [];
  const deas: (number | null)[] = new Array(values.length).fill(null);
  let seedStart = -1;
  for (let i = 0; i < values.length; i++) {
    if (difs[i] !== null) nonNull.push(difs[i]!);
    if (nonNull.length >= signal && seedStart < 0) seedStart = i;
  }
  if (seedStart >= 0) {
    // 用「从第一个非空 DIF 起、凑满 signal 个」作种子（常见软件口径）
    let seed = 0;
    let cnt = 0;
    let prev: number | null = null;
    const alpha = 2 / (signal + 1);
    for (let i = 0; i < values.length; i++) {
      if (difs[i] === null) continue;
      cnt += 1;
      if (cnt < signal) {
        seed += difs[i]!;
        continue;
      }
      if (cnt === signal) {
        seed += difs[i]!;
        prev = seed / signal;
      } else {
        prev = alpha * difs[i]! + (1 - alpha) * (prev ?? 0);
      }
      deas[i] = prev;
    }
  }
  for (let i = 0; i < values.length; i++) {
    const d = difs[i] ?? null;
    const e = deas[i] ?? null;
    out[i] = d !== null && e !== null ? { dif: d, dea: e, hist: (d - e) * 2 } : { dif: null, dea: null, hist: null };
  }
  return out;
}

/* ---------------- BOLL(20,2) ---------------- */

export interface BollPoint {
  /** MID = MA20 */
  mid: number | null;
  /** UP = MID + 2σ */
  upper: number | null;
  /** LOW = MID − 2σ */
  lower: number | null;
}

/**
 * BOLL(20,2)：MID = SMA(20)；σ 为窗口内**总体标准差**（除以 n，行情软件常见口径，
 * 不是样本标准差 n-1）；UP/LOW = MID ± 2σ。窗口不足 20 根输出全 null。
 */
export function boll(values: readonly number[], n = 20, k = 2): BollPoint[] {
  const out: BollPoint[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) {
      out[i] = { mid: null, upper: null, lower: null };
      continue;
    }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += values[j]!;
    const mid = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = values[j]! - mid;
      sq += d * d;
    }
    const sd = Math.sqrt(sq / n); // 总体标准差（÷n）
    out[i] = { mid, upper: mid + k * sd, lower: mid - k * sd };
  }
  return out;
}

/* ---------------- KDJ(9,3,3) ---------------- */

export interface KdjPoint {
  k: number | null;
  d: number | null;
  j: number | null;
}

/**
 * KDJ(9,3,3)：
 * - RSV = (C − L9) / (H9 − L9) × 100；H9/L9 为含当日在内 9 根的最高/最低价，
 *   需要最高/最低价序列（函数接受 highs/lows），H9=L9（一字板）时 RSV 取 50（避免除零）。
 * - K = SMA(RSV, 3, 1) 即 K = 2/3·K' + 1/3·RSV；D = 2/3·D' + 1/3·K；J = 3K − 2D。
 * - 初始 K = D = 50（行情软件常见口径）；首根 K/D 直接从 50 起递推（不等待 3 根窗口）。
 */
export function kdj(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  n = 9,
): KdjPoint[] {
  const len = Math.min(highs.length, lows.length, closes.length);
  const out: KdjPoint[] = new Array(len);
  let kPrev = 50;
  let dPrev = 50;
  for (let i = 0; i < len; i++) {
    const start = Math.max(0, i - n + 1);
    let h = -Infinity;
    let l = Infinity;
    for (let j = start; j <= i; j++) {
      h = Math.max(h, highs[j]!);
      l = Math.min(l, lows[j]!);
    }
    let rsv: number;
    if (h - l <= 0 || !Number.isFinite(h) || !Number.isFinite(l)) {
      rsv = 50; // 一字板 / 窗口无波动：按 50 处理，不编值也不 NaN
    } else {
      rsv = ((closes[i]! - l) / (h - l)) * 100;
    }
    const k = (2 / 3) * kPrev + (1 / 3) * rsv;
    const d = (2 / 3) * dPrev + (1 / 3) * k;
    out[i] = { k, d, j: 3 * k - 2 * d };
    kPrev = k;
    dPrev = d;
  }
  return out;
}

/* ---------------- 日 K → 周/月 K 聚合 ---------------- */

export type KlinePeriod = "day" | "week" | "month";

/**
 * 周/月线聚合（专业模式周期切换用，纯展示聚合）：
 * - 周线：按 ISO 周（周一为界）分组；月线：按 YYYY-MM 分组；
 * - open = 组内首根开盘，close = 末根收盘，high/low = 组内极值，volume = 组内合计；
 * - date 取组内**最后一根**的日期（对齐行情软件「以收盘日标注该周期」的常见画法）。
 * 聚合不改变任何数值本身，只做分组与极值/求和，属展示层变换。
 */
export function aggregateKline(rows: readonly KlineBar[], period: KlinePeriod): KlineBar[] {
  if (period === "day" || rows.length === 0) return [...rows];
  const groups: KlineBar[] = [];
  let cur: KlineBar | null = null;
  let curKey = "";
  const keyOf = (date: string): string => {
    if (period === "week") {
      // ISO 周：周一为一周之始
      const d = new Date(`${date}T00:00:00`);
      const day = (d.getDay() + 6) % 7; // 周一=0
      d.setDate(d.getDate() - day);
      const p = (x: number) => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    return date.slice(0, 7); // YYYY-MM
  };
  for (const r of rows) {
    const key = keyOf(r.date);
    if (key !== curKey) {
      if (cur) groups.push(cur);
      cur = { date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
      curKey = key;
    } else if (cur) {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.volume += r.volume;
      cur.date = r.date;
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

/* ---------------- RSI（相对强弱指数） ---------------- */

/**
 * RSI(n)：相对强弱指数，默认 n=14（报告页口径）。A 股行情软件常见口径为
 * Wilder 平滑（不是简单平均递推）：
 * - 涨跌幅 chg = close[i] − close[i−1]；涨 = max(chg, 0)，跌 = max(−chg, 0)。
 * - 种子：前 n 根涨/跌的简单平均（avgGain/avgLoss）；之后按 Wilder 平滑递推：
 *   avgGain' = (avgGain×(n−1) + gain) / n，avgLoss 同理。
 * - RSI = 100 − 100/(1 + RS)，RS = avgGain/avgLoss；avgLoss = 0（窗口内全涨）时 RSI = 100。
 * - 前 n 根输出 null（窗口不足），不编值。
 */
export function rsi(values: readonly number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const chg = values[i]! - values[i - 1]!;
    if (chg >= 0) avgGain += chg;
    else avgLoss -= chg;
  }
  avgGain /= n;
  avgLoss /= n;
  const rsiAt = (): number => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[n] = rsiAt();
  for (let i = n + 1; i < values.length; i++) {
    const chg = values[i]! - values[i - 1]!;
    const gain = chg > 0 ? chg : 0;
    const loss = chg < 0 ? -chg : 0;
    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    out[i] = rsiAt();
  }
  return out;
}

/* ---------------- BIAS（乖离率） ---------------- */

/**
 * BIAS(n)：乖离率 = (close − MA(n)) / MA(n) × 100（百分比），默认 n=5。
 * 衡量收盘价偏离均线的程度；MA(n) 用本文件的 sma（简单移动平均）。
 * - 前 n−1 根 MA 为 null → BIAS 也为 null；MA=0（不可能）时兜底 null。
 * - 正乖离过大 = 短期涨幅过快（追高信号）；负乖离过大 = 短期超跌。
 *   报告页只用它做技术面评分与风险提示，不据此产出任何投资动作建议。
 */
export function bias(values: readonly number[], maN = 5): (number | null)[] {
  const ma = sma(values, maN);
  return values.map((v, i) => {
    const m = ma[i];
    return m == null || m === 0 ? null : ((v - m) / m) * 100;
  });
}

/* ---------------- 综合评分 + 多空倾向（报告页纯函数，展示口径） ----------------
 * 说明：本段是「报告生成模块」的展示层确定性评分，只在页面算、不落研究报告。
 * 与 calc/ 的报告口径（per AGENTS.md 由 calc 确定性函数出数）是两套东西：
 * 这里的分数/倾向只用于常用页大字卡展示，任何数字仍来自端点证据 + 上述纯函数。
 * 红线：只输出「评分 / 倾向 / 触发条件」，不提供任何投资动作建议。
 */

/** 资金面输入（报告页从 loadStockFundFlow 结果取） */
export interface FlowScoreInput {
  /** 当日主力净流入（元）；null = 资金未获取 */
  mainToday: number | null;
  /** 连续流入/流出（dir + days） */
  consecutive: { dir: "in" | "out" | null; days: number } | null;
  /** 5 日 / 20 日主力净流入合计（元）；null = 日序列不可得 */
  sum5: number | null;
  sum20: number | null;
}

/** 估值面输入（报告页从 loadStockValuation 结果取） */
export interface ValuationScoreInput {
  /** PE_TTM（倍）；<=0 或 null 视为「亏损 / 不可用」 */
  pe: number | null;
  /** PB（倍） */
  pb: number | null;
  /** PE / PB 历史分位（0-100，越低越便宜）；null = 未获取 */
  pePercentile: number | null;
  pbPercentile: number | null;
}

export interface CompositeScoreInput {
  /** 升序前复权日 K 收盘价序列（技术面用；不足 26 根时技术面按可得项计，缺项按中性） */
  closes: readonly number[];
  /** 资金面；null = 未获取，按中性 50 计 */
  flow: FlowScoreInput | null;
  /** 估值面；null = 未获取，按中性 50 计 */
  valuation: ValuationScoreInput | null;
}

export interface CompositeScoreResult {
  /** 0-100 综合分（整数） */
  score: number;
  /** 分级：偏多(≥60) / 中性(40-59) / 偏空(<40) */
  grade: "偏多" | "中性" | "偏空";
  /** 三因子子分（0-100，各因子内部已 clamp） */
  tech: number;
  flow: number;
  valuation: number;
  techNote: string;
  flowNote: string;
  valuationNote: string;
  /* —— 技术面细节（指标卡 / 风险点 / 倾向共用） —— */
  close: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  maArrangement: "多头" | "空头" | "盘整" | null;
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  macdSignal: "零轴上多头" | "金叉/多头运行" | "死叉/空头运行" | "零轴下空头" | null;
  rsiValue: number | null;
  rsiZone: "超买" | "强势" | "中性" | "弱势" | "超卖" | null;
  biasValue: number | null;
}

/** 取序列最后一个非 null 值（前段窗口不足跳 null，取到最新一个有效值） */
function lastFinite(s: readonly (number | null)[]): number | null {
  for (let i = s.length - 1; i >= 0; i--) {
    const v = s[i];
    if (v != null) return v;
  }
  return null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(100, v));

/** 技术面子分（0-100）：MA 排列 + MACD + RSI + 乖离率四小项等权平均；缺项不参与平均、全缺按中性 50。 */
function techScore(closes: readonly number[]): Pick<
  CompositeScoreResult,
  "tech" | "techNote" | "close" | "ma5" | "ma10" | "ma20" | "maArrangement" | "macdDif" | "macdDea" | "macdHist" | "macdSignal" | "rsiValue" | "rsiZone" | "biasValue"
> {
  const close = closes.length > 0 ? closes[closes.length - 1]! : null;
  const ma5 = lastFinite(sma(closes, 5));
  const ma10 = lastFinite(sma(closes, 10));
  const ma20 = lastFinite(sma(closes, 20));
  const macdLast = closes.length > 0 ? macd(closes)[closes.length - 1]! : { dif: null, dea: null, hist: null };
  const macdDif = macdLast.dif;
  const macdDea = macdLast.dea;
  const macdHist = macdLast.hist;
  const rsiValue = lastFinite(rsi(closes, 14));
  const biasValue = lastFinite(bias(closes, 5));

  let sum = 0;
  let cnt = 0;
  const parts: string[] = [];

  // MA 排列（0-100）：多头 100 / 空头 0 / 其余 50（盘整）
  let maArrangement: CompositeScoreResult["maArrangement"] = null;
  if (ma5 !== null && ma10 !== null && ma20 !== null) {
    if (ma5 > ma10 && ma10 > ma20) {
      maArrangement = "多头";
      sum += 100;
      parts.push("均线多头排列");
    } else if (ma5 < ma10 && ma10 < ma20) {
      maArrangement = "空头";
      sum += 0;
      parts.push("均线空头排列");
    } else {
      maArrangement = "盘整";
      sum += 50;
      parts.push("均线盘整");
    }
    cnt++;
  }

  // MACD（0-100）
  let macdSignal: CompositeScoreResult["macdSignal"] = null;
  if (macdDif !== null && macdDea !== null) {
    if (macdDif > macdDea && macdDif > 0) {
      macdSignal = "零轴上多头";
      sum += 100;
      parts.push("MACD 零轴上多头");
    } else if (macdDif > macdDea) {
      macdSignal = "金叉/多头运行";
      sum += 70;
      parts.push("MACD 金叉/多头运行");
    } else if (macdDif < macdDea && macdDif < 0) {
      macdSignal = "零轴下空头";
      sum += 0;
      parts.push("MACD 零轴下空头");
    } else {
      macdSignal = "死叉/空头运行";
      sum += 35;
      parts.push("MACD 死叉/空头运行");
    }
    cnt++;
  }

  // RSI(14)（0-100）
  let rsiZone: CompositeScoreResult["rsiZone"] = null;
  if (rsiValue !== null) {
    if (rsiValue >= 50 && rsiValue <= 70) {
      rsiZone = "强势";
      sum += 100;
    } else if (rsiValue >= 40 && rsiValue < 50) {
      rsiZone = "中性";
      sum += 70;
    } else if (rsiValue > 70 && rsiValue <= 80) {
      rsiZone = "强势";
      sum += 60;
    } else if (rsiValue > 80) {
      rsiZone = "超买";
      sum += 30;
    } else if (rsiValue < 30) {
      rsiZone = "超卖";
      sum += 40;
    } else {
      rsiZone = "弱势";
      sum += 50;
    }
    parts.push(`RSI ${rsiValue.toFixed(0)}（${rsiZone}）`);
    cnt++;
  }

  // BIAS 乖离率（0-100）：正负都取绝对值，乖离越大越「过热 / 超跌」
  if (biasValue !== null) {
    const b = Math.abs(biasValue);
    if (b < 2) {
      sum += 100;
    } else if (b < 5) {
      sum += 70;
    } else {
      sum += 40;
    }
    parts.push(`乖离 ${biasValue >= 0 ? "+" : ""}${biasValue.toFixed(1)}%`);
    cnt++;
  }

  const tech = cnt === 0 ? 50 : Math.round(sum / cnt);
  return {
    tech,
    techNote: parts.length > 0 ? parts.join("；") : "技术面数据不足，按中性计",
    close,
    ma5,
    ma10,
    ma20,
    maArrangement,
    macdDif,
    macdDea,
    macdHist,
    macdSignal,
    rsiValue,
    rsiZone,
    biasValue,
  };
}

/** 资金面子分（0-100）：今日方向 ±20 + 连续流入/流出 ±20（每连续一天 ±4，封顶 20）+ 5/20 日各 ±5。 */
function flowScore(flow: FlowScoreInput | null): { flow: number; flowNote: string } {
  if (!flow) return { flow: 50, flowNote: "资金面未获取，按中性 50 计" };
  let s = 50;
  const notes: string[] = [];
  if (flow.mainToday != null) {
    const inc = flow.mainToday > 0 ? 20 : flow.mainToday < 0 ? -20 : 0;
    s += inc;
    notes.push(`当日主力${inc > 0 ? "净流入" : inc < 0 ? "净流出" : "持平"}`);
  }
  if (flow.consecutive?.dir) {
    const k = Math.min(flow.consecutive.days, 5);
    const inc = (flow.consecutive.dir === "in" ? 1 : -1) * k * 4;
    s += inc;
    notes.push(`连续${flow.consecutive.dir === "in" ? "流入" : "流出"}${flow.consecutive.days}天`);
  }
  if (flow.sum5 != null) {
    s += flow.sum5 > 0 ? 5 : flow.sum5 < 0 ? -5 : 0;
    notes.push(`5日${flow.sum5 > 0 ? "净流入" : flow.sum5 < 0 ? "净流出" : "持平"}`);
  }
  if (flow.sum20 != null) {
    s += flow.sum20 > 0 ? 5 : flow.sum20 < 0 ? -5 : 0;
    notes.push(`20日${flow.sum20 > 0 ? "净流入" : flow.sum20 < 0 ? "净流出" : "持平"}`);
  }
  return { flow: clamp01(s), flowNote: notes.length > 0 ? notes.join("；") : "资金面数据不足，按中性计" };
}

/** 估值面子分（0-100）：分位越低越便宜、分越高；PE 亏损或两分位都缺按中性 50。 */
function valuationScore(valuation: ValuationScoreInput | null): { valuation: number; valuationNote: string } {
  if (!valuation) return { valuation: 50, valuationNote: "估值面未获取，按中性 50 计" };
  const parts: number[] = [];
  const notes: string[] = [];
  if (valuation.pe != null && valuation.pe > 0 && valuation.pePercentile != null) {
    parts.push(100 - valuation.pePercentile);
    notes.push(`PE ${valuation.pe.toFixed(1)}倍（分位${Math.round(valuation.pePercentile)}%）`);
  }
  if (valuation.pb != null && valuation.pb > 0 && valuation.pbPercentile != null) {
    parts.push(100 - valuation.pbPercentile);
    notes.push(`PB ${valuation.pb.toFixed(2)}倍（分位${Math.round(valuation.pbPercentile)}%）`);
  }
  if (parts.length === 0) {
    return {
      valuation: 50,
      valuationNote: valuation.pe != null && valuation.pe <= 0 ? "PE 为负（亏损），估值分按中性计" : "估值分位未获取，按中性 50 计",
    };
  }
  const val = clamp01(Math.round(parts.reduce((a, b) => a + b, 0) / parts.length));
  return { valuation: val, valuationNote: notes.join("；") };
}

/**
 * 综合评分（0-100）：技术面 50% + 资金面 30% + 估值面 20%。
 * 权重口径（架构师定稿）：技术面 50 / 资金面 30 / 估值面 20。
 * 分级：偏多 ≥60 / 中性 40-59 / 偏空 <40。
 */
export function scoreComposite(input: CompositeScoreInput): CompositeScoreResult {
  const t = techScore(input.closes);
  const f = flowScore(input.flow);
  const v = valuationScore(input.valuation);
  const score = clamp01(Math.round(t.tech * 0.5 + f.flow * 0.3 + v.valuation * 0.2));
  const grade: CompositeScoreResult["grade"] = score >= 60 ? "偏多" : score >= 40 ? "中性" : "偏空";
  return { score, grade, tech: t.tech, flow: f.flow, valuation: v.valuation, techNote: t.techNote, flowNote: f.flowNote, valuationNote: v.valuationNote, close: t.close, ma5: t.ma5, ma10: t.ma10, ma20: t.ma20, maArrangement: t.maArrangement, macdDif: t.macdDif, macdDea: t.macdDea, macdHist: t.macdHist, macdSignal: t.macdSignal, rsiValue: t.rsiValue, rsiZone: t.rsiZone, biasValue: t.biasValue };
}

/* ---------------- 短期 / 长期倾向（报告页纯函数） ---------------- */

export interface LeanResult {
  direction: "偏多" | "中性" | "偏空";
  /** 一句话理由（大白话，结论前置） */
  reason: string;
  /** 触发条件：什么数据出现会确认/改变这个倾向（只描述数据，不构成动作建议） */
  trigger: string;
}

const fmt2 = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null): string => (v === null ? "—" : v.toFixed(1));

/**
 * 短期/长期倾向。
 * - 短期（约 1-2 周）：看 MACD 多空 + RSI 区间 + 乖离率 + 5 日资金，偏快。
 * - 长期（约 1-3 月）：看收盘 vs MA20 + MACD 零轴 + 20 日资金 + 估值分位，偏慢。
 * 倾向只是对当前证据的客观归类，不是方向性承诺；触发条件写「什么数据出来会改变判断」。
 */
export function reportLeaning(
  score: CompositeScoreResult,
  flow: FlowScoreInput | null,
  valuation: ValuationScoreInput | null,
): { short: LeanResult; long: LeanResult } {
  const macdBull = score.macdSignal === "零轴上多头" || score.macdSignal === "金叉/多头运行";
  const macdBear = score.macdSignal === "零轴下空头" || score.macdSignal === "死叉/空头运行";
  const sum5 = flow?.sum5 ?? null;
  const sum20 = flow?.sum20 ?? null;
  const mainToday = flow?.mainToday ?? null;

  // —— 短期 ——
  const shortBull = macdBull
    && score.rsiValue !== null && score.rsiValue >= 40 && score.rsiValue < 70
    && !(score.biasValue !== null && score.biasValue > 5)
    && (sum5 === null || sum5 >= 0 || (mainToday ?? 0) > 0);
  const shortBear = macdBear && (mainToday ?? 0) < 0 && (sum5 ?? 0) < 0;
  const short: LeanResult = shortBull
    ? {
        direction: "偏多",
        reason: `短期技术面偏强：MACD ${score.macdSignal}、RSI ${fmt1(score.rsiValue)} 处于健康强势区、乖离率 ${fmt1(score.biasValue)}%${sum5 === null ? "" : sum5 >= 0 ? "，且 5 日主力净流入为正" : "，但资金面偏弱"}.`,
        trigger: `若后续收盘价站稳 MA10（${fmt2(score.ma10)}）之上且 MACD 维持金叉，则「偏多」倾向成立；失守则转中性。`,
      }
    : shortBear
      ? {
          direction: "偏空",
          reason: `短期动能偏弱：MACD ${score.macdSignal}，且当日与 5 日主力资金均净流出。`,
          trigger: `若收盘价站回 MA5（${fmt2(score.ma5)}）之上并伴随主力资金转净流入，则「偏空」倾向减弱。`,
        }
      : {
          direction: "中性",
          reason: score.rsiValue !== null && score.rsiValue > 80
            ? `短期超买（RSI ${fmt1(score.rsiValue)}），动能仍强但追高风险累积，暂无单边倾向。`
            : score.biasValue !== null && score.biasValue > 5
              ? `短期正乖离偏大（${fmt1(score.biasValue)}%），涨幅过快，多空需再确认。`
              : `短期多空信号交织，暂无明显单边倾向。`,
          trigger: `若收盘价站稳 MA10（${fmt2(score.ma10)}）之上且主力资金转净流入，则偏向「偏多」；跌破 MA20（${fmt2(score.ma20)}）则偏向「偏空」。`,
        };

  // —— 长期 ——
  const closeAboveMa20 = score.close !== null && score.ma20 !== null && score.close > score.ma20;
  const closeBelowMa20 = score.close !== null && score.ma20 !== null && score.close < score.ma20;
  const difAboveZero = score.macdDif !== null && score.macdDif > 0;
  const difBelowZero = score.macdDif !== null && score.macdDif < 0;
  const valuationOk = valuation == null
    || ((valuation.pePercentile ?? 0) < 70 && (valuation.pbPercentile ?? 0) < 70);
  const longBull = closeAboveMa20 && difAboveZero && (sum20 === null || sum20 >= 0) && valuationOk;
  const longBear = closeBelowMa20 && difBelowZero && (sum20 ?? 0) < 0;
  const long: LeanResult = longBull
    ? {
        direction: "偏多",
        reason: `中长期趋势向好：收盘在 MA20（${fmt2(score.ma20)}）上方、MACD 位于零轴之上${sum20 === null ? "" : sum20 >= 0 ? "，20 日主力资金净流入" : ""}${valuationOk ? "，估值未处历史高位" : ""}.`,
        trigger: `若收盘价持续站稳 MA20（${fmt2(score.ma20)}）之上且 DIF 维持零轴上方，则长期「偏多」成立。`,
      }
    : longBear
      ? {
          direction: "偏空",
          reason: `中长期趋势偏弱：收盘在 MA20（${fmt2(score.ma20)}）下方、MACD 位于零轴之下，且 20 日主力资金净流出。`,
          trigger: `若收盘价收复 MA20（${fmt2(score.ma20)}）且 DIF 上穿零轴，则长期「偏空」倾向减弱。`,
        }
      : {
          direction: "中性",
          reason: `中长期趋势不明：均线、MACD 零轴与 20 日资金未能形成一致方向，需继续观察。`,
          trigger: `若收盘价站稳 MA20（${fmt2(score.ma20)}）之上则偏多；持续处于 MA20 之下则偏空。`,
        };

  return { short, long };
}
