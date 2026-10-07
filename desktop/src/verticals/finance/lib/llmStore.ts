/**
 * 用户模型配置的**唯一存放处**（当前浏览器配置的 localStorage）。
 * 它会随浏览器配置持久保存在本机磁盘，**不是系统钥匙串，也不承诺加密**；但不会写入
 * 产品仓库、后端配置、日志、事件账本或研究产物。共享电脑上使用后应主动清除。
 *
 * 🔴 单独成一个模块，是为了让**传输层 `backend.chat` 自己**就能读到它 ——
 *    放在 `llm.ts` 里会与 `backend.ts` 形成循环依赖，于是只能由调用方逐个记得传，
 *    而**记不住就是默认行为**：实测里 Agent 面板（`FinanceAiDock`）与 `agents.ts`
 *    两条最常用的路都没传，用户在界面上选的模型根本没生效 —— 对话照常成功、
 *    照常有答案，只是出自另一家，**界面上一个字都看不出来**。
 *    ⇒ 防线只守住三个入口里的一个，就等于没有防线。
 */

/** 用户自己那一份存在这儿 */
export const LLM_KEY = "vr-llm";
/** 多配置档案：用户配过的每一套 {provider,baseURL,apiKey,model} 都留档，与 LLM_KEY 分开存 */
export const PROFILES_KEY = "fr-llm-profiles";

export interface LlmConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

/** 一条多配置档案：整套来源（厂商 + key + 模型）+ 展示名 + 归档时间 */
export interface LlmProfile {
  id: string;
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 归档时生成的人类可读名（订阅名 / 供应商·模型），仅供展示兜底；对话页仍按 AI_MODELS 算友好名 */
  label: string;
  savedAt: number;
}

export type ExecutionMode = "agent" | "direct";

export interface AiRuntimeConfig {
  schemaVersion: 2;
  source: LlmConfig;
  executionMode: ExecutionMode;
  /** M24 distinguishes an explicit choice from the previous automatic Agent default. */
  modePreferenceVersion?: 1;
  directSupported: boolean;
  directReason: string;
}

export interface AiRuntimeRead {
  status: LlmStatus;
  config: AiRuntimeConfig | null;
}

/** CLI 订阅档：用本机已登录的引擎，免 API key */
const isCli = (p: string): boolean => p.startsWith("cli-");

/**
 * 这份配置**后端收不收**。
 *
 * 🔴 口径必须与 `orchestrator/src/runtime_provider.ts` 一致。两边各判一半的后果是分岔的：
 *    前端严一点 ⇒ 明明能用的配置被判「坏了」（`cli-codex` 不填 model、模板只填 provider+key
 *    都属此列，后端接受得好好的）；前端松一点 ⇒ 用户看到"已配置"、一提问才报错。
 *    （Codex 复审 r3 指出，实跑两端确认过。）
 * ⚠️ 只判**形状**，不判 provider 认不认识 —— 那是后端的事，它给的错误码更可行动。
 */
function isUsable(c: LlmConfig): boolean {
  if (!c.provider) return false;
  if (isCli(c.provider)) return true;                                   // 订阅档：免 key，模型由登录态定
  if (c.provider === "openai-compatible" || c.provider === "custom") {
    return Boolean(c.baseURL && c.apiKey);                              // 自填端点：端点 + key 必给，model 可空
  }
  return Boolean(c.apiKey);                                             // 产品模板：key 必给，baseURL / model 可从模板取
}

/**
 * 本地这份配置的状态。
 *
 * 🔴 **三种情况必须分开**，不能都返回 null：
 *    - `none`（真没配）要回到“接入 AI”，不能让后端默认替用户做选择；
 *    - `broken`（存着但读不懂 / 字段不全）当没配 = **静默换一家去打**，
 *      对话照常有答案，用户完全看不出自己选的模型没生效；
 *    - `unavailable`（隐私模式、存储被策略拒绝）同理，而且每次打开都会重演。
 *    （Codex 审计 r2 P2，核实属实。）
 */
