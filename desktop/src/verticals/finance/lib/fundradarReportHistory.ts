/**
 * 资金雷达工作台 · 报告历史记录（localStorage 落盘）
 * ------------------------------------------------------------
 * 报告页（FundradarReport）每次成功生成报告后调用 saveReportHistory 落一条快照，
 * 关掉页面再回来仍可回看最近报告（最多 20 条，同 code 去重保留最新）。
 * 读写复用 lib/storage.ts 的安全封装（隐私模式 / 配额写满不抛异常，静默降级）。
 * 落盘后派发 window 事件 fr-report-history-changed，页面据此实时刷新列表。
 *
 * v2 扩展（报告历史增删改导出）：
 * - ReportHistoryItem 从「摘要」扩展为「完整报告快照」：补 subscores / conclusion /
 *   shortReason / shortTrigger / longReason / longTrigger / risks / sources / locked。
 *   旧历史（缺这些字段）经 normalizeReportHistoryItem 兜底为空 / []，照常读取。
 * - 锁定防删除：locked 条目不能被 deleteReportHistoryItem 删、不被同 code 去重顶掉、
 *   clearReportHistory 会跳过锁定的（返回剩余锁定条数）。
 * - 导出：buildReportMarkdown 拼 .md 全文；buildReportHtml 拼打印视图（另存为 PDF）；
 *   reportMarkdownFilename 生成下载文件名。
 */
import { FR_DISCLAIMER } from "@/data/fundradarSample";
import { storageGet, storageRemove, storageSet } from "@/lib/storage";

/** 单条报告历史快照（含完整报告内容，供回看 / 导出） */
export interface ReportHistoryItem {
  /** 6 位 A 股代码 */
  code: string;
  /** 股票名称（行情可取时为 security_name，否则回退代码） */
  name: string;
  /** 生成时间（epoch 毫秒） */
  ts: number;
  /** 综合评分（0-100 整数） */
  score: number;
  /** 短期倾向：偏多 / 中性 / 偏空 */
  shortTrend: string;
  /** 长期倾向：偏多 / 中性 / 偏空 */
  longTrend: string;
  /** 风险点条数 */
  riskCount: number;
  /** 三因子子分（0-100，整数）：技术 / 资金 / 估值 */
  subscores: { tech: number; flow: number; valuation: number };
  /** 一句话结论（评分 + 子分 + 短长期倾向拼一句） */
  conclusion: string;
  /** 短期倾向一句话理由（大白话） */
  shortReason?: string;
  /** 短期触发条件（什么数据出来会改变判断） */
  shortTrigger?: string;
  /** 长期倾向一句话理由 */
  longReason?: string;
  /** 长期触发条件 */
  longTrigger?: string;
  /** 风险明细全文（每条「标题：详情」） */
  risks: string[];
  /** 数据来源中文名列表 */
  sources: string[];
  /** 是否锁定（锁定的防删除、不被同 code 去重顶掉） */
  locked?: boolean;
}

/** localStorage 键 */
const STORAGE_KEY = "fr-report-history";
/** 最多保留条数 */
const MAX_ITEMS = 20;
/** 历史变化事件名（订阅方自行 loadReportHistory 重读，detail 无） */
export const FR_REPORT_HISTORY_CHANGED = "fr-report-history-changed";

/* ---------------- 校验 / 兜底（旧历史缺新字段 → 空 / []，不影响读取） ---------------- */

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 规范化单条记录：校验核心字段（code/name/ts/score/shortTrend/longTrend/riskCount），
 * 新字段（subscores/conclusion/risks/sources/reason/trigger/locked）缺省或类型不对时兜底。
 * 返回 null 表示核心字段不合法（丢弃该条）。
 */
