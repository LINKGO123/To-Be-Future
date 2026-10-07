/**
 * 资金雷达工作台 · 世界股票指数卡取数层
 * ------------------------------------------------------------
 * 首页「世界股票」区：一排全球主要指数小卡（横排，可横向滚动），每卡
 * 现价 + 当日涨跌 + 近5日 + YTD + 近20日（红涨绿跌）。
 *
 * 数据源（实测结论，见报告）：
 * - 现价 / 当日涨跌：tx_quotes_batch（腾讯批量行情），覆盖 A股四大指数 +
 *   美股道指纳指标普 + 港股恒生与恒生科技，共 8 个指数。
 * - 历史涨跌（近5日 / YTD / 近20日）：腾讯指数日 K 直连（web.ifzq.gtimg.cn，
 *   零鉴权、CORS *、不封 IP，与 loadStockMinute 的直连同一套路）。A股 / 港股
 *   指数走 fqkline/get，美股指数走 usfqkline/get；取不到对应项返回 null（显示「—」）。
 * - 日经225（znb_NKY）/ 韩国KOSPI（znb_KOSPI）：新浪 hq.sinajs.cn 全球指数有数据但无 CORS，
 *   浏览器不能直连 → 走后端 /global-index 只读代理（白名单 + 鉴权 + GBK 解码），
 *   取现价 + 当日涨跌；历史 K 线腾讯/新浪都拿不到 → 近5日 / YTD / 近20日显示「—」，不伪造。
 *
 * 红线：只展示端点证据与腾讯 raw 日 K 的确定性涨跌计算，不产出任何投资建议；
 * 取不到一律 null（页面显示「—」），绝不编值。
 */
import { backend, num, round2, rows, str } from "./backend";
import { fetchFr, frTodayKey } from "./fundradarData";

/* ---------------- 指数清单 ---------------- */

export type FrWorldMarket = "CN" | "US" | "HK" | "JP" | "KR";

export interface FrWorldIndexMeta {
  key: string;
  /** 展示名（无 emoji） */
  name: string;
  /** 腾讯代码（usIXIC / hkHSI / sh000001…）；日经/KOSPI 为新浪全球指数代码（znb_NKY / znb_KOSPI） */
  code: string;
  market: FrWorldMarket;
  /** 走新浪全球指数代理（znb_*，仅现价 + 当日涨跌；历史涨跌无源 → 显示「—」） */
  sina?: boolean;
}

export const WORLD_INDEX_LIST: readonly FrWorldIndexMeta[] = [
  { key: "nasdaq", name: "纳斯达克", code: "usIXIC", market: "US" },
  { key: "dow", name: "道琼斯", code: "usDJI", market: "US" },
  { key: "sp500", name: "标普500", code: "usINX", market: "US" },
  { key: "hsi", name: "恒生指数", code: "hkHSI", market: "HK" },
  { key: "hstech", name: "恒生科技", code: "hkHSTECH", market: "HK" },
  { key: "sh", name: "上证指数", code: "sh000001", market: "CN" },
  { key: "sz", name: "深证成指", code: "sz399001", market: "CN" },
  { key: "chinext", name: "创业板指", code: "sz399006", market: "CN" },
  { key: "nikkei", name: "日经225", code: "znb_NKY", market: "JP", sina: true },
  { key: "kospi", name: "韩国KOSPI", code: "znb_KOSPI", market: "KR", sina: true },
];

/* ---------------- 卡片数据 ---------------- */

export interface FrWorldIndex {
  key: string;
  name: string;
  code: string;
  market: FrWorldMarket;
  /** 现价（源单位：A股元 / 美股美元 / 港股港元） */
  price: number | null;
  /** 当日涨跌幅 % */
  chg: number | null;
  /** 近 5 个交易日涨跌幅 %；null = 未取到（显示「—」） */
  chg5: number | null;
  /** 年初至今（YTD）涨跌幅 %；null = 未取到 */
  ytd: number | null;
  /** 近 20 个交易日涨跌幅 %；null = 未取到 */
  chg20: number | null;
  dataDate: string;
}

/* ---------------- 历史涨跌计算（纯函数） ---------------- */

interface ClosePoint {
  date: string;
  close: number;
}

/** 涨跌幅 = (cur − base) ÷ base × 100；base 缺失 / 为 0 → null */
function pctReturn(cur: number, base: number | null): number | null {
  if (base == null || !Number.isFinite(cur) || !Number.isFinite(base) || base === 0) return null;
  return ((cur - base) / base) * 100;
}

/**
 * 由按日期升序的收盘序列算三个区间涨跌：
 * - 近5日  = 最新收盘 vs 5 个交易日前收盘
 * - 近20日 = 最新收盘 vs 20 个交易日前收盘
 * - YTD    = 最新收盘 vs 当前自然年首个交易日收盘
 * 样本不足 / 找不到年初交易日 → 对应项 null。
 */
function calcReturns(closes: ClosePoint[]): { chg5: number | null; ytd: number | null; chg20: number | null } {
  const n = closes.length;
  if (n === 0) return { chg5: null, ytd: null, chg20: null };
  const last = closes[n - 1]!;
  // offset 个交易日前：closes[n-1-offset]（offset=5 需要 n≥6 个样本）
  const closeAgo = (offset: number): number | null => (n > offset ? (closes[n - 1 - offset]?.close ?? null) : null);

  const chg5 = round2(pctReturn(last.close, closeAgo(5)));
  const chg20 = round2(pctReturn(last.close, closeAgo(20)));

  const year = last.date.slice(0, 4);
  const firstOfYear = closes.find((c) => c.date.slice(0, 4) === year);
  const ytd = firstOfYear && firstOfYear !== last ? round2(pctReturn(last.close, firstOfYear.close)) : null;

  return { chg5, ytd, chg20 };
}

