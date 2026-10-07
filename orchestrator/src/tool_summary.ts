/**
 * 对话工具调用的入参/结果摘要（展示层辅助，非研究取数）。
 *
 * 用途：对话流的 MCP 工具调用在界面上以「工具卡」展开显示。此前只回传工具名 / 状态 / 耗时，
 * 卡片展开看不到入参与结果。本模块把一次工具调用的入参、结果各压成一段 ≤200 字的短文本，
 * 随 tool 事件（ChatStreamEvent.args / result）与 tool_activity（ToolReceipt.args_summary /
 * result_summary）回传，前端原样显示。
 *
 * 边界：
 * - 只做展示摘要，不脱敏（数据非密钥），不落盘；
 * - 取不到就返回空串，前端按「未回传」诚实标注，不编造。
 */

const MAX_CHARS = 200;

function plain(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function clip(s: string, n = MAX_CHARS): string {
  const t = s.trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 入参摘要：对象 → `{k1: v1, k2: v2}`；标量 / 数组 → 直接转文本。空值字段跳过。 */
export function summarizeToolArgs(args: unknown): string {
  if (args == null) return "";
  if (isRecord(args)) {
    const parts = Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${clip(plain(v), 120)}`);
    if (!parts.length) return "";
    return clip(`{ ${parts.join(", ")} }`);
  }
  return clip(plain(args));
}

/** 从结果里挖 evidence 数组（fetch_endpoint 的 envelope.evidence / 顶层 evidence）。 */
function evidenceLines(result: unknown): string[] {
  const root = isRecord(result) ? result : null;
  if (!root) return [];
  const envelope = isRecord(root.envelope) ? root.envelope : null;
  const raw = (Array.isArray(envelope?.evidence) ? envelope.evidence : Array.isArray(root.evidence) ? root.evidence : []) as unknown[];
  const lines: string[] = [];
  for (const e of raw.slice(0, 12)) {
    if (!isRecord(e)) continue;
    const field = typeof e.field === "string" ? e.field : "";
    const value = e.value;
    const unit = typeof e.unit === "string" ? e.unit : "";
    if (!field || value === undefined || value === null) continue;
    lines.push(`${field}: ${plain(value)}${unit ? ` ${unit}` : ""}`);
  }
  return lines;
}

/**
 * 结果摘要：优先 evidence（`field: value unit`），其次数组 / 总量 / 状态，
 * 最后标量字段与原文兜底。始终截断到 200 字。
 */
export function summarizeToolResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  const evs = evidenceLines(result);
  if (evs.length) return clip(evs.join(" · "));
  if (Array.isArray(result)) {
    if (!result.length) return "0 条";
    return clip(result.slice(0, 6).map((x) => plain(x)).join(" · "));
  }
  if (isRecord(result)) {
    const envelope = isRecord(result.envelope) ? result.envelope : null;
    const envStatus = typeof envelope?.status === "string" ? envelope.status : "";
    if (envStatus) return clip(`status: ${envStatus}`);
    const status = typeof result.status === "string" ? result.status : "";
    const total = typeof result.total === "number" ? result.total : typeof result.count === "number" ? result.count : null;
    if (status || total !== null) {
      const parts: string[] = [];
      if (total !== null) parts.push(`${total} 条`);
      if (status) parts.push(status);
      return clip(parts.join(" · "));
    }
    const scalars = Object.entries(result)
      .filter(([, v]) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && v !== "" && v !== null && v !== undefined)
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${plain(v)}`);
    if (scalars.length) return clip(scalars.join(" · "));
    return "";
  }
  return clip(plain(result));
}