function normalizeReportHistoryItem(v: unknown): ReportHistoryItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ts = asFiniteNumber(o.ts);
  const score = asFiniteNumber(o.score);
  const riskCount = asFiniteNumber(o.riskCount);
  if (
    typeof o.code !== "string" ||
    typeof o.name !== "string" ||
    ts === null ||
    score === null ||
    typeof o.shortTrend !== "string" ||
    typeof o.longTrend !== "string" ||
    riskCount === null
  ) {
    return null;
  }
  // 子分：对象且三个数值都合法才取，否则兜底 0
  let subscores: { tech: number; flow: number; valuation: number } = { tech: 0, flow: 0, valuation: 0 };
  if (o.subscores && typeof o.subscores === "object") {
    const s = o.subscores as Record<string, unknown>;
    const tech = asFiniteNumber(s.tech);
    const flow = asFiniteNumber(s.flow);
    const valuation = asFiniteNumber(s.valuation);
    if (tech !== null && flow !== null && valuation !== null) {
      subscores = { tech, flow, valuation };
    }
  }
  const optStr = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
  return {
    code: o.code,
    name: o.name,
    ts,
    score,
    shortTrend: o.shortTrend,
    longTrend: o.longTrend,
    riskCount,
    subscores,
    conclusion: typeof o.conclusion === "string" ? o.conclusion : "",
    shortReason: optStr(o.shortReason),
    shortTrigger: optStr(o.shortTrigger),
    longReason: optStr(o.longReason),
    longTrigger: optStr(o.longTrigger),
    risks: asStringArray(o.risks),
    sources: asStringArray(o.sources),
    ...(o.locked === true ? { locked: true } : {}),
  };
}

/** 读历史：localStorage 键 fr-report-history；损坏 / 非数组 / 字段不合法 → 空数组。 */
export function loadReportHistory(): ReportHistoryItem[] {
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x) => {
      const item = normalizeReportHistoryItem(x);
      return item ? [item] : [];
    });
  } catch {
    return [];
  }
}

/** 落盘 + 派发变化事件（本文件所有写操作统一走这里）。 */
function writeHistory(list: ReportHistoryItem[]): void {
  storageSet(STORAGE_KEY, JSON.stringify(list));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FR_REPORT_HISTORY_CHANGED));
  }
}

/** 裁剪到最多 MAX_ITEMS 条：优先保留锁定条目，其次保留较新条目；输出保持原顺序（新→旧）。 */
function trimHistory(list: ReportHistoryItem[]): ReportHistoryItem[] {
  if (list.length <= MAX_ITEMS) return list;
  const locked = list.filter((x) => x.locked === true);
  const unlocked = list.filter((x) => x.locked !== true);
  // 未锁定最多保留 MAX_ITEMS - 锁定数 条（取最新的那些，未锁定列表本身已是新→旧）
  const keepUnlocked = unlocked.slice(0, Math.max(0, MAX_ITEMS - locked.length));
  const kept = new Set<ReportHistoryItem>([...locked, ...keepUnlocked]);
  return list.filter((x) => kept.has(x)).slice(0, MAX_ITEMS);
}

/**
 * 存历史：新记录插头部；同 code 去重只移除「未锁定」的旧条目（锁定的保留，不被新报告顶掉）；
 * 限制最多 20 条（锁定的优先保留）；落盘并派发事件。
 */
export function saveReportHistory(item: ReportHistoryItem): void {
  const next = [item, ...loadReportHistory().filter((x) => !(x.code === item.code && x.locked !== true))];
  writeHistory(trimHistory(next));
}

/** 删除单条（code + ts 唯一标识）；锁定的不可删，返回是否删除成功。 */
export function deleteReportHistoryItem(code: string, ts: number): boolean {
  const list = loadReportHistory();
  const target = list.find((x) => x.code === code && x.ts === ts);
  if (!target || target.locked === true) return false;
  writeHistory(list.filter((x) => !(x.code === code && x.ts === ts)));
  return true;
}

/** 设置锁定状态（code + ts 唯一标识）；解锁时移除 locked 字段。 */
export function setReportHistoryLock(code: string, ts: number, locked: boolean): void {
  const list = loadReportHistory().map((x) =>
    x.code === code && x.ts === ts
      ? locked ? { ...x, locked: true } : (() => { const { locked: _l, ...rest } = x; return rest; })()
      : x,
  );
  writeHistory(list);
}

