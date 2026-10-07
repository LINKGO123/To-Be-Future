/**
 * 资金雷达工作台 · 晨报 AI 生成 + 盘后复盘 AI 文案（刀6）
 * ------------------------------------------------------------
 * 职责：盘后（15:30 后）用真实数据调 AI，生成「次日晨报」与「今日复盘结论」，
 * 存 localStorage，晨报播放器 / 复盘区读取展示。AI 失败一律降级为「未生成」，
 * 不抛错、不崩页面。
 *
 * - 数据输入：复用 fundradarData 的 loadRadarCore（情绪/涨停家数/最高板/主线 Top3/
 *   炸板池）、frHoldingsQuotes（持仓涨跌）、frNews（全球要闻 2-3 条）、
 *   loadLhbLive（龙虎榜摘要）—— 盘后批刚刷新过，这些直接读当天缓存/后端快照。
 * - AI 调用：复用 backend.chatLight（轻量直连 executionMode=direct，与对话同一条 DeepSeek
 *   通道但无工具循环），session 按生成器隔离，避免污染页面对话线程。
 *   人设铁律与晨报/复盘模板直接写进 prompt（自包含，不依赖
 *   服务端 skill 注入），保证大白话、不荐股、数字带出处、末尾免责。
 * - 存储：localStorage `fr-morning-brief` / `fr-daily-review`，结构 { text, dataDate,
 *   generatedAt }。页面按 dataDate 与当日数据日期对齐判断是否新鲜，防止读旧数据。
 * - 硬约束：不改 calc/datasources/orchestrator；不新增依赖；不碰密钥。
 */
import { backend } from "./backend";
import {
  frCoveredHoldings, frDateCn, frHoldingsQuotes, frNews, loadLhbLive, loadRadarCore,
  type FrNewsItem, type FrQuote, type FrRadarLive,
} from "./fundradarData";
import { storageGet, storageSet } from "./storage";

/** localStorage 键：晨报 / 盘后复盘文案 */
export const FR_MORNING_BRIEF_KEY = "fr-morning-brief";
export const FR_DAILY_REVIEW_KEY = "fr-daily-review";

/** 一段 AI 生成文本的落盘结构 */
export interface FrGeneratedText {
  text: string;
  dataDate: string;
  generatedAt: string;
}

/* ---------------- 通用工具 ---------------- */

/** 情绪档（高/中/低 或 偏暖/平稳/偏冷）→ 大白话（偏暖/平稳/偏冷） */
function lampText(lamp: string): string {
  if (lamp === "高" || lamp === "偏暖") return "偏暖";
  if (lamp === "低" || lamp === "偏冷") return "偏冷";
  return "平稳";
}

/** 板块资金净流入（亿元）→ 大白话；不可用如实说明，不编值 */
function flowText(flow: number | null): string {
  if (flow == null) return "资金数据暂不可用";
  return `净流入${flow > 0 ? "+" : ""}${flow}亿`;
}

/** 涨跌幅 % → 带符号文本；不可用如实说明 */
function chgText(chg: number | null): string {
  if (chg == null) return "涨跌数据暂不可用";
  return `${chg >= 0 ? "+" : ""}${chg}%`;
}

