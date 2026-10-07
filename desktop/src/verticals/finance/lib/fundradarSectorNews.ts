/**
 * 资金雷达工作台 · 板块利好利空新闻（刀8）
 * ------------------------------------------------------------
 * 职责：从 RSS 新闻雷达取 4 大板块（科技链 / 新能源 / 医药 / 金融）的新闻，
 * **一次 AI 调用批量判断**每条情绪（利好 / 利空 / 中性）+ 影响力分
 * （强度 × 板块相关性），每板块保留全部候选（科技链/新能源/医药各 25 条、金融 5 条，
 * 影响力降序、未判出排末尾），存 localStorage `fr-sector-news`，
 * 首页「板块要闻」与个股页「所属板块要闻」读取并按页（每页 10 条）展示。
 *
 * 刷新策略（新闻 24 小时都有，改为每小时刷新 + 手动刷新，不再只在盘后生成）：
 * - 每小时自动刷新：fundradarAutoRefresh 每次 tick 判断「距上次生成 ≥1 小时」
 *   （sectorNewsDue / lastSectorNewsGenAt）就重新生成；交易 / 非交易时段都刷。
 * - 盘后批：盘后那次 generateSectorNews 保留，也算一次刷新并重置「上次生成时间」。
 * - 手动刷新：FrSectorNews 区「刷新」按钮直接调 generateSectorNews，busy 防连点。
 * - generateSectorNews 可重复调用；并发调用复用同一在途 Promise，避免重复打 AI。
 *
 * - 数据源：rss_news（106 策展源 × 12 行业，有 industry 行业标签 + link 原文链接）。
 *   行业映射：科技链 = ai/semi/robot/tech/space/security/science；
 *   新能源 = energy/auto；医药 = bio；金融 = 无对应标签 → 用 macro（宏观）近似、
 *   取少量并标注「数据源受限·宏观口径」。
 * - AI 批量：每板块一次 backend.chatLight（轻量直连 executionMode=direct，无工具循环），
 *   prompt 放一批「编号=标题」，AI 返回 JSON [{i, sentiment, score}]，避免每条一次调用。
 *   失败降级：新闻仍显示、无情绪标签
 *   （sentiment/score = null），页面标注「情绪判断暂不可用」。
 * - 存储：localStorage `fr-sector-news`，结构 { dataDate, generatedAt, sectors, notes, aiOk }；
 *   页面按 dataDate 判断新鲜；「上次生成时间」另存 `fr-sector-news-last-gen` 供每小时判断。
 * - 硬约束：不改 calc/datasources/orchestrator；不新增依赖；不碰密钥。
 */
import { backend, noteKV, str, type Envelope } from "./backend";
import { fetchFr } from "./fundradarData";
import { storageGet, storageSet } from "./storage";

/** 四大板块名（展示顺序固定） */
export type FrSectorKey = "科技链" | "新能源" | "医药" | "金融";
export const FR_SECTORS: readonly FrSectorKey[] = ["科技链", "新能源", "医药", "金融"];

/** AI 情绪三档 */
export type FrNewsSentiment = "利好" | "利空" | "中性";

/** localStorage 键：板块利好利空新闻 */
export const FR_SECTOR_NEWS_KEY = "fr-sector-news";
/** 生成完成事件（生成批写入 localStorage 后派发，首页/个股页监听到即重读缓存） */
export const FR_SECTOR_NEWS_UPDATED = "fr-sector-news-updated";
/** localStorage 键：上次新闻生成时间（ISO；每次成功生成后写入，供每小时自动刷新判断） */
export const FR_SECTOR_NEWS_LAST_GEN_KEY = "fr-sector-news-last-gen";
/** 板块新闻每小时刷新间隔（毫秒） */
export const FR_SECTOR_NEWS_INTERVAL_MS = 60 * 60 * 1000;

/** RSS 行业标签 → 中文名（与 fundradarData.ts 的 RSS_TAG_LABELS 对齐） */
const RSS_TAG_LABELS: Record<string, string> = {
  ai: "AI", semi: "半导体", robot: "机器人", auto: "汽车", energy: "能源", bio: "医药",
  space: "航天", security: "安全", tech: "科技", consumer: "消费", macro: "宏观", science: "科学",
};

