/**
 * 资金雷达工作台 · Agent 对话页（常用区域，刀4 接入真实链路）
 * 深色 ai-surface 对话坞（fr-screen-dark 跟随全局深浅开关）：✨ 今天想聊什么 / 建议问题 chips /
 * 工具记录卡（内联可展开）/ 输入区（＋菜单 + 模式/模型选择器 + 🎤 录音态 + 发送）。
 * - 真实对话：backend.chatStream()（与 FinanceAiDock 同一条后端通道），session 按会话 id 隔离（useAiChat）；
 * - 会话列表：localStorage `fr-chat-sessions` 存目录；消息仍由 useAiChat 按 key 持久化；
 * - 语音输入：浏览器 Web Speech API（VoiceInput，点击开始/停止，停止后填入输入框）；
 * - 朗读：系统 TTS（useSpeech）；未接入 AI 时显示「请先在设置页接入」+ 跳转按钮。
 * 阶段 1 只改 UI/交互骨架：chatStream 流式、人设注入、AI 配置读写、语音识别、个股速览摘要展开全部保持可用。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronsLeft, ChevronsRight, Database, Download, FileText, ListTodo, Loader2, MessageCircle, Mic, PencilLine, Play, Plus, Radar, Square, Target, Trash2, Volume2, type LucideIcon } from "lucide-react";

import { completeTurns, dropChat, useAiChat } from "../../../core/ai/useAiChat";
import { cleanAutoLinks } from "../../../core/ai/cleanAutoLinks";
import { ApiError, backend } from "@/lib/backend";
import { useAiRuntime } from "@/hooks/useAiRuntime";
import { FR_SUGGESTIONS } from "@/data/fundradarSample";
import { VoiceInput, type VoiceInputHandle } from "@/components/fundradar/VoiceInput";
import { useSpeech } from "@/components/fundradar/useSpeech";
import { AI_MODELS, isCliProvider } from "@/lib/ai-models";
import { frProvider } from "@/lib/frAiProviders";
import { AI_RUNTIME_CHANGED, loadLlmProfiles, switchLlmProfile, switchModelSameProvider, type LlmProfile } from "@/lib/llmStore";
import {
  CHAT_SESSION_PREFIX, loadSessions, newSessionId, persistSessions, titleFromMessage,
  type FrChatMode, type FrChatSession,
} from "@/lib/fundradarSessions";
import {
  createGoal, deleteGoal, detectGoalIntent, formatGoalsForPrompt, isGoalProgressQuery, loadGoals,
} from "@/lib/fundradarGoals";
import { splitOps } from "@/lib/fundradarOps";
import { OpCard } from "@/components/fundradar/FrOpCard";

/** 语音转写前缀：发送前由 decorate 剥掉，气泡里据此显示「🎙 语音转写」 */
const VOICE_MARK = "\u200B🎙语音转写：";
/** 工具记录分隔：sendTurn 在真实回答后追加 JSON，气泡据此把「本轮工具记录」渲染成工具卡 */
const TOOLS_MARK = "\n\n====FR-TOOLS====\n";

const TOOL_LABELS: Record<string, string> = {
  search_web: "联网搜索", read_web_page: "读取网页", list_endpoints: "查找数据源",
  fetch_endpoint: "获取数据", list_runs: "查询任务", research_status: "查询进度",
  get_report: "读取报告", get_evidence: "核对证据", knowledge_recall: "读取研究记忆",
  read_ledger: "读取台账", list_tools: "查看工具", run_tool: "运行分析工具", start_research: "准备研究",
};

const MODE_LABELS: Record<FrChatMode, string> = { chat: "对话", plan: "Plan", goal: "Goal" };
const MODE_ICONS: Record<FrChatMode, LucideIcon> = { chat: MessageCircle, plan: ListTodo, goal: Target };

/** 来源的友好显示名：订阅档显示订阅名，API 档按 AI_MODELS 找友好名，找不到回落「供应商 · 模型」 */
function sourceFriendlyName(provider: string, model: string): string {
  if (provider.startsWith("cli-")) {
    if (provider === "cli-codex") return "Codex 订阅";
    if (provider === "cli-claude") return "Claude Code";
    if (provider === "cli-codebuddy") return "WorkBuddy";
    return provider;
  }
  const m = AI_MODELS.find((x) => x.provider === provider && x.id === model);
  if (m) return m.name;
  const prov = frProvider(provider)?.label;
  const mdl = model?.trim();
  if (prov && mdl) return `${prov} · ${mdl}`;
  return prov || mdl || "已接入 AI";
}

/** 来源的供应商标签（下拉副标签；订阅档标「订阅」） */
function sourceProviderTag(provider: string): string {
  if (provider.startsWith("cli-")) return "订阅";
  return frProvider(provider)?.label ?? provider;
}

/** 一轮里的单个工具记录（chatStream 的 tool 事件：name + started/completed/failed + args/result 摘要；耗时来自最终 tool_activity） */
interface ToolRecord {
  name: string;
  label: string;
  status: "running" | "done" | "failed" | "wait";
  durationMs?: number;
  /** 入参摘要（后端 ≤200 字，如 `{ symbol: 600519, endpoint: fetch_quote }`） */
  args?: string;
  /** 结果摘要（后端 ≤200 字，如 `latest_price: 1237 元 · total_market_cap: 15463 亿`） */
  result?: string;
}