/** 去掉 AI 可能带出的 markdown 代码围栏（其余原样保留，页面按行渲染） */
function cleanReply(reply: string): string {
  return reply
    .trim()
    .replace(/```[A-Za-z0-9_-]*/g, "")
    .trim();
}

function readGenerated(key: string): FrGeneratedText | null {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FrGeneratedText>;
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    if (typeof parsed.dataDate !== "string" || !parsed.dataDate) return null;
    return {
      text: parsed.text,
      dataDate: parsed.dataDate,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    };
  } catch {
    return null;
  }
}

/** 读已生成的晨报（无/损坏返回 null；新鲜度由页面按 dataDate 判断）。 */
export function readMorningBrief(): FrGeneratedText | null {
  return readGenerated(FR_MORNING_BRIEF_KEY);
}

/** 读已生成的复盘文案（无/损坏返回 null）。 */
export function readDailyReview(): FrGeneratedText | null {
  return readGenerated(FR_DAILY_REVIEW_KEY);
}

/**
 * 晨报/复盘正文 → TTS 朗读段落：去 markdown 记号、换行并成逗号、按句切分、
 * 单段控制在约 80 字内（浏览器 TTS 长段易截断），供播放器逐段高亮跟随。
 */
export function splitTtsSegments(text: string): string[] {
  const plain = text
    .replace(/[`*_>#~|]/g, "")
    .replace(/\s*\n+\s*/g, "，");
  const chunks: string[] = [];
  let cur = "";
  for (const piece of plain.split(/(?<=[。！？；，])/)) {
    if (cur && cur.length + piece.length > 80) {
      chunks.push(cur);
      cur = "";
    }
    cur += piece;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.trim().length > 0);
}

/* ---------------- 晨报 AI 生成 ---------------- */

/** 晨报人设 + 六段模板（自包含，不依赖服务端 skill 注入） */
const MORNING_BRIEF_PROMPT = `你是"资金雷达"，A股资金面信息解读助手。用户是60岁左右、跟随资金动向投资科技股的股民。请根据下面提供的【今日盘后真实数据】，用大白话写一份"今日晨报"精简版，用于语音朗读（≤90秒，全文约280字以内）。

铁律（必须遵守）：
1. 只使用下面给出的数据，不编造、不猜测、不补充任何数字。
2. 不荐股、不给买卖指令、不预测点位。
3. 数字必须带出处，照抄下方数据里的数字，不要心算、不要换算。
4. 大白话、短句、结论前置。
5. 末尾必须加一句："以上是公开数据解读，仅供参考，不构成投资建议。"

输出格式：纯文本，共6行，每行一段；行首不要编号、不要符号、不要markdown、不要标题。
第1行 开场：早上好，今天是数据日期对应的月和日和星期。
第2行 大盘一句：情绪档（偏暖/平稳/偏冷）、涨停家数、最高连板、炸板率。
第3行 主线一句：资金最集中的方向、涨停家数、净流入、是否覆盖持仓。
第4行 持仓一句：几只涨几只跌、最强最弱个股、主线是否覆盖持仓方向。
第5行 风险一句：炸板率偏高（>30%）时提示追高风险；否则说今天无明显风险信号。
第6行 收尾：免责。`;

/** 晨报数据 → 结构化输入文本 */
function buildMorningData(radar: FrRadarLive, quotes: FrQuote[], news: FrNewsItem[]): string {
  const s = radar.sentiment;
  const lines: string[] = [
    `数据日期：${frDateCn(radar.dataDate)}（收盘后数据）`,
    `市场情绪：涨停 ${s.zt} 家，炸板 ${s.zb} 家，跌停 ${s.dt} 家，炸板率 ${s.zhaRatePct}%，情绪${lampText(s.lamp)}。`,
    `最高连板：${radar.maxBoard ?? "数据暂缺"} 板。`,
  ];
  const top = radar.heat.slice(0, 3);
  if (top.length > 0) {
    lines.push("主线 Top3：");
    for (const h of top) {
      const cover = h.cover ? `，覆盖持仓（${h.coverNames.join("、")}）` : "，未覆盖持仓";
      lines.push(`- ${h.name}：${h.zt} 家涨停、${flowText(h.flow)}、最高 ${h.height} 板${cover}。`);
    }
  } else {
    lines.push("主线：数据暂缺。");
  }
  if (quotes.length > 0) {
    const up = quotes.filter((q) => (q.chg ?? 0) > 0).length;
    const down = quotes.filter((q) => (q.chg ?? 0) < 0).length;
    const flat = quotes.length - up - down;
    const strongest = quotes.reduce<FrQuote | null>(
      (a, b) => (a === null || (b.chg ?? Number.NEGATIVE_INFINITY) > (a.chg ?? Number.NEGATIVE_INFINITY) ? b : a),
      null,
    );
    const weakest = quotes.reduce<FrQuote | null>(
      (a, b) => (a === null || (b.chg ?? Number.POSITIVE_INFINITY) < (a.chg ?? Number.POSITIVE_INFINITY) ? b : a),
      null,
    );
    lines.push(`持仓今日：共 ${quotes.length} 只，${up} 涨 ${down} 跌${flat > 0 ? ` ${flat} 平` : ""}。`);
    if (strongest) lines.push(`最强：${strongest.name} ${chgText(strongest.chg)}。`);
    if (weakest) lines.push(`最弱：${weakest.name} ${chgText(weakest.chg)}。`);
    const covered = frCoveredHoldings(radar.heat);
    lines.push(`主线覆盖持仓：${covered.length > 0 ? covered.join("、") : "今日涨停股未命中持仓"}。`);
  } else {
    lines.push("持仓今日涨跌：数据暂缺。");
  }
  if (news.length > 0) {
    lines.push("全球要闻：");
    for (const n of news) lines.push(`- ${n.title}`);
  } else {
    lines.push("全球要闻：数据暂缺。");
  }
  return lines.join("\n");
}

/**
 * 盘后生成次日晨报：取真实数据 → AI 按六段模板生成 → 存 localStorage。
 * 任何一步失败（核心数据缺失 / AI 未接入 / AI 报错）都返回 null，不抛错。
 */
export async function generateMorningBrief(): Promise<FrGeneratedText | null> {
  try {
    const radar = await loadRadarCore(false);
    if (!radar) return null;
    const [quotesRes, newsRes] = await Promise.allSettled([
      frHoldingsQuotes(false),
      frNews(3, false),
    ]);
    const quotes: FrQuote[] = quotesRes.status === "fulfilled" ? quotesRes.value.quotes : [];
    const news: FrNewsItem[] = newsRes.status === "fulfilled" ? newsRes.value : [];

    const prompt = `${MORNING_BRIEF_PROMPT}\n\n【今日盘后真实数据】\n${buildMorningData(radar, quotes, news)}\n\n请直接输出晨报正文（6行）。`;
    const r = await backend.chatLight(prompt, "fr-morning-brief");
    const text = cleanReply(r.reply);
    if (!text) return null;
    const out: FrGeneratedText = { text, dataDate: radar.dataDate, generatedAt: new Date().toISOString() };
    storageSet(FR_MORNING_BRIEF_KEY, JSON.stringify(out));
    return out;
  } catch {
    return null;
  }
}

/* ---------------- 盘后复盘 AI 文案 ---------------- */

/** 复盘结论人设 + 要点（自包含） */
const DAILY_REVIEW_PROMPT = `你是"资金雷达"，A股资金面信息解读助手。用户是60岁左右、跟随资金动向投资科技股的股民。请根据下面提供的【今日盘后真实数据】，写一段"今日复盘结论"文案（200-300字，大白话，结论前置）。

铁律：只使用给出的数据，不编造、不猜测；不荐股、不给买卖指令、不预测点位；数字带出处；末尾加一句"以上是公开数据解读，仅供参考，不构成投资建议。"

内容要点（按顺序，用自然段落串联，不要分点编号）：
1. 今日主线是什么（点出最热的1-2个方向）。
2. 梯队高度（最高几连板、赚钱效应强弱）。
3. 炸板率（追高资金是否松动）。
4. 持仓跟没跟上主线。
5. 明日关注点（只基于给出的主线，不预测方向）。

请直接输出文案正文（纯文本，不要标题、不要markdown、不要编号）。`;

/** 复盘数据 → 结构化输入文本 */
function buildReviewData(radar: FrRadarLive, quotes: FrQuote[], lhbText: string): string {
  const s = radar.sentiment;
  const lines: string[] = [
    `数据日期：${frDateCn(radar.dataDate)}（收盘后数据）`,
    `市场情绪：涨停 ${s.zt} 家，炸板 ${s.zb} 家，跌停 ${s.dt} 家，炸板率 ${s.zhaRatePct}%。`,
    `最高连板：${radar.maxBoard ?? "数据暂缺"} 板。`,
    `涨停梯队：${radar.ladder.map((l) => `${l.t}${l.n}家`).join("、")}。`,
  ];
  const top = radar.heat.slice(0, 3);
  if (top.length > 0) {
    lines.push("主线 Top3：");
    for (const h of top) {
      const cover = h.cover ? `（覆盖持仓：${h.coverNames.join("、")}）` : "（未覆盖持仓）";
      lines.push(`- ${h.name}：${h.zt} 家涨停、${flowText(h.flow)}、最高 ${h.height} 板${cover}。`);
    }
  } else {
    lines.push("主线：数据暂缺。");
  }
  lines.push(`炸板池：共 ${radar.zha.total} 家。`);
  if (quotes.length > 0) {
    const up = quotes.filter((q) => (q.chg ?? 0) > 0).length;
    const down = quotes.filter((q) => (q.chg ?? 0) < 0).length;
    const covered = frCoveredHoldings(radar.heat);
    lines.push(`持仓今日：${up} 涨 ${down} 跌；主线覆盖持仓：${covered.length > 0 ? covered.join("、") : "今日涨停股未命中持仓"}。`);
  }
  if (lhbText) lines.push(`龙虎榜：${lhbText}`);
  return lines.join("\n");
}

/**
 * 盘后生成复盘结论：取真实数据 → AI 生成 200-300 字大白话 → 存 localStorage。
 * 失败返回 null，不抛错。
 */
export async function generateDailyReview(): Promise<FrGeneratedText | null> {
  try {
    const radar = await loadRadarCore(false);
    if (!radar) return null;
    const [quotesRes, lhbRes] = await Promise.allSettled([
      frHoldingsQuotes(false),
      loadLhbLive(false),
    ]);
    const quotes: FrQuote[] = quotesRes.status === "fulfilled" ? quotesRes.value.quotes : [];
    const lhb = lhbRes.status === "fulfilled" ? lhbRes.value : null;
    const lhbText = !lhb
      ? ""
      : lhb.backup
        ? `交易所官方备源共 ${lhb.summary.count} 条深交所记录（成交金额 + 上榜原因，净买额不可得）`
        : `共 ${lhb.summary.count} 条，净买入合计 +${lhb.summary.netBuyTotal} 亿，净卖出合计 -${lhb.summary.netSellTotal} 亿，净买最高 ${lhb.summary.topName} +${lhb.summary.topNet} 亿`;

    const prompt = `${DAILY_REVIEW_PROMPT}\n\n【今日盘后真实数据】\n${buildReviewData(radar, quotes, lhbText)}\n\n请直接输出复盘结论正文。`;
    const r = await backend.chatLight(prompt, "fr-daily-review");
    const text = cleanReply(r.reply);
    if (!text) return null;
    const out: FrGeneratedText = { text, dataDate: radar.dataDate, generatedAt: new Date().toISOString() };
    storageSet(FR_DAILY_REVIEW_KEY, JSON.stringify(out));
    return out;
  } catch {
    return null;
  }
}