/** 板块 → RSS 行业标签映射（rss_sources.json 的 hint 值） */
export const SECTOR_INDUSTRY_MAP: Record<FrSectorKey, string[]> = {
  科技链: ["ai", "semi", "robot", "tech", "space", "security", "science"],
  新能源: ["energy", "auto"],
  医药: ["bio"],
  // 金融：RSS 无「金融」标签，用 macro（财经/宏观）近似，标注「数据源受限」
  金融: ["macro"],
};

/** 概念板块名 → 板块关键词（个股页按 em_concept_blocks 归属过滤用，启发式） */
export const SECTOR_BOARD_KEYWORDS: Record<FrSectorKey, string[]> = {
  科技链: [
    "AI", "半导体", "芯片", "机器人", "科技", "算力", "服务器", "消费电子", "电子", "PCB",
    "航天", "安全", "软件", "互联网", "通信", "计算机", "TMT", "云计算", "数据中心", "激光",
    "光学", "面板", "封测", "存储", "信创", "国产软件", "光模块",
  ],
  新能源: [
    "新能源", "汽车", "锂电", "光伏", "储能", "风电", "电池", "充电", "氢能", "电力",
    "能源", "整车", "零部件", "电网", "特高压",
  ],
  医药: ["医药", "生物", "医疗", "制药", "疫苗", "创新药", "医疗器械", "中药", "CXO", "基因"],
  金融: ["金融", "银行", "证券", "保险", "券商", "信托", "多元金融"],
};

/** RSS 行业标签 → 板块（consumer 等未纳入四板块的行业返回 null，跳过） */
export function industryToSector(industry: string): FrSectorKey | null {
  for (const sector of FR_SECTORS) {
    if (SECTOR_INDUSTRY_MAP[sector].includes(industry)) return sector;
  }
  return null;
}

/** 概念板块名列表 → 四板块之一；命中多个时取第一个板块的首个命中（顺序即展示顺序）。 */
export function stockBoardsToSector(boards: readonly string[]): FrSectorKey | null {
  for (const sector of FR_SECTORS) {
    const kws = SECTOR_BOARD_KEYWORDS[sector];
    for (const board of boards) {
      if (kws.some((k) => board.includes(k))) return sector;
    }
  }
  return null;
}

/** 一条板块新闻（情绪/影响力由 AI 判断；失败时两者为 null） */
export interface FrSectorNewsItem {
  title: string;
  src: string;
  /** 原始 RSS 行业标签（ai/semi/…/macro） */
  industry: string;
  /** 行业中文名（AI / 半导体 / …） */
  industryLabel: string;
  /** 原文链接（点击跳转来源） */
  url: string;
  /** MM-DD HH:MM（拿不到为空串） */
  time: string;
  /** 利好 / 利空 / 中性；AI 失败为 null */
  sentiment: FrNewsSentiment | null;
  /** 影响力分 0-100（强度 × 板块相关性）；AI 失败为 null */
  score: number | null;
  /** 标题语言标签：含中文=「中」，纯英文/数字=「英」（仅展示，不做筛选） */
  lang: "中" | "英";
}

/** 板块新闻落盘结构 */
export interface FrSectorNews {
  dataDate: string;
  generatedAt: string;
  sectors: Record<FrSectorKey, FrSectorNewsItem[]>;
  /** 板块说明（金融 = 「数据源受限·宏观口径」；其余空串） */
  notes: Record<FrSectorKey, string>;
  /** 是否至少一个板块拿到了 AI 情绪判断 */
  aiOk: boolean;
}

/* ---------------- 解析 ---------------- */

/** 标题语言判定：含中文字符（[\u4e00-\u9fa5]）=「中」，否则「英」（纯英文/数字）。 */
function detectLang(title: string): "中" | "英" {
  return /[\u4e00-\u9fa5]/.test(title) ? "中" : "英";
}