/** 发一轮真实对话：底座 backend.chatStream（流式）；工具进度以 JSON 追加在 TOOLS_MARK 后，界面渲染成工具卡 */
async function sendTurn({ message, session, signal, onProgress }: { message: string; session: string; signal: AbortSignal; onProgress?: (content: string) => void }) {
  const tools: ToolRecord[] = [];
  let running: ToolRecord | null = null;
  let streamedText = "";
  const toolLine = (list: ToolRecord[]) => (list.length ? `${TOOLS_MARK}${JSON.stringify(list)}` : "");
  const emit = () => onProgress?.(streamedText + toolLine(tools));

  const r = await backend.chatStream(message, session, signal, undefined, (e) => {
    if (signal.aborted) return;
    if (e.type === "text") {
      streamedText = e.text;
      emit();
    } else if (e.type === "tool") {
      const label = TOOL_LABELS[e.name] ?? e.name;
      if (e.status === "started") {
        running = { name: e.name, label, status: "running", args: e.args };
        tools.push(running);
      } else if (running) {
        running.status = e.status === "failed" ? "failed" : "done";
        if (e.args != null) running.args = e.args;
        if (e.result != null) running.result = e.result;
        running = null;
      } else {
        tools.push({ name: e.name, label, status: e.status === "failed" ? "failed" : "done", args: e.args, result: e.result });
      }
      emit();
    }
  });

  // 最终 tool_activity 带回耗时（duration_ms）、ok 与入参/结果摘要；补进流式期间的工具记录（流式事件本身不带耗时）
  for (const t of r.tool_activity ?? []) {
    const rec = tools.find((x) => x.name === t.name);
    if (rec) {
      if (rec.status === "running") rec.status = t.ok ? "done" : "failed";
      rec.durationMs = t.duration_ms;
      if (t.args_summary != null && rec.args == null) rec.args = t.args_summary;
      if (t.result_summary != null && rec.result == null) rec.result = t.result_summary;
    } else {
      tools.push({
        name: t.name, label: TOOL_LABELS[t.name] ?? t.name, status: t.ok ? "done" : "failed",
        durationMs: t.duration_ms, args: t.args_summary, result: t.result_summary,
      });
    }
  }

  const confirmations: string[] = [];
  for (const task of r.pending_research ?? []) {
    if (signal.aborted) break;
    if (!window.confirm(`启动 ${task.company_name || task.symbol}（${task.symbol}）的${task.endpoints === "full" ? "完整" : "核心"}研究？\n这会使用当前所选 AI 的额度，在后台运行。`)) {
      confirmations.push("研究尚未启动（已取消确认）。");
      continue;
    }
    try {
      const started = await backend.confirmChatResearch(task.id, signal);
      confirmations.push(`研究已启动，任务编号：${started.run_id}。可直接在这里询问进度，也可在研究页查看。`);
    } catch {
      confirmations.push("未能确认研究启动结果，请先在研究页核对任务列表，避免重复启动。");
    }
  }
  let reply = r.reply;
  // 触发产出红线被删掉的行要**说出来**：不说的话，用户看到的是一段被悄悄剪过的回答
  if (r.redacted) reply += `\n\n⚠️ 有 ${r.redacted} 行触发产出红线被移除（不给操作建议）。`;
  if (confirmations.length) reply += `\n\n${confirmations.join("\n\n")}`;
  reply += toolLine(tools);
  return reply;
}