export type LlmStatus = "none" | "ok" | "broken" | "unavailable";

export interface LlmRead {
  status: LlmStatus;
  config: LlmConfig | null;
}

export function readAiRuntime(): AiRuntimeRead {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LLM_KEY);
  } catch {
    return { status: "unavailable", config: null };
  }
  if (!raw) return { status: "none", config: null };
  try {
    const parsed = JSON.parse(raw) as Partial<LlmConfig> & Partial<AiRuntimeConfig>;
    // 架构师决策「统一 Agent 模式」：默认 Agent；显式关闭（executionMode=direct）才走普通对话。
    // 只在用户下次保存时才写回 v2，避免打开页面就修改密钥存储。
    const c = parsed.schemaVersion === 2 && parsed.source && typeof parsed.source === "object"
      ? parsed.source as Partial<LlmConfig>
      : parsed;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const cfg: LlmConfig = {
      provider: str(c.provider), baseURL: str(c.baseURL), apiKey: str(c.apiKey), model: str(c.model),
    };
    const directSupported = parsed.schemaVersion === 2 && parsed.directSupported === true;
    const directReason = parsed.schemaVersion === 2 && typeof parsed.directReason === "string"
      ? parsed.directReason : "请重新测试连接后查看直连能力";
    // 架构师决策「统一 Agent 模式」：默认 Agent；只有用户显式关闭（modePreferenceVersion=1 且 executionMode=direct）才走普通对话。
    const executionMode: ExecutionMode = parsed.schemaVersion === 2 && parsed.modePreferenceVersion === 1 && parsed.executionMode === "direct"
      ? "direct"
      : "agent";
    return isUsable(cfg)
      ? { status: "ok", config: { schemaVersion: 2, modePreferenceVersion: 1, source: cfg, executionMode, directSupported, directReason } }
      : { status: "broken", config: null };
  } catch {
    return { status: "broken", config: null };
  }
}

export function readUserLlm(): LlmRead {
  const runtime = readAiRuntime();
  return { status: runtime.status, config: runtime.config?.source ?? null };
}

/** 用户自己配的那一份（没配 / 坏了都返回 null）。**要分清哪种，用 `readUserLlm`。** */
export function loadUserLlm(): LlmConfig | null {
  return readUserLlm().config;
}

/** 存不下时抛错 —— 静默失败会让用户以为配好了，下次打开又是空的 */
export function saveUserLlm(cfg: LlmConfig, capability?: { directSupported: boolean; directReason: string }): void {
  const previous = readAiRuntime().config;
  const sameSource = previous && (["provider", "baseURL", "apiKey", "model"] as const)
    .every(key => (previous.source[key] ?? "") === (cfg[key] ?? ""));
  // 老用户迁移：档案还为空时，先把当前已生效的旧来源落成第一条档案，避免被这次保存覆盖后丢失
  if (previous && isUsable(previous.source) && readStoredProfiles().length === 0) {
    try {
      persistProfiles([toProfile(previous.source)]);
    } catch { /* 档案写入失败不影响主保存 */ }
  }
  const directSupported = capability?.directSupported ?? false;
  const directReason = capability?.directReason ?? "请重新测试连接后查看直连能力";
  const serialized = JSON.stringify({
    schemaVersion: 2, source: cfg,
    // 架构师决策「统一 Agent 模式」：新连接默认 Agent；换源才重置，同源保留用户上次的显式开关。
    executionMode: sameSource ? previous.executionMode : "agent", modePreferenceVersion: 1,
    directSupported, directReason,
  } satisfies AiRuntimeConfig);
  localStorage.setItem(LLM_KEY, serialized);
  if (localStorage.getItem(LLM_KEY) !== serialized) throw new Error("AI 配置未能保存在当前浏览器，请检查存储权限后重试");
  // 这份配置也记入档案（同源覆盖 / 异源追加）；档案落盘失败不阻断已生效的当前配置
  try {
    upsertProfile(cfg);
  } catch { /* 档案写入失败不影响当前生效的配置 */ }
  notifyRuntimeChanged();
}