/** rss_news 信封 → 带行业标签的候选新闻列表（sentiment/score 初始为 null） */
function parseCandidates(env: Envelope): FrSectorNewsItem[] {
  const out: FrSectorNewsItem[] = [];
  for (const e of env.evidence ?? []) {
    if (e.field !== "news_title") continue;
    const title = str(e);
    if (!title) continue;
    // note 形如 "source=…;industry=ai;link=…;redline=…"（见 mappers_cn.rss_news_map）
    const kv = noteKV(e.note);
    const industry = kv.industry ?? "";
    out.push({
      title,
      src: kv.source || "RSS 策展",
      industry,
      industryLabel: RSS_TAG_LABELS[industry] ?? "产业",
      url: kv.link ?? "",
      time: typeof e.period === "string" ? e.period.replace(/^\d{4}-/, "") : "",
      sentiment: null,
      score: null,
      lang: detectLang(title),
    });
  }
  return out;
}

/**
 * 取 RSS 新闻并按板块分组（一次取数，覆盖全部 12 行业 → 4 板块）。
 * - registry 默认 args 是 industry:"ai"，不传就只取 ai 行业（16 源）；这里显式传
 *   industry:null 覆盖默认值，让 rss_news 走「全部源」分支（106 源 × 12 行业）。
 *   max_sources=120 ≥ 106 保证不截断（清单按行业分组，science 排在末尾，需拉满才覆盖到）。
 * - 🔴 不能传 limit：rss_news 函数签名没有 limit 形参（实测 TypeError
 *   "unexpected keyword argument 'limit'"），映射层按默认 80 条截断。
 *   实测 80 条覆盖 11 行业，四板块（科技链/新能源/医药/金融）均有候选。
 * - 失败抛错，由 generateSectorNews 收口返回 null（不崩页面）。
 */
export async function fetchSectorCandidates(refresh: boolean): Promise<{
  dataDate: string;
  bySector: Record<FrSectorKey, FrSectorNewsItem[]>;
}> {
  const res = await fetchFr(
    "rss_news",
    { industry: null, max_sources: 120, per_source: 3, recent_days: 3 },
    { refresh },
  );
  const bySector: Record<FrSectorKey, FrSectorNewsItem[]> = { 科技链: [], 新能源: [], 医药: [], 金融: [] };
  for (const c of parseCandidates(res.envelope)) {
    const sector = industryToSector(c.industry);
    if (sector) bySector[sector].push(c);
  }
  return { dataDate: res.data_date, bySector };
}

/* ---------------- AI 批量情绪判断 ---------------- */

const SECTOR_JUDGE_PROMPT = `你是"资金雷达"的板块新闻情绪判断器。请对下面这批新闻标题，逐条判断它对【{sector}】板块短期表现的影响：
- sentiment：只能是"利好" / "利空" / "中性"三选一（对板块的影响方向；不要用"正面/看多/负面/看空"等同义说法）
- score：0-100 的整数（影响力分 = 新闻强度 × 与该板块的相关性；越大越值得关注；泛泛、行业外、中性消息给低分）

铁律：
1. 只判断下面给出的标题，不编造、不补充。
2. 每条新闻都要给出一条判断，缺一不可；序号 i 从 1 开始，与输入编号一一对应。
3. sentiment 只能是"利好" / "利空" / "中性"三选一；score 是 0-100 的整数。
4. 只输出 JSON 数组，不要任何解释、不要 markdown、不要代码围栏、不要额外文字。

输出格式（必须只输出这个 JSON 数组，不要任何解释、不要 markdown、不要代码围栏）：
[{"i":1,"sentiment":"利好","score":80}]`;