/** 朗读前清理：去掉 markdown 记号与链接，按句切成小段（浏览器 TTS 长段会截断/中断） */
function ttsSegments(markdown: string): string[] {
  const plain = markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[PLAN\]|\[\/PLAN\]/gi, "")
    .replace(/\[OP\][\s\S]*?\[\/OP\]/gi, "")
    .replace(/\[OP\]|\[\/OP\]/gi, "")
    .replace(/[`*_>#~|]/g, "")
    .replace(/^\s*-{3,}\s*$/gm, "，")
    .replace(/\s*\n+\s*/g, "，");
  const chunks: string[] = [];
  let cur = "";
  for (const piece of plain.split(/(?<=[。！？；，])/)) {
    if (cur && cur.length + piece.length > 80) { chunks.push(cur); cur = ""; }
    cur += piece;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.trim().length > 0);
}

/** 拆出「本轮工具记录」：正文与工具 JSON 分开。JSON 优先（阶段 1），旧文本格式兜底。 */
function splitTools(content: string): { body: string; tools: ToolRecord[] } {
  const idx = content.indexOf(TOOLS_MARK);
  if (idx < 0) return { body: content, tools: [] };
  const body = content.slice(0, idx);
  const raw = content.slice(idx + TOOLS_MARK.length).trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const recs = parsed
          .filter((t): t is ToolRecord => !!t && typeof t === "object" && typeof (t as ToolRecord).label === "string")
          .map((t) => {
            const x = t as Partial<ToolRecord>;
            const status: ToolRecord["status"] = x.status === "running" || x.status === "failed" || x.status === "wait" ? x.status : "done";
            return {
              name: x.name ?? "", label: x.label ?? "", status,
              durationMs: typeof x.durationMs === "number" ? x.durationMs : undefined,
              args: typeof x.args === "string" ? x.args : undefined,
              result: typeof x.result === "string" ? x.result : undefined,
            };
          });
        return { body, tools: recs };
      }
    } catch { /* 落到旧文本格式 */ }
  }
  const items = raw.replace(/^本轮工具[记录：:]*\s*/, "").split("→").map((s) => s.trim()).filter(Boolean);
  const recs = items.map((label) => {
    const failed = label.includes("（失败）");
    return { name: "", label: label.replace("（失败）", ""), status: failed ? "failed" as const : "done" as const };
  });
  return { body, tools: recs };
}

/** 个股速览四点报告识别：正文同时含「趋势 / 风险 / 前景 / 季报」至少三词 */
function isStockBrief(body: string): boolean {
  const keys = ["趋势", "风险", "前景", "季报"];
  return keys.filter((k) => body.includes(k)).length >= 3;
}

/** 四点报告「摘要」：结论前置 —— 取正文第一个分节标题之前的开头；仅折叠态显示，不影响朗读与流式 */
function stockBriefSummary(body: string): string {
  const head = body.trim();
  const cut = head.search(/(?:^|\n)\s*[#>]*\s*(?:[①②③④]|(?:趋势|风险|前景|季报|估值)\s*[:：])/);
  const preamble = (cut >= 0 ? head.slice(0, cut) : head).replace(/\s+/g, " ").trim();
  if (!preamble) return head.slice(0, 160);
  const two = preamble.split(/(?<=[。！？；])/).slice(0, 2).join("").trim();
  const seg = two || preamble;
  return seg.length > 200 ? seg.slice(0, 200).trimEnd() + "…" : seg;
}

/** 从文本里取第一个 6 位数字（A 股代码）；取不到返回 null。 */
function findCode(text: string): string | null {
  return /(\d{6})/.exec(text ?? "")?.[1] ?? null;
}

/** 拆出 Plan 模式的结构化计划：正文里的 `[PLAN]...[/PLAN]` 块单独拿出来渲染成计划卡，其余文字照常显示。 */
function splitPlan(content: string): { outside: string; plan: string | null } {
  const m = /\[PLAN\]([\s\S]*?)\[\/PLAN\]/i.exec(content);
  if (!m) {
    // 流式中 [PLAN] 已出但 [/PLAN] 还没到：把开标记剥掉，避免把标记本身当正文渲染
    return { outside: content.replace(/\[PLAN\]/gi, "").trim(), plan: null };
  }
  const plan = (m[1] ?? "").trim();
  const outside = (content.slice(0, m.index) + content.slice(m.index + m[0]!.length)).trim();
  return { outside, plan };
}

/** 回答正文：过长且已收口时折叠；四点速览显示「摘要」+「看完整报告」，其余显示「展开全文」；流式不折叠 */
function AssistantBody({ body, foldable }: { body: string; foldable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const LONG = 600;
  const brief = isStockBrief(body);
  const over = body.length > LONG;
  const collapsed = foldable && over && !expanded;
  const shown = collapsed ? (brief ? stockBriefSummary(body) : `${body.slice(0, LONG)}\n\n…`) : body;
  return (
    <>
      <div className="fr-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm, cleanAutoLinks]}>{shown}</ReactMarkdown>
      </div>
      {foldable && over && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="fr-sub fr-tap mt-1.5 rounded-btn border border-border px-2.5 py-1 font-bold text-muted-foreground hover:border-primary/40 hover:text-primary">
          {expanded ? "收起" : brief ? "看完整报告" : "展开全文"}
        </button>
      )}
    </>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 工具记录卡：状态图标 + 工具名 · 耗时，点击展开看入参/结果摘要（展开有过渡） */
function ToolCard({ tool }: { tool: ToolRecord }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === "running";
  const failed = tool.status === "failed";
  const done = tool.status === "done";
  const wait = tool.status === "wait";
  const meta = running ? "进行中" : failed ? "跳过" : wait ? "待执行" : tool.durationMs != null ? formatMs(tool.durationMs) : "完成";
  return (
    <div className={`fr-tool-card ${open ? "fr-tool-open" : ""}`}>
      <button type="button" className="fr-tool-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`fr-tool-status ${running ? "fr-tool-run" : done ? "fr-tool-done" : "fr-tool-wait"}`}>
          {running ? <span className="fr-tool-spinner" /> : done ? "✓" : "·"}
        </span>
        <span className="min-w-0 truncate">{tool.label}</span>
        <span className="fr-tool-meta">· {meta}</span>
        <span className="fr-tool-chev">▸</span>
      </button>
      <div className="fr-tool-card-body">
        <div className="fr-tool-card-body-inner">
          <div className="fr-tool-card-content">
            <span className="fr-tool-k">工具</span> {tool.name || tool.label}<br />
            <span className="fr-tool-k">状态</span> {running ? "进行中" : done ? "已完成" : failed ? "跳过" : "待执行"}{tool.durationMs != null ? ` · 耗时 ${formatMs(tool.durationMs)}` : ""}<br />
            <span className="fr-tool-k">入参</span> {tool.args ? tool.args : <span className="fr-tool-empty">{running ? "待回传" : "未回传"}</span>}<br />
            <span className="fr-tool-k">结果</span> {tool.result ? tool.result : <span className="fr-tool-empty">{running ? "进行中" : failed ? "失败，无结果" : "未返回结果"}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 失败（跳过）工具组：默认收起成一行，点开只列工具名，不逐个渲染报错细节 */
function SkippedTools({ tools }: { tools: ToolRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fr-tool-card ${open ? "fr-tool-open" : ""}`}>
      <button type="button" className="fr-tool-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="fr-tool-status fr-tool-wait">·</span>
        <span className="min-w-0 truncate">跳过 {tools.length} 个工具</span>
        <span className="fr-tool-meta">· 数据暂不可用</span>
        <span className="fr-tool-chev">▸</span>
      </button>
      <div className="fr-tool-card-body">
        <div className="fr-tool-card-body-inner">
          <div className="fr-tool-card-content">
            {tools.map((t, i) => <div key={i}>· {t.label}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 工具记录组：默认折叠成一行「已调用 N 个工具」，点开才逐条看（学 DSH 简洁，首屏只留正文）。
 *  失败的工具不再逐个标红报错：成功/进行中逐条展示，失败的收进「跳过」组。 */
function ToolGroup({ tools }: { tools: ToolRecord[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => t.status === "running");
  const doneCount = tools.filter((t) => t.status === "done").length;
  const skippedCount = tools.filter((t) => t.status === "failed").length;
  const active = tools.filter((t) => t.status !== "failed");
  const skipped = tools.filter((t) => t.status === "failed");
  const label = running ? "工具调用中…" : `已调用 ${tools.length} 个工具`;
  const meta = running
    ? `已返回 ${doneCount + skippedCount} / ${tools.length}`
    : skippedCount > 0
      ? `${doneCount} 成功 / ${skippedCount} 跳过`
      : "全部完成";
  return (
    <div className={`fr-tool-card ${open ? "fr-tool-open" : ""}`}>
      <button type="button" className="fr-tool-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`fr-tool-status ${running ? "fr-tool-run" : skippedCount > 0 ? "fr-tool-wait" : "fr-tool-done"}`}>
          {running ? <span className="fr-tool-spinner" /> : skippedCount > 0 ? "·" : "✓"}
        </span>
        <span className="min-w-0 truncate">{label}</span>
        <span className="fr-tool-meta">· {meta}</span>
        <span className="fr-tool-chev">▸</span>
      </button>
      <div className="fr-tool-card-body">
        <div className="fr-tool-card-body-inner">
          <div className="p-2">
            {active.map((t, ti) => <ToolCard key={ti} tool={t} />)}
            {skipped.length > 0 && <SkippedTools tools={skipped} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Plan 模式「计划卡」：把 [PLAN] 块渲染成步骤列表 + 「确认，开始 / 修改」按钮。
 *  确认 → 研究类调 backend.startResearch（六阶段）；回测类跳转 /backtest 页。 */
function PlanCard({ plan, symbol, isBacktest, onModify }: {
  plan: string; symbol: string | null; isBacktest: boolean; onModify: () => void;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const confirm = async () => {
    if (isBacktest) { navigate("/backtest"); return; }
    if (!symbol) {
      setState("error");
      setMsg("没有识别到 6 位股票代码，请点「修改」补上代码。");
      return;
    }
    setState("running");
    setMsg("");
    try {
      const quote = await backend.fetch("tx_quote", { symbol }).catch(() => null);
      const companyName = quote?.envelope.evidence.find((e) => e.field === "security_name")?.value;
      const r = await backend.startResearch({
        symbol,
        ...(typeof companyName === "string" && companyName.trim() ? { company_name: companyName.trim() } : {}),
        endpoints: "core",
      });
      setState("done");
      setMsg(`研究已启动，任务编号：${r.run_id}。可在「个股研究」页查看进度。`);
    } catch (e) {
      setState("error");
      setMsg(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fr-tool-card mt-1.5">
      <div className="fr-sub flex items-center gap-1.5 px-2.5 py-2 font-bold text-primary">
        <ListTodo className="h-4 w-4" aria-hidden="true" /> 研究计划
      </div>
      <div className="px-2.5 pb-2.5">
        <div className="fr-markdown rounded-btn border border-border/60 bg-background/40 px-2.5 py-2">
          <ReactMarkdown remarkPlugins={[remarkGfm, cleanAutoLinks]}>{plan}</ReactMarkdown>
        </div>
        {msg && (
          <p role={state === "error" ? "alert" : "status"}
            className={`fr-sub mt-1.5 ${state === "error" ? "text-destructive" : "text-primary"}`}>{msg}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void confirm()} disabled={state === "running" || state === "done"}
            className="fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-primary/40 bg-primary-subtle-strong px-3 py-1.5 font-bold text-primary hover:bg-primary-200 disabled:opacity-50">
            {state === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            {state === "done" ? "已启动" : isBacktest ? "去回测页" : "确认，开始"}
          </button>
          <button type="button" onClick={onModify}
            className="fr-sub fr-tap inline-flex items-center gap-1.5 rounded-btn border border-border px-3 py-1.5 font-bold text-muted-foreground hover:border-primary/40 hover:text-primary">
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> 修改
          </button>
        </div>
      </div>
    </div>
  );
}

export function FundradarAgentChat() {
  const runtime = useAiRuntime();
  const configured = runtime.status === "ok";
  const agentEnabled = runtime.config?.executionMode === "agent";
  const currentSource = runtime.config?.source;

  // 会话目录（localStorage），缺省时先建一条
  const [sessions, setSessions] = useState<FrChatSession[]>(() => {
    const existing = loadSessions();
    if (existing.length) return existing;
    const now = Date.now();
    const first: FrChatSession = { id: newSessionId(), title: "", createdAt: now, updatedAt: now, mode: "chat", messages: [] };
    persistSessions([first]);
    return [first];
  });
  const [activeId, setActiveId] = useState<string>(() => loadSessions()[0]?.id ?? "");
  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const mode = activeSession?.mode ?? "chat";

  const chatKey = activeId ? CHAT_SESSION_PREFIX + activeId : CHAT_SESSION_PREFIX + "x";
  const chat = useAiChat(chatKey, sendTurn);
  const ready = chat.key === chatKey;

  const speech = useSpeech();
  const [draft, setDraft] = useState("");
  const [readingIdx, setReadingIdx] = useState(-1);
  const [listening, setListening] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  // 已配置的多个来源（多配置档案）；保存/删除/切换后由 AI_RUNTIME_CHANGED 触发重读
  const [profiles, setProfiles] = useState<LlmProfile[]>(() => loadLlmProfiles());
  // 会话列表折叠（默认展开；收起后收成窄条图标，消息流铺满更多宽度）
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const actionTimer = useRef<number | null>(null);
  const voiceRef = useRef<VoiceInputHandle | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Goal 模式：目标列表（goalTick 变化即重读 localStorage，增删后即时反映）
  const [goalTick, setGoalTick] = useState(0);
  const goals = useMemo(() => loadGoals(), [goalTick]);

  // 会话目录落盘
  useEffect(() => { persistSessions(sessions); }, [sessions]);

  // 会话切换 / 删除后，把已收口轮次镜像回目录（标题由提交时定，这里只补 messages）
  useEffect(() => {
    if (!ready || chat.loading) return;
    const msgs = completeTurns(chat.msgs).map(({ role, content }) => ({ role, content }));
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, messages: msgs } : s)));
  }, [ready, chat.loading, chat.msgs, activeId]);

  // 朗读结束后取消气泡高亮
  useEffect(() => {
    if (!speech.speaking) setReadingIdx(-1);
  }, [speech.speaking]);

  // 录音计时
  useEffect(() => {
    if (!listening) { setRecSec(0); return; }
    setRecSec(0);
    const id = window.setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [listening]);

  // 点击菜单外关闭 ＋/模式/模型 下拉
  useEffect(() => {
    const onDoc = () => { setPlusOpen(false); setModeOpen(false); setModelOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // 档案变化（保存 / 删除 / 切换）后重读多配置档案
  useEffect(() => {
    const refresh = () => setProfiles(loadLlmProfiles());
    globalThis.addEventListener(AI_RUNTIME_CHANGED, refresh);
    return () => globalThis.removeEventListener(AI_RUNTIME_CHANGED, refresh);
  }, []);

  // 卸载清理提示定时器
  useEffect(() => () => {
    if (actionTimer.current !== null) window.clearTimeout(actionTimer.current);
  }, []);

  // 个股页「让 AI 说说这只票」预填：读 sessionStorage（读后即清），只预填输入框、不自动发送
  useEffect(() => {
    const pre = window.sessionStorage.getItem("fr-ai-prefill");
    if (pre) {
      window.sessionStorage.removeItem("fr-ai-prefill");
      setDraft(pre);
    }
  }, []);

  // F2 唤起语音（设置页快捷键约定的同一按键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2") return;
      e.preventDefault();
      voiceRef.current?.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const modelLabel = useMemo(() => {
    const cfg = runtime.config?.source;
    if (!cfg) return "未接入 AI";
    return sourceFriendlyName(cfg.provider, cfg.model);
  }, [runtime]);

  // 同厂商可切换的其他模型：当前来源厂商（API 档，非订阅档）下、不同于当前 model 的模型
  const sameProviderModels = useMemo(() => {
    if (!currentSource || isCliProvider(currentSource.provider)) return [];
    return AI_MODELS.filter(
      (m) => !isCliProvider(m.provider) && m.provider === currentSource.provider && m.id !== currentSource.model,
    );
  }, [currentSource]);
  // 同厂商分组标题（中文标签兜底）；订阅档或未配置时不显示该组
  const sameProviderLabel = currentSource && !isCliProvider(currentSource.provider)
    ? sourceProviderTag(currentSource.provider)
    : "";

  const setMode = (m: FrChatMode) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, mode: m } : s)));
  };

  const showAction = (text: string) => {
    setActionHint(text);
    if (actionTimer.current !== null) window.clearTimeout(actionTimer.current);
    actionTimer.current = window.setTimeout(() => setActionHint(null), 3000);
  };

  const pickPlus = (key: "file" | "data" | "plan" | "goal" | "export") => {
    setPlusOpen(false);
    if (key === "plan") { setMode("plan"); return; }
    if (key === "goal") { setMode("goal"); return; }
    if (key === "file") showAction("上传文件将在下一阶段接入。");
    else if (key === "data") showAction("数据源选择将在下一阶段接入。");
    else showAction("导出会话将在下一阶段接入。");
  };

  // 选中某个来源 → 整套切换（保留当前会话/对话上下文）；modelLabel 随 AI_RUNTIME_CHANGED 即时更新
  const pickProfile = (id: string) => {
    setModelOpen(false);
    try {
      switchLlmProfile(id);
    } catch (e) {
      showAction(e instanceof Error ? e.message : String(e));
    }
  };

  // 同厂商换模型 → 复用当前 source 的 key/baseURL，只换 model；modelLabel 随 AI_RUNTIME_CHANGED 即时更新
  const pickModel = (model: string) => {
    setModelOpen(false);
    try {
      switchModelSameProvider(model);
    } catch (e) {
      showAction(e instanceof Error ? e.message : String(e));
    }
  };

  const newChat = () => {
    speech.stop();
    setReadingIdx(-1);
    setDraft("");
    const now = Date.now();
    const s: FrChatSession = { id: newSessionId(), title: "", createdAt: now, updatedAt: now, mode: "chat", messages: [] };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const selectSession = (id: string) => {
    if (id === activeId) return;
    speech.stop();
    setReadingIdx(-1);
    setDraft("");
    setActiveId(id);
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    dropChat(CHAT_SESSION_PREFIX + id);
    if (activeId === id) {
      speech.stop();
      setReadingIdx(-1);
      setDraft("");
      if (next.length) {
        setSessions(next);
        setActiveId(next[0]?.id ?? "");
      } else {
        const now = Date.now();
        const fresh: FrChatSession = { id: newSessionId(), title: "", createdAt: now, updatedAt: now, mode: "chat", messages: [] };
        setSessions([fresh]);
        setActiveId(fresh.id);
      }
    } else {
      setSessions(next);
    }
  };

  const submitText = (text: string, voice = false) => {
    const q = text.trim();
    if (!q) return;
    setDraft("");
    // 首条用户消息定标题（空标题时）
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      return { ...s, title: s.title || titleFromMessage(q), updatedAt: Date.now() };
    }));

    // Goal 意图：命中「跟踪 / 每天 / 定时」即建立长期目标（对话模式也能建），AI 只负责大白话确认
    const goalIntent = detectGoalIntent(q);
    if (goalIntent) {
      createGoal(goalIntent);
      setGoalTick((n) => n + 1);
      showAction(`已建立目标：${goalIntent.title}`);
    }

    const decorate = (out: string): string => {
      const plain = out.startsWith(VOICE_MARK) ? out.slice(VOICE_MARK.length) : out;
      if (goalIntent) {
        return `【模式：Goal】前端已建立长期目标「${goalIntent.title}」（${goalIntent.kind}），每日盘后自动检查。请用大白话确认目标已建立、说明可随时问「我的目标进度」；不要重复创建、不要启动研究。用户原话：${plain}`;
      }
      if (isGoalProgressQuery(plain)) {
        return `【模式：Goal】用户询问目标进度。当前长期目标如下：\n${formatGoalsForPrompt()}\n请逐条用大白话汇报每个目标的状态与最新结果；若上面是「（无目标）」，如实说还没建立任何长期目标，并举例「跟踪 600519 财报」怎么建。`;
      }
      if (mode === "plan") return `【模式：Plan】${plain}`;
      if (mode === "goal") return `【模式：Goal】${plain}`;
      return plain;
    };

    void chat.submit(voice ? VOICE_MARK + q : q, decorate);
  };

  /** 计划卡「修改」：清空输入框、聚焦，提示用户说改哪里 */
  const modifyPlan = () => {
    setDraft("");
    showAction("请直接说要改哪里，我会重新列一份计划。");
    taRef.current?.focus();
  };

  const removeGoal = (id: string) => {
    deleteGoal(id);
    setGoalTick((n) => n + 1);
  };

  const speakReply = (content: string, idx: number) => {
    const segments = ttsSegments(content);
    if (!segments.length) return;
    speech.speak(segments, { onSegment: () => setReadingIdx(idx) });
  };

  const fmtRec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const msgs = ready ? chat.msgs : [];

  return (
    <div data-fr-page="fundradar-agent-chat" className="p-6">
      <div className="fr-fade-in">
        {/* 深色对话坞（原型 ai-surface；fr-screen-dark 跟随全局深浅开关） */}
        <section aria-label="Agent 对话坞" className="fr-screen-dark fr-glass flex flex-col"
          style={{ height: "calc(100vh - 8.5rem)", minHeight: 480 }}>
          <div className="flex min-h-0 flex-1">
            {/* 左侧会话列表（可折叠：收起后收成窄条图标，消息流铺满更多宽度） */}
            {panelCollapsed ? (
              <aside className="flex w-12 shrink-0 flex-col items-center border-r border-border py-3" aria-label="会话历史（已折叠）">
                <button type="button" onClick={() => setPanelCollapsed(false)} title="展开会话列表" aria-label="展开会话列表"
                  className="fr-tap flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-primary">
                  <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="mt-3 text-primary" aria-hidden="true"><Radar className="h-4 w-4" /></span>
              </aside>
            ) : (
              <aside className="fr-session-panel" aria-label="会话历史">
                <div className="fr-session-head">
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-primary-subtle-strong text-primary" aria-hidden="true"><Radar className="h-4 w-4" /></span>
                  <span className="flex-1">To Be <span style={{ color: "hsl(var(--primary))" }}>Future</span></span>
                  <button type="button" onClick={() => setPanelCollapsed(true)} title="折叠会话列表" aria-label="折叠会话列表"
                    className="fr-tap flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary">
                    <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <button type="button" className="fr-session-new" onClick={newChat}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> 新对话
                </button>
                <div className="fr-session-list">
                  {sessions.map((s) => {
                    const ModeIcon = MODE_ICONS[s.mode];
                    return (
                      <div key={s.id} className={`fr-session-item ${s.id === activeId ? "fr-session-active" : ""}`}
                        onClick={() => selectSession(s.id)} role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") selectSession(s.id); }}>
                        <span aria-hidden="true" className="shrink-0"><ModeIcon className="h-3.5 w-3.5" /></span>
                        <span className="fr-session-title">{s.title || "新对话"}</span>
                        <button type="button" className="fr-session-del" title="删除会话" aria-label="删除会话"
                          onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </aside>
            )}

            {/* 右侧主区 */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="rounded-lg bg-muted p-2 text-primary" aria-hidden="true"><MessageCircle className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <h2 className="fr-body font-bold">{activeSession?.title || "今天，想聊什么？"}</h2>
                    <p className="fr-sub text-muted-foreground">
                      {configured ? (agentEnabled ? "资金雷达 · Agent 本地运行" : "普通对话 · Agent 已关闭") : "未接入 AI"}
                    </p>
                  </div>
                </div>
                <span className="fr-sub shrink-0 text-primary">{configured ? "● 已连接 AI" : "○ 未接入 AI"}</span>
              </div>

              <p className="fr-sub shrink-0 px-5 pt-3 text-muted-foreground">
                {agentEnabled
                  ? "直接提问，或点麦克风按钮说话（再点停止，文字填入输入框）。我会实时查最新数据，数字都来自真实数据源。"
                  : "直接提问即可。需要联网查最新数据时，请在侧栏打开 Agent。"}
              </p>

              {/* 未接入 AI：引导到设置页 */}
              {!configured && (
                <div className="mx-5 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-btn border border-warning/30 bg-warning/10 px-4 py-3">
                  <span className="fr-sub font-bold text-warning">请先在设置页接入 AI，就能语音提问了</span>
                  <Link to="/settings-ai"
                    className="fr-sub fr-tap rounded-btn border border-primary/40 bg-primary-subtle-strong px-4 py-2 font-bold text-primary hover:bg-primary-200">
                    去接入 AI →
                  </Link>
                </div>
              )}

              {/* 对话区（真实消息流；按会话 key 重挂触发切换过渡） */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div key={activeId} className="fr-page-enter">
                  {msgs.length === 0 && !chat.loading ? (
                    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
                      <span className="flex items-center justify-center text-muted-foreground" aria-hidden="true"><MessageCircle className="h-10 w-10" /></span>
                      <span className="fr-body text-muted-foreground">点建议问题，或点麦克风按钮说话、再点停止</span>
                      <div className="flex max-w-[720px] flex-wrap justify-center gap-2">
                        {FR_SUGGESTIONS.map((s) => (
                          <button key={s} type="button" disabled={!configured || chat.loading}
                            onClick={() => submitText(s)}
                            className="fr-sub fr-tap rounded-btn border border-border bg-muted/50 px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    msgs.map((m, i) => {
                      if (m.role === "user") {
                        const isVoice = m.content.startsWith(VOICE_MARK);
                        const text = isVoice ? m.content.slice(VOICE_MARK.length) : m.content;
                        return (
                          <div key={i} className="fr-bubble-user flex justify-end">
                            <div className="fr-body max-w-[95%] rounded-2xl border border-border bg-muted/60 px-5 py-3">
                              {isVoice && <div className="fr-sub flex items-center gap-1.5 text-muted-foreground"><Mic className="h-3.5 w-3.5" aria-hidden="true" /> 语音转写</div>}
                              <p className="whitespace-pre-wrap break-words">{text}</p>
                            </div>
                          </div>
                        );
                      }
                      const { body, tools } = splitTools(m.content);
                      const { outside, plan } = splitPlan(body);
                      const { outside: outsideText, ops } = splitOps(outside);
                      const reading = readingIdx === i;
                      const isStreamingLast = chat.loading && i === msgs.length - 1;
                      const prevUser = i > 0 && msgs[i - 1]?.role === "user"
                        ? (msgs[i - 1]!.content.startsWith(VOICE_MARK) ? msgs[i - 1]!.content.slice(VOICE_MARK.length) : msgs[i - 1]!.content)
                        : "";
                      const planSymbol = findCode(plan ?? "") ?? findCode(body) ?? findCode(prevUser);
                      const planIsBacktest = /回测|backtest/i.test(body + prevUser);
                      return (
                        <div key={i} className="fr-bubble-ai mt-4 flex justify-start">
                          <div className={`fr-body max-w-[95%] rounded-2xl border px-5 py-3.5 leading-relaxed ${reading ? "fr-reading-pulse border-primary/50 bg-primary-subtle-strong" : "border-border bg-muted"}`}>
                            {reading && (
                              <div className="fr-sub mb-2 flex items-center gap-2 text-primary">
                                <span className="flex gap-0.5" aria-hidden="true">
                                  <span className="fr-wave" style={{ animationDelay: "0ms" }} />
                                  <span className="fr-wave" style={{ animationDelay: "200ms" }} />
                                  <span className="fr-wave" style={{ animationDelay: "400ms" }} />
                                </span>
                                正在朗读…
                              </div>
                            )}
                            {body.trim() ? (
                              <>
                                {plan && <PlanCard plan={plan} symbol={planSymbol} isBacktest={planIsBacktest} onModify={modifyPlan} />}
                                {ops.map((op, oi) => <OpCard key={oi} op={op} />)}
                                {outsideText.trim() ? <AssistantBody body={outsideText} foldable={!isStreamingLast} /> : null}
                                {isStreamingLast && <span className="fr-stream-cursor" aria-hidden="true" />}
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> 正在思考…
                              </span>
                            )}
                            {tools.length > 0 && <ToolGroup tools={tools} />}
                            {m.content && !isStreamingLast && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {reading ? (
                                  <button type="button" onClick={speech.stop}
                                    className="fr-sub fr-tap rounded-btn border border-primary/40 px-3 py-1.5 font-bold text-primary hover:bg-primary-100">
                                    <Square className="h-3.5 w-3.5" aria-hidden="true" /> 停止朗读
                                  </button>
                                ) : (
                                  <button type="button" onClick={() => speakReply(m.content, i)}
                                    disabled={!speech.supported}
                                    title={speech.supported ? "朗读这条回答" : "当前浏览器不支持语音朗读"}
                                    className="fr-sub fr-tap rounded-btn border border-border px-3 py-1.5 font-bold text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50">
                                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> 朗读
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {chat.err && (
                    <div role="alert" className="fr-sub mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                      <AlertCircle className="mt-1 h-5 w-5 shrink-0" /> {chat.err}
                    </div>
                  )}
                  {chat.info && (
                    <p role="status" className="fr-sub mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-muted-foreground">{chat.info}</p>
                  )}
                </div>
              </div>

              {/* 输入区：＋ / 输入 / 模式 / 模型 / 🎤 / 发送 */}
              <div className="fr-composer shrink-0 px-5 pb-4 pt-2">
                {plusOpen && (
                  <div className="fr-composer-menu" role="menu">
                    <div className="fr-composer-menu-grp">添加</div>
                    <button type="button" role="menuitem" className="fr-composer-menu-item" onClick={() => pickPlus("file")}>
                      <span className="fr-menu-ic"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="fr-menu-nm">文件 <span className="fr-menu-alias">file</span></span>
                    </button>
                    <button type="button" role="menuitem" className="fr-composer-menu-item" onClick={() => pickPlus("data")}>
                      <span className="fr-menu-ic"><Database className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="fr-menu-nm">数据源 <span className="fr-menu-alias">data</span></span>
                      <span className="fr-menu-desc">选择本次取数的端点</span>
                    </button>
                    <div className="fr-composer-menu-grp">指令</div>
                    <button type="button" role="menuitem" className="fr-composer-menu-item" onClick={() => pickPlus("plan")}>
                      <span className="fr-menu-ic"><ListTodo className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="fr-menu-nm">计划 <span className="fr-menu-alias">plan</span></span>
                      <span className="fr-menu-desc">先列计划再执行</span>
                    </button>
                    <button type="button" role="menuitem" className="fr-composer-menu-item" onClick={() => pickPlus("goal")}>
                      <span className="fr-menu-ic"><Target className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="fr-menu-nm">目标 <span className="fr-menu-alias">goal</span></span>
                      <span className="fr-menu-desc">后台长期跟踪</span>
                    </button>
                    <button type="button" role="menuitem" className="fr-composer-menu-item" onClick={() => pickPlus("export")}>
                      <span className="fr-menu-ic"><Download className="h-4 w-4" aria-hidden="true" /></span>
                      <span className="fr-menu-nm">导出 <span className="fr-menu-alias">export</span></span>
                      <span className="fr-menu-desc">导出会话为文件</span>
                    </button>
                  </div>
                )}

                {/* Goal 模式：长期目标列表（查看 / 删除；简单列表） */}
                {mode === "goal" && (
                  <div className="mb-2 rounded-btn border border-border/60 bg-muted/30 px-3 py-2">
                    <div className="fr-sub mb-1 flex items-center gap-1.5 font-bold text-muted-foreground">
                      <Target className="h-3.5 w-3.5" aria-hidden="true" /> 长期目标{goals.length ? `（${goals.length}）` : ""}
                    </div>
                    {goals.length === 0 ? (
                      <p className="fr-sub text-muted-foreground">还没有目标。试试说「跟踪 600519 财报」，盘后会自动检查。</p>
                    ) : (
                      <div className="space-y-1">
                        {goals.map((g) => (
                          <div key={g.id} className="flex items-center gap-2 rounded-btn border border-border/40 bg-background/40 px-2.5 py-1.5">
                            <span className="fr-sub min-w-0 flex-1 truncate">{g.title}</span>
                            <span className="fr-sub shrink-0 text-muted-foreground">{g.kind}</span>
                            <span className="fr-sub shrink-0 text-muted-foreground">{g.lastRunAt ? new Date(g.lastRunAt).toLocaleString() : "未检查"}</span>
                            <button type="button" onClick={() => removeGoal(g.id)} title="删除目标" aria-label={`删除目标 ${g.title}`}
                              className="fr-tap shrink-0 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className={`fr-composer-bar ${listening ? "fr-composer-recording" : ""}`}>
                  <button type="button" className="fr-composer-ibtn" title="添加或选择指令" aria-label="添加或选择指令"
                    onClick={(e) => { e.stopPropagation(); setPlusOpen((v) => !v); }}>
                    <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>

                  <textarea
                    ref={taRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return; // 中文输入法选字期间的 Enter 不发送
                      if (e.key === "Enter") { e.preventDefault(); submitText(draft); }
                    }}
                    placeholder={listening ? "正在聆听，请说话…" : "问点什么，或按 F2 说话…"}
                    aria-label="输入问题"
                    rows={1}
                    className="fr-composer-ta"
                  />

                  {listening && (
                    <>
                      <span className="fr-composer-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                      <span className="fr-composer-rtime" role="timer">{fmtRec(recSec)}</span>
                    </>
                  )}

                  {/* 模式选择器（对话 / Plan / Goal） */}
                  <div className="fr-picker-wrap">
                    <button type="button" className="fr-composer-picker" title="选择模式"
                      onClick={(e) => { e.stopPropagation(); setModeOpen((v) => !v); }}>
                      <span>{MODE_LABELS[mode]}</span>
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {modeOpen && (
                      <div className="fr-composer-picker-menu" role="menu">
                        {(Object.keys(MODE_LABELS) as FrChatMode[]).map((m) => (
                          <button key={m} type="button" role="menuitem"
                            className={`fr-composer-picker-opt ${m === mode ? "fr-picker-active" : ""}`}
                            onClick={() => { setMode(m); setModeOpen(false); }}>
                            {MODE_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 模型选择器：下拉列出已配置的多个来源，选中即整套切换（不跳页、保留当前对话） */}
                  <div className="fr-picker-wrap">
                    <button type="button" className="fr-composer-picker" title="切换 AI 模型"
                      onClick={(e) => { e.stopPropagation(); setModelOpen((v) => !v); }}>
                      <span className="max-w-[120px] truncate">{modelLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {modelOpen && (
                      <div className="fr-composer-picker-menu" role="menu" style={{ minWidth: 280, maxWidth: "calc(100vw - 32px)" }}>
                        <div className="fr-composer-menu-grp">已配置的来源</div>
                        {profiles.map((p) => {
                          const active = currentSource !== undefined
                            && p.provider === currentSource.provider
                            && p.baseURL === currentSource.baseURL
                            && p.model === currentSource.model;
                          return (
                            <button key={p.id} type="button" role="menuitem"
                              className={`fr-composer-picker-opt ${active ? "fr-picker-active" : ""}`}
                              onClick={() => pickProfile(p.id)}>
                              <span className="min-w-0 flex-1 truncate">{sourceFriendlyName(p.provider, p.model)}</span>
                              <span className="fr-sub shrink-0 text-muted-foreground">{sourceProviderTag(p.provider)}</span>
                              {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                            </button>
                          );
                        })}
                        {sameProviderModels.length > 0 && (
                          <>
                            <div className="my-1 border-t border-border" />
                            <div className="fr-composer-menu-grp">{sameProviderLabel} 的其他模型</div>
                            {sameProviderModels.map((m) => (
                              <button key={m.id} type="button" role="menuitem"
                                className="fr-composer-picker-opt"
                                onClick={() => pickModel(m.id)}>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{m.name}</span>
                                  <span className="fr-sub block truncate text-muted-foreground">{m.description}</span>
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                        <div className="my-1 border-t border-border" />
                        <Link to="/settings-ai" role="menuitem" onClick={() => setModelOpen(false)}
                          className="fr-composer-picker-opt font-bold text-primary">
                          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> 配置新模型
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* 麦克风（录音中变红色停止按钮） */}
                  <VoiceInput ref={voiceRef} disabled={!configured || chat.loading}
                    interaction="toggle" onTranscript={(t) => setDraft(t)} onInterim={(t) => setDraft(t)} onListeningChange={setListening} />

                  {/* 发送 / 停止 */}
                  {chat.loading ? (
                    <button type="button" className="fr-composer-ibtn fr-composer-stop" title="停止" aria-label="停止" onClick={chat.abort}>
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" className="fr-composer-ibtn fr-composer-primary" title="发送" aria-label="发送"
                      disabled={!draft.trim() || !configured} onClick={() => submitText(draft)}>
                      <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {actionHint && (
                  <p role="status" className="fr-sub mt-2 text-center text-muted-foreground">{actionHint}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <p className="fr-sub mt-3 text-muted-foreground">
          语音输入：浏览器走语音识别，桌面版走本地离线识别（sherpa-onnx，免联网免密钥）。朗读：系统 TTS，语速三档可在「每日复盘 · 晨报」处调节。
        </p>
      </div>
    </div>
  );
}