/**
 * 清空历史：跳过锁定的条目（锁定的一律保留），返回剩余锁定条数（0 = 已全部清空）。
 * 确认由调用方负责（页面二次确认 + 「有 N 条已锁定」提示）。
 */
export function clearReportHistory(): number {
  const list = loadReportHistory();
  const locked = list.filter((x) => x.locked === true);
  if (locked.length > 0) {
    writeHistory(locked);
  } else {
    storageRemove(STORAGE_KEY);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(FR_REPORT_HISTORY_CHANGED));
    }
  }
  return locked.length;
}

/* ---------------- 导出内容构建（纯字符串，无 React） ---------------- */

/** 评分分级（与报告页评分分级一致） */
function scoreGradeOf(score: number): string {
  return score >= 60 ? "偏多" : score >= 40 ? "中性" : "偏空";
}

/** 历史时间戳 → 本地时间文案（年月日 + 时分） */
function formatReportTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

/** 时间戳 → YYYY-MM-DD（导出文件名用） */
function dateStamp(ts: number): string {
  try {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch {
    return "";
  }
}

/** 下载文件名：<name>-<code>-<日期>.md（名称里的路径/空白字符换成下划线，避免非法文件名） */
export function reportMarkdownFilename(item: ReportHistoryItem): string {
  const name = (item.name || "report").replace(/[\\/:*?"<>|\s]+/g, "_");
  return `${name}-${item.code}-${dateStamp(item.ts)}.md`;
}

/**
 * 拼完整报告的 Markdown（大白话 + 免责声明）。
 * 结构：标题（name+code）→ 时间 → 综合评分 → 三项子分 → 一句话结论 → 短长期倾向（理由+触发）
 * → 风险列表 → 数据来源 → 免责声明。
 */
export function buildReportMarkdown(item: ReportHistoryItem): string {
  const lines: string[] = [];
  const grade = scoreGradeOf(item.score);
  lines.push(`# ${item.name}（${item.code}）资金雷达报告`);
  lines.push("");
  lines.push(`> 生成时间：${formatReportTs(item.ts)}`);
  lines.push(`> 综合评分：**${item.score} 分**（${grade}）`);
  lines.push("");
  lines.push("## 评分构成");
  lines.push("");
  lines.push(`- 综合评分：**${item.score} 分**（${grade}）`);
  lines.push(`- 技术面（占 50%）：${item.subscores.tech} 分`);
  lines.push(`- 资金面（占 30%）：${item.subscores.flow} 分`);
  lines.push(`- 估值面（占 20%）：${item.subscores.valuation} 分`);
  lines.push("");
  lines.push("## 一句话结论");
  lines.push("");
  lines.push(item.conclusion || "（暂无结论）");
  lines.push("");
  lines.push("## 短期 / 长期倾向");
  lines.push("");
  lines.push(`- 短期（约 1-2 周）：**${item.shortTrend}**`);
  if (item.shortReason) lines.push(`  - 说明：${item.shortReason}`);
  if (item.shortTrigger) lines.push(`  - 触发条件：${item.shortTrigger}`);
  lines.push(`- 长期（约 1-3 月）：**${item.longTrend}**`);
  if (item.longReason) lines.push(`  - 说明：${item.longReason}`);
  if (item.longTrigger) lines.push(`  - 触发条件：${item.longTrigger}`);
  lines.push("");
  lines.push(`## 风险点（共 ${item.riskCount} 项）`);
  lines.push("");
  if (item.risks.length > 0) {
    for (const r of item.risks) lines.push(`- ${r}`);
  } else {
    lines.push("- （暂无风险记录）");
  }
  lines.push("");
  lines.push("## 数据来源");
  lines.push("");
  if (item.sources.length > 0) {
    for (const s of item.sources) lines.push(`- ${s}`);
  } else {
    lines.push("- （暂无来源记录）");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(FR_DISCLAIMER);
  lines.push("");
  lines.push("本报告仅呈现基于公开数据的评分与倾向（偏多 / 中性 / 偏空）及触发条件，供研究参考；不构成任何投资建议，请独立判断、风险自担。");
  return lines.join("\n");
}

/** HTML 转义（打印视图防注入） */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

/**
 * 拼打印视图（另存为 PDF 用）：完整报告 + 免责，白底简洁排版，内联样式不依赖应用 CSS。
 * 调用方 window.open("", "_blank") 后 document.write 本文档再 window.print()。
 */
export function buildReportHtml(item: ReportHistoryItem): string {
  const grade = scoreGradeOf(item.score);
  const riskItems = item.risks.length > 0
    ? item.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("")
    : `<li>（暂无风险记录）</li>`;
  const sourceItems = item.sources.length > 0
    ? item.sources.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
    : `<li>（暂无来源记录）</li>`;
  const leanBlock = (label: string, dir: string, reason?: string, trigger?: string): string => `
      <div class="lean">
        <p class="lean-head">${label}：<strong>${escapeHtml(dir)}</strong></p>
        ${reason ? `<p class="muted">说明：${escapeHtml(reason)}</p>` : ""}
        ${trigger ? `<p class="muted">触发条件：${escapeHtml(trigger)}</p>` : ""}
      </div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(item.name)}（${escapeHtml(item.code)}）资金雷达报告</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 36px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    color: #18181b; background: #ffffff;
    line-height: 1.65; font-size: 15px;
  }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { color: #52525b; font-size: 14px; margin: 0 0 20px; }
  .score-banner {
    display: flex; align-items: baseline; gap: 12px;
    border: 1px solid #d4d4d8; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px;
    background: #fafafa;
  }
  .score-num { font-size: 36px; font-weight: 800; }
  .score-grade { font-size: 18px; font-weight: 700; }
  h2 { font-size: 18px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e4e4e7; }
  .subs { display: flex; gap: 12px; flex-wrap: wrap; }
  .sub {
    flex: 1 1 140px; border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 12px;
  }
  .sub .k { font-size: 13px; color: #52525b; }
  .sub .v { font-size: 22px; font-weight: 800; margin-top: 2px; }
  .conclusion { font-size: 16px; font-weight: 700; }
  .lean { border-left: 3px solid #2563eb; padding: 6px 0 6px 12px; margin: 8px 0; }
  .lean-head { font-size: 15px; margin: 0; }
  .muted { color: #52525b; font-size: 14px; margin: 2px 0; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  .disclaimer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e4e4e7; color: #52525b; font-size: 13px; }
  @media print {
    @page { margin: 16mm; }
    body { padding: 0; font-size: 13px; }
    .sub { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(item.name)}（${escapeHtml(item.code)}）资金雷达报告</h1>
  <p class="meta">生成时间：${escapeHtml(formatReportTs(item.ts))}</p>

  <div class="score-banner">
    <span class="score-num">${item.score}</span>
    <span class="score-grade">分 · ${escapeHtml(grade)}</span>
  </div>

  <h2>评分构成</h2>
  <div class="subs">
    <div class="sub"><div class="k">技术面（占 50%）</div><div class="v">${item.subscores.tech} 分</div></div>
    <div class="sub"><div class="k">资金面（占 30%）</div><div class="v">${item.subscores.flow} 分</div></div>
    <div class="sub"><div class="k">估值面（占 20%）</div><div class="v">${item.subscores.valuation} 分</div></div>
  </div>

  <h2>一句话结论</h2>
  <p class="conclusion">${escapeHtml(item.conclusion || "（暂无结论）")}</p>

  <h2>短期 / 长期倾向</h2>
  ${leanBlock("短期（约 1-2 周）", item.shortTrend, item.shortReason, item.shortTrigger)}
  ${leanBlock("长期（约 1-3 月）", item.longTrend, item.longReason, item.longTrigger)}

  <h2>风险点（共 ${item.riskCount} 项）</h2>
  <ul>${riskItems}</ul>

  <h2>数据来源</h2>
  <ul>${sourceItems}</ul>

  <p class="disclaimer">${escapeHtml(FR_DISCLAIMER)}<br />本报告仅呈现基于公开数据的评分与倾向（偏多 / 中性 / 偏空）及触发条件，供研究参考；不构成任何投资建议，请独立判断、风险自担。</p>
</body>
</html>`;
}