/** 去掉 AI 可能带出的 markdown 代码围栏 */
function stripFences(text: string): string {
  return text.replace(/```[A-Za-z0-9_-]*/g, "").trim();
}

/** AI 情绪同义词 → 三档（其余返回 null）。 */
const SENTIMENT_SYNONYMS: Record<string, FrNewsSentiment> = {
  利好: "利好", 正面: "利好", 看多: "利好", 积极: "利好", 偏多: "利好", 利多: "利好",
  利空: "利空", 负面: "利空", 看空: "利空", 消极: "利空", 偏空: "利空", 利淡: "利空",
  中性: "中性", 中立: "中性", 平稳: "中性",
};

/** 情绪字符串 → 三档；不是受认可的字面值（含同义词）返回 null。 */
function normalizeSentiment(raw: unknown): FrNewsSentiment | null {
  if (typeof raw !== "string") return null;
  return SENTIMENT_SYNONYMS[raw.trim()] ?? null;
}

/** 影响力分容错解析：数字或数字字符串 → 0-100 整数；空串 / 非法 → null。 */
function normalizeScore(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw
    : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim())
      : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** AI 判断命中：sentiment 必填（判不出该条放弃），score 可空（容错失败）。 */
type FrJudgeHit = { sentiment: FrNewsSentiment; score: number | null };

/** AI 回复 → 编号→{sentiment,score}；形状非法/全空返回 null（降级：无情绪标签）。 */
function parseJudgeReply(
  reply: string,
  expected: number,
): Map<number, FrJudgeHit> | null {
  const cleaned = stripFences(reply);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const map = new Map<number, FrJudgeHit>();
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const idxRaw = o["i"] ?? o["index"] ?? o["id"];
    const idx = typeof idxRaw === "number" ? idxRaw : Number(idxRaw);
    // i 保持 1 基（prompt 要求 i 从 1 开始）；越界 / 非整数只跳过该条，不影响其它条目。
    if (!Number.isInteger(idx) || idx < 1 || idx > expected) continue;
    const sentiment = normalizeSentiment(o["sentiment"]);
    if (!sentiment) continue; // 情绪判不出 → 只放弃这一条
    const score = normalizeScore(o["score"]);
    map.set(idx, { sentiment, score });
  }
  return map.size > 0 ? map : null;
}

/** 一批标题 → 一次 AI 调用批量判断；失败返回 null（不抛，调用方降级）。 */
async function judgeBatch(
  sector: FrSectorKey,
  titles: string[],
): Promise<Map<number, FrJudgeHit> | null> {
  if (titles.length === 0) return null;
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const prompt = `${SECTOR_JUDGE_PROMPT.replace("{sector}", sector)}\n\n输入：\n${numbered}\n\n请输出 JSON 数组。`;
  try {
    const r = await backend.chatLight(prompt, "fr-sector-news");
    return parseJudgeReply(r.reply, titles.length);
  } catch {
    return null;
  }
}

/* ---------------- 生成 / 读取 ---------------- */

/** 读取上次新闻生成时间（epoch ms；0 = 从未生成）。 */
export function lastSectorNewsGenAt(): number {
  const raw = storageGet(FR_SECTOR_NEWS_LAST_GEN_KEY);
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** 写当前时间为「上次新闻生成时间」（成功生成后调用，或触发自动刷新时先占位防抖）。 */
export function recordSectorNewsGenAt(): void {
  storageSet(FR_SECTOR_NEWS_LAST_GEN_KEY, new Date().toISOString());
}

/** 距上次生成是否已满一小时（默认间隔）；从未生成视为到期。 */
export function sectorNewsDue(now = Date.now()): boolean {
  const last = lastSectorNewsGenAt();
  return last === 0 || now - last >= FR_SECTOR_NEWS_INTERVAL_MS;
}

/** 生成中 Promise（模块级单例）：并发触发复用同一在途任务，避免重复打 AI。 */
let sectorNewsInFlight: Promise<FrSectorNews | null> | null = null;

/**
 * 生成四板块利好利空新闻：取数 → 分组 → 每板块一次 AI 批量判断 → 影响力降序保留全部候选存缓存。
 * - 可重复调用：每小时自动刷新 / 盘后批 / 手动刷新按钮都走这里。
 * - 并发调用复用同一在途 Promise；成功即刷新「上次新闻生成时间」（供每小时判断）。
 * - 任何一步失败（取数空 / AI 未接入 / AI 报错）都返回 null、不抛错；AI 失败仍保留无标签新闻。
 */
export function generateSectorNews(): Promise<FrSectorNews | null> {
  if (sectorNewsInFlight) return sectorNewsInFlight;
  sectorNewsInFlight = (async () => {
    try {
      const { dataDate, bySector } = await fetchSectorCandidates(true);
      const sectors: Record<FrSectorKey, FrSectorNewsItem[]> = { 科技链: [], 新能源: [], 医药: [], 金融: [] };
      const notes: Record<FrSectorKey, string> = { 科技链: "", 新能源: "", 医药: "", 金融: "" };
      let aiOk = false;

      for (const sector of FR_SECTORS) {
        const isFinance = sector === "金融";
        const maxCandidates = isFinance ? 5 : 25;
        if (isFinance) notes["金融"] = "数据源受限·宏观口径";

        const candidates = bySector[sector].slice(0, maxCandidates);
        // 一次 AI 调用判断这批（非逐条）
        const judged = await judgeBatch(sector, candidates.map((c) => c.title));
        if (judged) {
          aiOk = true;
          for (let idx = 0; idx < candidates.length; idx++) {
            const hit = judged.get(idx + 1);
            const c = candidates[idx];
            if (c && hit) {
              c.sentiment = hit.sentiment;
              c.score = hit.score;
            }
          }
          // 中文在前、英文在后，组内按影响力分降序（未判出的排末尾）
          candidates.sort((a, b) => {
            const la = a.lang === "中" ? 0 : 1;
            const lb = b.lang === "中" ? 0 : 1;
            if (la !== lb) return la - lb;
            return (b.score ?? -1) - (a.score ?? -1);
          });
        }
        sectors[sector] = candidates;
      }

      const out: FrSectorNews = {
        dataDate,
        generatedAt: new Date().toISOString(),
        sectors,
        notes,
        aiOk,
      };
      storageSet(FR_SECTOR_NEWS_KEY, JSON.stringify(out));
      recordSectorNewsGenAt(); // 成功即刷新「上次新闻生成时间」，供每小时自动刷新判断
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(FR_SECTOR_NEWS_UPDATED));
      }
      return out;
    } catch {
      return null;
    } finally {
      sectorNewsInFlight = null;
    }
  })();
  return sectorNewsInFlight;
}

/** 逐条校验缓存条目，坏行丢弃。 */
function sanitizeItems(arr: unknown[]): FrSectorNewsItem[] {
  const out: FrSectorNewsItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o["title"] !== "string" || !o["title"]) continue;
    const sentiment: FrNewsSentiment | null =
      o["sentiment"] === "利好" ? "利好"
        : o["sentiment"] === "利空" ? "利空"
          : o["sentiment"] === "中性" ? "中性" : null;
    const score = typeof o["score"] === "number" && Number.isFinite(o["score"]) ? o["score"] : null;
    // 旧缓存无 lang 字段：按标题字符补判兜底
    const lang: "中" | "英" =
      o["lang"] === "中" || o["lang"] === "英" ? o["lang"] : detectLang(o["title"]);
    out.push({
      title: o["title"],
      src: typeof o["src"] === "string" ? o["src"] : "RSS 策展",
      industry: typeof o["industry"] === "string" ? o["industry"] : "",
      industryLabel: typeof o["industryLabel"] === "string" ? o["industryLabel"] : "",
      url: typeof o["url"] === "string" ? o["url"] : "",
      time: typeof o["time"] === "string" ? o["time"] : "",
      sentiment,
      score,
      lang,
    });
  }
  return out;
}

/** 读已生成的板块新闻（无 / 损坏返回 null；新鲜度由页面按 dataDate 判断）。 */
export function readSectorNews(): FrSectorNews | null {
  const raw = storageGet(FR_SECTOR_NEWS_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p["dataDate"] !== "string" || !p["dataDate"]) return null;
    if (typeof p["sectors"] !== "object" || p["sectors"] === null) return null;
    const sectorsRaw = p["sectors"] as Record<string, unknown>;
    const notesRaw = typeof p["notes"] === "object" && p["notes"] !== null
      ? (p["notes"] as Record<string, unknown>)
      : {};
    const sectors = {} as Record<FrSectorKey, FrSectorNewsItem[]>;
    const notes = {} as Record<FrSectorKey, string>;
    for (const sector of FR_SECTORS) {
      sectors[sector] = Array.isArray(sectorsRaw[sector]) ? sanitizeItems(sectorsRaw[sector] as unknown[]) : [];
      const n = notesRaw[sector];
      notes[sector] = typeof n === "string" ? n : "";
    }
    return {
      dataDate: p["dataDate"],
      generatedAt: typeof p["generatedAt"] === "string" ? p["generatedAt"] : "",
      sectors,
      notes,
      aiOk: p["aiOk"] === true,
    };
  } catch {
    return null;
  }
}