/* ---------------- 腾讯指数日 K（直连，零鉴权） ---------------- */

/** 拉取天数：约一年（覆盖 YTD 年初首个交易日，含节假日余量） */
const KLINE_BARS = 260;

/** 腾讯指数日 K 端点：美股走 usfqkline，A股 / 港股走 fqkline（字段列序一致） */
function klineEndpoint(code: string): string {
  return code.startsWith("us") ? "usfqkline" : "fqkline";
}

/**
 * 直连腾讯指数日 K：返回按日期升序的 {date, close} 序列。
 * 响应 data.<code>.day = [date, open, close, high, low, vol, …]（美股多几个尾列，前 6 列一致）。
 * 任何失败（CORS / 非 JSON / 空序列）→ null，由调用方显示「—」，不抛错。
 */
async function fetchIndexCloses(code: string): Promise<ClosePoint[] | null> {
  try {
    const ep = klineEndpoint(code);
    const url = `https://web.ifzq.gtimg.cn/appstock/app/${ep}/get?param=${code},day,,,${KLINE_BARS},qfq`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, { day?: unknown[] }> };
    const day = json.data?.[code]?.day;
    if (!Array.isArray(day)) return null;
    const closes: ClosePoint[] = [];
    for (const row of day) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const date = String(row[0] ?? "").slice(0, 10);
      const close = Number(row[2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
      closes.push({ date, close });
    }
    closes.sort((a, b) => a.date.localeCompare(b.date));
    return closes.length > 0 ? closes : null;
  } catch {
    return null;
  }
}

/* ---------------- 整区装配 ---------------- */

/**
 * 取整区 10 张指数卡：现价/当日涨跌，8 个腾讯覆盖指数走 tx_quotes_batch（一次），
 * 日经/韩国走新浪全球指数代理（/global-index）；历史涨跌走腾讯指数日 K（8 个直连并行），
 * 日经/韩国无历史 K 线源 → 三项显示「—」。**永不 throw** —— 单个指数失败只把对应项置 null，
 * 页面据此渲染「—」，整区不崩。
 */
export async function loadWorldIndices(refresh: boolean): Promise<FrWorldIndex[]> {
  const txList = WORLD_INDEX_LIST.filter((m) => !m.sina);
  const sinaList = WORLD_INDEX_LIST.filter((m) => m.sina);
  const txCodes = txList.map((m) => m.code);
  let dataDate = frTodayKey();

  // ① 现价 + 当日涨跌（腾讯批量行情，8 个指数）
  const quoteMap = new Map<string, { price: number | null; chg: number | null; name: string }>();
  try {
    const res = await fetchFr("tx_quotes_batch", { codes: txCodes }, { refresh, dayCache: false });
    dataDate = res.data_date || dataDate;
    const rs = rows(res.envelope);
    for (const m of txList) {
      const r = rs.find((x) => x.key === m.code);
      quoteMap.set(m.code, {
        price: r ? num(r.fields["price"]) : null,
        chg: r ? num(r.fields["change_pct"]) : null,
        name: (r ? str(r.fields["security_name"]) : "") || m.name,
      });
    }
  } catch {
    /* 行情整体失败：8 个指数现价/当日涨跌显示「—」，仍渲染卡片骨架不抛 */
  }

  // ② 历史涨跌（腾讯指数日 K，8 个并行直连）
  const returnsMap = new Map<string, { chg5: number | null; ytd: number | null; chg20: number | null }>();
  await Promise.all(
    txList.map(async (m) => {
      const closes = await fetchIndexCloses(m.code);
      returnsMap.set(m.code, closes ? calcReturns(closes) : { chg5: null, ytd: null, chg20: null });
    }),
  );

  // ③ 日经/韩国等新浪全球指数：现价 + 当日涨跌走后端 /global-index 代理；历史涨跌无源 → 三项「—」
  //    展示名用清单里的稳定中文名（日经225 / 韩国KOSPI），不用新浪返回的源名（首尔综合指数）。
  const sinaMap = new Map<string, { price: number | null; chg: number | null }>();
  if (sinaList.length > 0) {
    try {
      const list = await backend.globalIndex(sinaList.map((m) => m.code));
      for (const m of sinaList) {
        const r = list.find((x) => x.code === m.code);
        sinaMap.set(m.code, {
          price: r?.price ?? null,
          chg: r?.changePct ?? null,
        });
      }
    } catch {
      /* 新浪全球指数代理失败：日经/韩国现价/当日涨跌显示「—」，不伪造 */
    }
  }

  return WORLD_INDEX_LIST.map((m) => {
    if (m.sina) {
      const q = sinaMap.get(m.code);
      return {
        key: m.key, name: m.name, code: m.code, market: m.market,
        price: q?.price ?? null, chg: q?.chg ?? null,
        chg5: null, ytd: null, chg20: null,
        dataDate,
      };
    }
    const q = quoteMap.get(m.code);
    const r = returnsMap.get(m.code);
    return {
      key: m.key, name: q?.name || m.name, code: m.code, market: m.market,
      price: q?.price ?? null, chg: q?.chg ?? null,
      chg5: r?.chg5 ?? null, ytd: r?.ytd ?? null, chg20: r?.chg20 ?? null,
      dataDate,
    };
  });
}