/** 切换执行方式只改同一份配置，不复制 API key。 */
export function saveExecutionMode(executionMode: ExecutionMode): void {
  const current = readAiRuntime();
  if (current.status !== "ok" || !current.config) throw new Error("请先连接 AI");
  if (executionMode !== "agent" && executionMode !== "direct") throw new Error("无效的 Agent 开关值");
  localStorage.setItem(LLM_KEY, JSON.stringify({ ...current.config, executionMode } satisfies AiRuntimeConfig));
  notifyRuntimeChanged();
}

/**
 * 清除。**失败要抛**，并且**回读确认**真的没了。
 * 🔴 吞掉异常的话，界面会说"已清除"，而旧 key 还躺在 localStorage 里、
 *    下一次提问照样被发出去 —— 界面说的和事实相反，这比报错难查得多。
 */
export function clearUserLlm(): void {
  localStorage.removeItem(LLM_KEY);
  if (localStorage.getItem(LLM_KEY) !== null) throw new Error("本地存储没能删掉这条配置");
  notifyRuntimeChanged();
}

/* ------------------------------------------------------------------ *
 * 多配置档案（fr-llm-profiles）：用户配过的每一套都留档，可随时整包切换。
 * 与 LLM_KEY 分开存：LLM_KEY 只管「当前生效的这一份」，档案管「配过的所有份」。
 * 去重键 = provider + baseURL + model（改 key 算更新，不另起一条）。
 * ------------------------------------------------------------------ */

function newProfileId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* ignore */ }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 归档展示名（兜底）：订阅档用订阅名，API 档用「供应商 · 模型」 */
function profileLabelFor(cfg: LlmConfig): string {
  const model = cfg.model?.trim();
  if (cfg.provider.startsWith("cli-")) return model || cfg.provider;
  return model ? `${cfg.provider} · ${model}` : cfg.provider;
}

function toProfile(cfg: LlmConfig, id?: string): LlmProfile {
  return {
    id: id ?? newProfileId(),
    provider: cfg.provider ?? "",
    baseURL: cfg.baseURL ?? "",
    apiKey: cfg.apiKey ?? "",
    model: cfg.model ?? "",
    label: profileLabelFor(cfg),
    savedAt: Date.now(),
  };
}

