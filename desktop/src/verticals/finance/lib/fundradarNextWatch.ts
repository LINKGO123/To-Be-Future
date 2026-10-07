/**
 * 资金雷达工作台 · 次日主线关注清单（刀7）
 * ------------------------------------------------------------
 * 职责：盘后（15:30 后）用真实主线数据生成「次日关注清单」——主线方向 Top5 +
 * 涨停梯队高度 + 资金连续性（MVP 简版：主线 Top 板块 + 梯队高度），存 localStorage
 * `fr-next-watch`，每日复盘页读取展示、可回看。
 *
 * - 数据输入：复用 fundradarData 的 loadRadarCore（涨停池热度榜，按热度分降序，
 *   每项含涨停家数 / 资金净流入 / 最高连板 / 是否覆盖持仓）；代表股重取涨停池
 *   （盘后批刚刷新，fetchFrLatest 直接读当天缓存，不打上游），按连板高度降序取前 5。
 * - 生成：确定性规则（非 AI），与晨报 / 复盘文案（AI 生成）解耦——盘后批里
 *   fire-and-forget 跑一次即可，不依赖 AI 接入。
 * - 存储：localStorage `fr-next-watch`，结构 { dataDate, generatedAt, list }；
 *   页面按 dataDate 与当日数据日期对齐判断新鲜，防止读旧数据。
 * - 硬约束：不改 calc/datasources/orchestrator；不新增依赖；不碰密钥。
 */
import {
  fetchFrLatest, loadRadarCore, meaningfulZtPool, parseZtPool,
  type FrHeatRow, type FrZtStock,
} from "./fundradarData";
import { storageGet, storageSet } from "./storage";

/** localStorage 键：次日主线关注清单 */
export const FR_NEXT_WATCH_KEY = "fr-next-watch";

export interface FrNextWatchItem {
  /** 主线方向（板块名） */
  direction: string;
  /** 关注理由（大白话：涨停家数 / 资金 / 高度 / 覆盖持仓） */
  reason: string;
  /** 代表股名称（该板块涨停股按连板高度降序，Top 5；取不到时用最高连板股兜底） */
  stocks: string[];
}

export interface FrNextWatch {
  dataDate: string;
  generatedAt: string;
  list: FrNextWatchItem[];
}

/** 板块资金净流入（亿元）→ 大白话片段；不可用给空串（不为缺失编值）。 */
function flowText(flow: number | null): string {
  return flow == null ? "" : `、资金${flow > 0 ? "+" : ""}${flow}亿`;
}

/** 关注理由：涨停家数 + 资金（可得时）+ 最高连板 + 是否覆盖持仓。 */
function buildReason(h: FrHeatRow): string {
  return `${h.zt}家涨停${flowText(h.flow)}、最高${h.height}板${h.cover ? "、覆盖持仓" : ""}`;
}

/** 读已生成的次日关注清单（无 / 损坏返回 null；新鲜度由页面按 dataDate 判断）。 */
export function readNextWatch(): FrNextWatch | null {
  const raw = storageGet(FR_NEXT_WATCH_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.dataDate !== "string" || !Array.isArray(p.list)) return null;
    const list: FrNextWatchItem[] = [];
    for (const item of p.list as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.direction !== "string" || typeof o.reason !== "string") continue;
      const stocks: string[] = Array.isArray(o.stocks)
        ? (o.stocks as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
      list.push({ direction: o.direction, reason: o.reason, stocks });
    }
    return {
      dataDate: p.dataDate,
      generatedAt: typeof p.generatedAt === "string" ? p.generatedAt : "",
      list,
    };
  } catch {
    return null;
  }
}

/**
 * 盘后生成次日关注清单：主线热度榜 Top5 + 每个方向的代表股（连板高度降序）。
 * 核心主线数据缺失 / 解析失败返回 null，不抛错、不崩页面。
 */
export async function generateNextWatch(): Promise<FrNextWatch | null> {
  try {
    const radar = await loadRadarCore(false);
    if (!radar || radar.heat.length === 0) return null;

    // 代表股：重取涨停池（盘后批刚刷新，fetchFrLatest 命中当天缓存），按行业分组。
    const byIndustry = new Map<string, FrZtStock[]>();
    try {
      const walk = await fetchFrLatest("em_zt_pool", (ymd) => ({ date: ymd }), meaningfulZtPool, {});
      for (const s of parseZtPool(walk.result.envelope).stocks) {
        const ind = s.industry || "其他";
        const bucket = byIndustry.get(ind);
        if (bucket) bucket.push(s);
        else byIndustry.set(ind, [s]);
      }
    } catch {
      /* 涨停池个股取不到：stocks 用 topName（最高连板股）兜底 */
    }

    const list: FrNextWatchItem[] = radar.heat.slice(0, 5).map((h) => {
      const stocks = (byIndustry.get(h.name) ?? [])
        .slice()
        .sort((a, b) => b.days - a.days)
        .map((s) => s.name)
        .slice(0, 5);
      return {
        direction: h.name,
        reason: buildReason(h),
        stocks: stocks.length > 0 ? stocks : (h.topName ? [h.topName] : []),
      };
    });

    const out: FrNextWatch = {
      dataDate: radar.dataDate,
      generatedAt: new Date().toISOString(),
      list,
    };
    storageSet(FR_NEXT_WATCH_KEY, JSON.stringify(out));
    return out;
  } catch {
    return null;
  }
}
