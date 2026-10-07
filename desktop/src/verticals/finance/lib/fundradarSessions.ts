/**
 * 资金雷达工作台 · Agent 对话会话目录（阶段 1 · 界面骨架）
 * ------------------------------------------------------------
 * localStorage 键 `fr-chat-sessions` 存「目录」级信息：会话 id / 标题 / 时间 / 模式 /
 * 消息镜像（供列表展示与后续「导出」用）。
 *
 * 消息的**权威持久化仍由 core/ai/useAiChat 按 key 承担**（`vr-ai-chat:fundradar-agent-chat:<id>`），
 * 那边已经处理了「半截回答不落盘」「换 key 中止在跑请求」等守卫；这里不复刻那份状态机，
 * 避免两份存储漂移。目录里的 `messages` 只是完整轮次的快照镜像，实时渲染以 useAiChat 的 msgs 为准。
 */
import { storageGet, storageSet } from "./storage";

export type FrChatMode = "chat" | "plan" | "goal";

export interface FrChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FrChatSession {
  id: string;
  /** 首条用户消息前 12 字；空 = 尚未开始 */
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: FrChatMode;
  messages: FrChatMessage[];
}

const KEY = "fr-chat-sessions";

/** useAiChat 的对话 key 前缀：一个会话一份，后端线程随 key 隔离 */
export const CHAT_SESSION_PREFIX = "fundradar-agent-chat:";

function parse(raw: string | null): FrChatSession[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const list = v.filter(
      (s): s is FrChatSession =>
        !!s && typeof s === "object"
        && typeof (s as FrChatSession).id === "string"
        && typeof (s as FrChatSession).title === "string"
        && Array.isArray((s as FrChatSession).messages),
    );
    // 历史数据容错：mode 缺失按「对话」补
    return list.map((s) => ({
      ...s,
      mode: s.mode === "plan" || s.mode === "goal" ? s.mode : "chat",
      messages: Array.isArray(s.messages) ? s.messages : [],
    }));
  } catch {
    return [];
  }
}

/** 读会话目录，按最近更新倒序 */
export function loadSessions(): FrChatSession[] {
  return parse(storageGet(KEY)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function persistSessions(list: FrChatSession[]): void {
  storageSet(KEY, JSON.stringify(list));
}

export function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* 隐私模式等环境退化到时间戳 */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 标题：首条用户消息前 12 字（去首尾空白；调用方传入的是未加语音前缀的原文） */
export function titleFromMessage(q: string): string {
  return q.trim().replace(/\s+/g, " ").slice(0, 12);
}