/** 解析并规整已落盘的档案（只读，不做空档兜底；读不了/读坏返回空表） */
function readStoredProfiles(): LlmProfile[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PROFILES_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const out: LlmProfile[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const provider = str(o.provider);
      if (!provider) continue; // 没有 provider 的档案不可用，跳过
      const cfg: LlmConfig = { provider, baseURL: str(o.baseURL), apiKey: str(o.apiKey), model: str(o.model) };
      out.push({
        id: str(o.id) || newProfileId(),
        provider,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        model: cfg.model,
        label: str(o.label) || profileLabelFor(cfg),
        savedAt: typeof o.savedAt === "number" ? o.savedAt : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function persistProfiles(list: LlmProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

/** 去重键：同 provider+baseURL+model 视为同一套 */
function profileKey(cfg: Pick<LlmConfig, "provider" | "baseURL" | "model">): string {
  return `${cfg.provider ?? ""}\u0000${cfg.baseURL ?? ""}\u0000${cfg.model ?? ""}`;
}

/** 档案落盘（内部，不派发事件）：同源覆盖、异源追加，返回最新档案表 */
function upsertProfile(cfg: LlmConfig, label?: string): LlmProfile[] {
  const list = readStoredProfiles();
  const key = profileKey(cfg);
  const existing = list.find((p) => profileKey(p) === key);
  const next: LlmProfile = toProfile(cfg, existing?.id);
  if (label !== undefined) next.label = label;
  const updated = existing
    ? list.map((p) => (profileKey(p) === key ? next : p))
    : [...list, next];
  persistProfiles(updated);
  return updated;
}

/** 已配置的全部来源。老用户档案为空时，用当前 LLM_KEY 的 source 兜底为唯一档案（id 固定 "current"，不落盘）。 */
export function loadLlmProfiles(): LlmProfile[] {
  const stored = readStoredProfiles();
  if (stored.length) return stored;
  const current = readAiRuntime().config;
  if (current && isUsable(current.source)) return [toProfile(current.source, "current")];
  return [];
}

/** 记入 / 更新一条档案（去重覆盖），并派发 AI_RUNTIME_CHANGED。 */
export function saveLlmProfile(cfg: LlmConfig, label?: string): LlmProfile[] {
  const updated = upsertProfile(cfg, label);
  notifyRuntimeChanged();
  return updated;
}

/** 移除一条档案（不影响当前 LLM_KEY 生效的配置），并派发 AI_RUNTIME_CHANGED。 */
export function removeLlmProfile(id: string): void {
  persistProfiles(readStoredProfiles().filter((p) => p.id !== id));
  notifyRuntimeChanged();
}

/** 切换整套来源：写 LLM_KEY 的 source，同源保留 executionMode、换源重置 agent；session / 对话上下文不动。 */
export function switchLlmProfile(id: string): void {
  const profile = loadLlmProfiles().find((p) => p.id === id);
  if (!profile) throw new Error("未找到这条 AI 配置，可能已被删除");
  const cfg: LlmConfig = { provider: profile.provider, baseURL: profile.baseURL, apiKey: profile.apiKey, model: profile.model };
  const current = readAiRuntime().config;
  const sameSource = current && (["provider", "baseURL", "apiKey", "model"] as const)
    .every(key => (current.source[key] ?? "") === (cfg[key] ?? ""));
  const serialized = JSON.stringify({
    schemaVersion: 2, source: cfg,
    // 同源保留用户上次的显式开关；换源才重置回 Agent（与 saveUserLlm 同一套 sameSource 语义）
    executionMode: sameSource ? current.executionMode : "agent", modePreferenceVersion: 1,
    directSupported: current?.directSupported ?? false,
    directReason: current?.directReason ?? "请重新测试连接后查看直连能力",
  } satisfies AiRuntimeConfig);
  localStorage.setItem(LLM_KEY, serialized);
  if (localStorage.getItem(LLM_KEY) !== serialized) throw new Error("AI 配置未能保存在当前浏览器，请检查存储权限后重试");
  notifyRuntimeChanged();
}

/** 同厂商换模型：复用当前 source 的 provider/baseURL/apiKey，只换 model（key 复用，无需重填）。
 *  订阅档（cli-*）没有模型列表，调用方应只在 API 档下调用。 */
export function switchModelSameProvider(model: string): void {
  const current = readAiRuntime();
  if (current.status !== "ok" || !current.config) throw new Error("请先配置 AI");
  const cfg: LlmConfig = {
    provider: current.config.source.provider,
    baseURL: current.config.source.baseURL,
    apiKey: current.config.source.apiKey,
    model,
  };
  const serialized = JSON.stringify({
    schemaVersion: 2, source: cfg,
    // 同源换模型：executionMode / 直连能力全部保留（与 saveExecutionMode 同一份配置，不复制 key）
    executionMode: current.config.executionMode, modePreferenceVersion: 1,
    directSupported: current.config.directSupported,
    directReason: current.config.directReason,
  } satisfies AiRuntimeConfig);
  localStorage.setItem(LLM_KEY, serialized);
  if (localStorage.getItem(LLM_KEY) !== serialized) throw new Error("AI 配置未能保存在当前浏览器，请检查存储权限后重试");
  // 新模型也记入档案（同 provider 不同 model = 新的一套），让「已配置的来源」里能高亮当前项
  try {
    upsertProfile(cfg);
  } catch { /* 档案写入失败不影响当前生效的配置 */ }
  notifyRuntimeChanged();
}

export const AI_RUNTIME_CHANGED = "vibe-research:ai-runtime-changed";

function notifyRuntimeChanged(): void {
  if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent === "function") {
    globalThis.dispatchEvent(new CustomEvent(AI_RUNTIME_CHANGED));
  }
}
