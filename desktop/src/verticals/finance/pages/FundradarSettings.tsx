/**
 * 资金雷达工作台 · 设置页（常用区域 P7，详规 v0.2 §7）
 * 设置分组：字号档位（四档可用切换）/ 深浅模式 / 持仓与板块管理 / 晨报与免打扰 /
 * 语速音量 / 提醒开关与阈值 / 快捷键 / AI 设置组 / 数据更新 / 免责声明。
 * TODO: 接入真实数据（刀4/测试阶段）—— 除字号档位与深浅模式外均为示例控件；
 *       持仓/板块/提醒等设置将在刀4 落到本地 SQLite。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bell, BellOff, Bot, Download, Eye, EyeOff, Keyboard, LoaderCircle, Moon, RefreshCw, Settings, Sun, SunMoon, Tag, Trash2, Type, Volume2, Wallet, type LucideIcon,
} from "lucide-react";
import { useAiPage } from "../../../core/ai/pageContext";
import { useDarkMode } from "@/hooks/useDarkMode";
import { FR_DEFAULT_SECTORS, FR_DISCLAIMER, FR_SUGGESTIONS } from "@/data/fundradarSample";
import { FONT_TIERS, FR_FONT_TIER_CHANGED, loadFontTier, saveFontTier, type FontTier } from "@/lib/fundradarTheme";
import { updateAllFrData } from "@/lib/fundradarUpdate";
import {
  FR_AUTO_INTERVAL_OPTIONS, frCountdownLabel, frLastRefreshLabel, saveAutoRefreshEnabled,
  saveAutoRefreshInterval, useAutoRefreshStatus,
} from "@/lib/fundradarAutoRefresh";
import { isCliProvider } from "@/lib/ai-models";
import { aiConnectionLabel, testAndSaveAi } from "@/lib/aiConnection";
import { backend, friendlyAgentError } from "@/lib/backend";
import { clearLlm, loadUserLlm, saveLlm, type LlmConfig } from "@/lib/llm";
import { LLM_KEY } from "@/lib/llmStore";
import { FR_AI_PROVIDERS, frModelSuggestions, frProvider } from "@/lib/frAiProviders";
import { useAiRuntime } from "@/hooks/useAiRuntime";
import { loadHoldings, saveHoldings, useHoldings, type FrHolding } from "@/lib/fundradarPortfolio";
import { loadStockQuote } from "@/lib/fundradarStock";
import { FrAppUpdate } from "@/components/fundradar/FrAppUpdate";

/** 设置分组卡片：大标题（可选线框图标）+ 分组内容 */
function Group({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section className="fr-glass mb-4 rounded-xl p-5">
      <h2 className="fr-body mb-3 flex items-center gap-2 font-bold">
        {Icon && <Icon className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 示例开关（提醒类，演示用） */
function DemoSwitch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle}
      className="flex items-center gap-3 text-left">
      <span aria-hidden="true" className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors ${on ? "border-primary bg-primary" : "border-muted-foreground/40 bg-muted"}`}>
        <span className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-7" : "translate-x-1"}`} />
      </span>
      <span className="fr-body">{label}</span>
    </button>
  );
}

/** AI 字段统一样式：常用大字（24px 正文）+ ≥56px 高 */
const FR_FIELD = "fr-body mt-1 block w-full max-w-2xl min-h-14 rounded-input border border-border bg-card px-4 py-3 placeholder:text-muted-foreground focus:border-primary focus:outline-none";

/**
 * AI 接入配置面板（刀4，详规 v0.2 §7「AI 设置组」落库）。
 *
 * 与底座原版「接入 AI」页共用同一条真实链路：
 *   - 供应商默认地址 / 模型来自仓库 providers/*.json 模板（选中自动填入，可修改）；
 *   - 「测试并保存」走 backend.llmProbe（后端固定一次性令牌的真实对话探针），
 *     只有探针通过才 saveLlm 写进同一份 localStorage（LLM_KEY），Agent 对话页真实读到；
 *   - 失败只显示原因，绝不覆盖已保存的配置（testAndSaveAi 的 read→probe→save 契约）。
 * ⚠️ Key 只做透传：面板不读取、不输出、不记录完整 Key；粘贴后默认隐藏显示。
 */
function AiConnectPanel() {
  const runtime = useAiRuntime();
  const existing = loadUserLlm();
  // 只有已保存的供应商在本面板六家之内，才用旧配置预填；否则从 DeepSeek 全新开始。
  const saved = existing && !isCliProvider(existing.provider) && FR_AI_PROVIDERS.some((p) => p.id === existing.provider)
    ? existing : null;
  // 已保存配置字段为空时（如原版接入页按模板保存、没填 baseURL/model），回落到模板默认值
  const savedProvider = saved ? frProvider(saved.provider) : undefined;
  const [providerId, setProviderId] = useState(saved?.provider ?? FR_AI_PROVIDERS[0]!.id);
  const [baseUrl, setBaseUrl] = useState(saved ? (saved.baseURL || savedProvider?.baseUrl || "") : FR_AI_PROVIDERS[0]!.baseUrl);
  const [model, setModel] = useState(saved ? (saved.model || savedProvider?.defaultModel || "") : FR_AI_PROVIDERS[0]!.defaultModel);
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState("");

  const provider = frProvider(providerId);
  const connected = runtime.status === "ok";
  const placeholderLeft = /[{<][A-Za-z_]/.test(baseUrl);

  const say = (ok: string) => { setMsg(ok); setMsgErr(""); };
  const oops = (bad: string) => { setMsg(""); setMsgErr(bad); };

  const pickProvider = (id: string) => {
    const p = frProvider(id);
    if (!p) return;
    setProviderId(id);
    setBaseUrl(p.baseUrl);
    setModel(p.defaultModel);
    say("");
  };

  const buildConfig = (): LlmConfig | null => {
    if (!provider) return oops("请先选择供应商"), null;
    if (!baseUrl.trim()) return oops("请填写 API 地址（选择供应商会自动填入，可修改）"), null;
    if (placeholderLeft) return oops("API 地址里还有 {…} 占位符没替换，请换成你自己的值再测试"), null;
    if (!model.trim()) return oops("请填写模型名称（选择供应商会自动填入默认模型，可修改）"), null;
    if (!apiKey.trim()) return oops("请填写 API Key"), null;
    return { provider: providerId, baseURL: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() };
  };

  const testAndSave = async () => {
    const cfg = buildConfig();
    if (!cfg) return;
    setTesting(true); setMsg(""); setMsgErr("");
    try {
      await testAndSaveAi(cfg, {
        read: () => localStorage.getItem(LLM_KEY),
        probe: backend.llmProbe,
        save: saveLlm,
      });
      say(`连接成功：「${provider?.label ?? cfg.provider}」已保存（模型 ${cfg.model}）。Agent 对话页会直接使用这份配置。`);
    } catch (e) {
      // 🔴 失败不覆盖：testAndSaveAi 只在真实探针通过后才调用 save，旧配置原样保留
      oops(friendlyAgentError(e));
    } finally {
      setTesting(false);
    }
  };

  const forget = () => {
    try {
      clearLlm();
      setApiKey("");
      say("已清除本机保存的 AI 配置。再次使用 AI 功能前需要重新测试并保存。");
    } catch (e) {
      oops(e instanceof Error ? e.message : String(e));
    }
  };

  const badge = testing
    ? { label: "测试中…", cls: "border-warning/50 bg-warning/10 text-warning" }
    : connected
      ? { label: "已连接", cls: "border-success/50 bg-success/10 text-success" }
      : { label: "未连接", cls: "border-border bg-muted text-muted-foreground" };

  return (
    <div>
      {/* 状态徽标：已连接 / 未连接 / 测试中 */}
      <div className="mb-4 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
        <span className={`fr-sub inline-flex items-center gap-2 rounded-full border px-5 py-1.5 font-bold ${badge.cls}`}>
          <span className="h-3 w-3 rounded-full bg-current" aria-hidden="true" />
          {badge.label}
        </span>
        {connected && <span className="fr-sub font-bold text-success">{aiConnectionLabel(runtime)}</span>}
        {!connected && <span className="fr-sub text-muted-foreground">连接成功后，Agent 对话页才能使用 AI。</span>}
      </div>

      {/* 1. 供应商选择 */}
      <div className="fr-body font-bold">1. 选择供应商</div>
      <p className="fr-sub mb-2 text-muted-foreground">选中后自动填好「API 地址」与「模型」，都可以再改。</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="AI 供应商">
        {FR_AI_PROVIDERS.map((p) => {
          const on = providerId === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => pickProvider(p.id)}
              className={`fr-tap min-h-16 rounded-btn border p-3 text-left transition-colors ${
                on ? "border-primary bg-primary-subtle-strong ring-2 ring-primary/40" : "border-border bg-card hover:border-primary/50"}`}>
              <span className={`fr-body block font-bold ${on ? "text-primary" : ""}`}>
                {p.label}
                {p.placeholder && <span className="fr-sub ml-2 rounded bg-warning/15 px-1.5 py-0.5 font-bold text-warning">需改地址</span>}
              </span>
              <span className="fr-sub block leading-snug text-muted-foreground">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {/* 2. API 地址 */}
      <label className="fr-body mt-5 block font-bold">
        2. API 地址（Base URL）
        <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); say(""); }}
          placeholder="https://…（选择供应商自动填入）" className={FR_FIELD} />
      </label>
      <p className="fr-sub mt-1 text-muted-foreground">选择供应商会自动填入官方地址；自托管 / 私有网关可改成自己的地址。</p>
      {placeholderLeft && (
        <p className="fr-sub mt-1 font-bold text-destructive">地址里还有 {"{…}"} 占位符，请替换成你自己的值再测试。</p>
      )}

      {/* 3. 模型 */}
      <label className="fr-body mt-5 block font-bold">
        3. 模型名称
        <input list="fr-ai-model-suggestions" value={model} onChange={(e) => { setModel(e.target.value); say(""); }}
          placeholder="如 deepseek-flash / deepseek-v4-pro" className={FR_FIELD} />
        <datalist id="fr-ai-model-suggestions">
          {frModelSuggestions(providerId).map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
      <p className="fr-sub mt-1 text-muted-foreground">默认已填当前供应商的推荐模型；点输入框可换其它模型（如 deepseek-v4-pro）。</p>

      {/* 4. Key */}
      <div className="fr-body mt-5 font-bold">4. API Key</div>
      <div className="mt-1 flex w-full max-w-2xl items-center gap-2">
        <input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => { setApiKey(e.target.value); say(""); }}
          aria-label="API Key" placeholder="sk-…（仅保存在本机浏览器，不读取不输出）" className={FR_FIELD} />
        <button type="button" onClick={() => setShowKey(!showKey)} aria-pressed={showKey}
          className="fr-btn-h fr-tap inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-border bg-card px-4 font-bold hover:border-primary/50">
          {showKey ? <EyeOff className="h-6 w-6 text-primary" /> : <Eye className="h-6 w-6 text-primary" />}
          {showKey ? "隐藏" : "显示"}
        </button>
      </div>
      <p className="fr-sub mt-1 text-muted-foreground">
        Key 只保存在这台电脑的浏览器里，提问时经本机底座转发给所选供应商；粘贴后默认隐藏显示，不读取、不输出。
        {provider?.envKey ? `（该供应商模板的密钥变量名：${provider.envKey}）` : ""}
      </p>

      {/* 结果消息：成功绿 / 失败红，失败绝不覆盖已保存配置 */}
      {msgErr && (
        <p role="alert" className="fr-body mt-4 rounded-btn border border-destructive/40 bg-destructive/10 px-4 py-3 font-bold text-destructive">
          {msgErr}（之前保存好的配置未被改动）
        </p>
      )}
      {msg && (
        <p role="status" className="fr-body mt-4 rounded-btn border border-success/40 bg-success/10 px-4 py-3 font-bold text-success">
          {msg}
        </p>
      )}

      {/* 5. 测试并保存 */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void testAndSave()} disabled={testing}
          className="fr-btn-h fr-tap fr-body inline-flex items-center gap-2 rounded-btn bg-primary px-10 font-bold text-primary-foreground hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
          {testing && <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />}
          {testing ? "正在实测连接…" : "测试并保存"}
        </button>
        {connected && (
          <button type="button" onClick={forget}
            className="fr-btn-h fr-tap fr-body inline-flex items-center gap-2 rounded-btn border border-border bg-card px-6 font-bold text-muted-foreground hover:border-destructive/50 hover:text-destructive">
            <Trash2 className="h-6 w-6" aria-hidden="true" />
            清除已保存配置
          </button>
        )}
      </div>
      <p className="fr-sub mt-3 text-muted-foreground">
        只有真实测试成功才会保存；失败会显示具体原因，之前保存好的配置保持不变。订阅接入等高级选项仍可到原版接入页调整：
        <Link to="/settings-ai" className="ml-1 font-bold text-primary hover:underline">打开原版「接入 AI」→</Link>
      </p>
    </div>
  );
}

/** 字号档位按钮副文案：档位 → 行情主数字 px（与 fundradar-theme.css --fs-num 一致） */
const FR_TIER_NUM: Record<FontTier, string> = {
  compact: "数字 24",
  standard: "数字 32",
  large: "数字 40",
  xlarge: "数字 48",
};

/** 持仓管理输入框：≥56px 高（min-h-14），正文 24px（fr-body）。 */
const HOLDING_INPUT = "fr-body min-h-14 rounded-input border border-border bg-card px-4 py-3 placeholder:text-muted-foreground focus:border-primary focus:outline-none";

/** 查一只 6 位代码的名称：走 tx_quotes_batch（loadStockQuote），查不到返回空串让用户手填。 */
async function resolveHoldingName(code: string): Promise<string> {
  try {
    const q = await loadStockQuote(code, false);
    return q.name && q.name !== code ? q.name : "";
  } catch {
    return "";
  }
}

/** 持仓一行：默认展示，点「编辑」就地改成本/数量。 */
function HoldingRow({
  h, onUpdate, onDelete,
}: {
  h: FrHolding;
  onUpdate: (code: string, cost: number | undefined, qty: number | undefined) => void;
  onDelete: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState(h.cost != null ? String(h.cost) : "");
  const [qty, setQty] = useState(h.qty != null ? String(h.qty) : "");
  const [err, setErr] = useState("");

  /** 留空=清除该字段(undefined)；数字=值；非法=null */
  const toNum = (s: string): number | null | undefined => {
    if (s.trim() === "") return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const save = () => {
    const c = toNum(cost);
    const q = toNum(qty);
    if (c === null || q === null) {
      setErr("成本与数量请填数字（留空表示未录入）");
      return;
    }
    onUpdate(h.code, c, q);
    setEditing(false);
    setErr("");
  };

  const cancel = () => {
    setCost(h.cost != null ? String(h.cost) : "");
    setQty(h.qty != null ? String(h.qty) : "");
    setEditing(false);
    setErr("");
  };

  return (
    <li className="rounded-btn border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="fr-body font-bold">
          {h.name}
          <span className="fr-sub ml-2 font-normal text-muted-foreground">{h.code}</span>
        </span>
        {editing ? (
          <>
            <label className="flex items-center gap-2">
              <span className="fr-sub text-muted-foreground">成本(元)</span>
              <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal"
                aria-label={`${h.name} 成本价`} className={`${HOLDING_INPUT} w-40`} />
            </label>
            <label className="flex items-center gap-2">
              <span className="fr-sub text-muted-foreground">数量(股)</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal"
                aria-label={`${h.name} 数量`} className={`${HOLDING_INPUT} w-40`} />
            </label>
            <button type="button" onClick={save}
              className="fr-btn-h fr-tap fr-body rounded-btn bg-primary px-5 font-bold text-primary-foreground hover:opacity-90">保存</button>
            <button type="button" onClick={cancel}
              className="fr-btn-h fr-tap fr-body rounded-btn border border-border bg-card px-4 font-bold text-muted-foreground hover:border-primary/50">取消</button>
          </>
        ) : (
          <>
            <span className="fr-body font-bold">成本 {h.cost != null ? `¥${h.cost.toFixed(2)}` : "—"}</span>
            <span className="fr-body font-bold">数量 {h.qty != null ? `${h.qty}股` : "—"}</span>
            <button type="button" onClick={() => { setCost(h.cost != null ? String(h.cost) : ""); setQty(h.qty != null ? String(h.qty) : ""); setEditing(true); }}
              className="fr-btn-h fr-tap fr-body rounded-btn border border-border bg-card px-5 font-bold text-primary hover:border-primary/50">编辑</button>
          </>
        )}
        <button type="button" onClick={() => onDelete(h.code)}
          className="fr-btn-h fr-tap fr-body ml-auto inline-flex items-center gap-1.5 rounded-btn border border-border bg-card px-4 font-bold text-destructive hover:border-destructive/50">
          <Trash2 className="h-6 w-6" aria-hidden="true" /> 删除
        </button>
      </div>
      {err && <p role="alert" className="fr-sub mt-1 font-bold text-destructive">{err}</p>}
    </li>
  );
}

/** 设置页「持仓管理」区：列表 + 添加 + 编辑成本/数量 + 删除（写 localStorage，全局生效）。 */
function HoldingsManagePanel() {
  const holdings = useHoldings();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState("");

  const say = (ok: string) => { setMsg(ok); setMsgErr(""); };
  const oops = (bad: string) => { setMsg(""); setMsgErr(bad); };

  const lookupName = async () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { oops("请输入 6 位 A 股代码再查名称"); return; }
    setLookingUp(true); setMsg(""); setMsgErr("");
    try {
      const n = await resolveHoldingName(c);
      if (n) { setName(n); say(`已查到名称：${n}`); }
      else { oops("没查到名称，请在「名称」框手动填写（必填）"); }
    } catch {
      oops("查名称失败，请在「名称」框手动填写（必填）");
    } finally {
      setLookingUp(false);
    }
  };

  const add = () => {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) { oops("请输入 6 位 A 股代码"); return; }
    if (loadHoldings().some((h) => h.code === c)) { oops("该代码已在持仓清单里"); return; }
    const nm = name.trim();
    if (!nm) { oops("请填写股票名称（查不到时手动填写）"); return; }
    const costN = cost.trim() === "" ? undefined : Number(cost);
    const qtyN = qty.trim() === "" ? undefined : Number(qty);
    if (costN !== undefined && !Number.isFinite(costN)) { oops("成本价请填数字"); return; }
    if (qtyN !== undefined && !Number.isFinite(qtyN)) { oops("数量请填数字"); return; }
    const next: FrHolding = { code: c, name: nm };
    if (costN !== undefined) next.cost = costN;
    if (qtyN !== undefined) next.qty = qtyN;
    saveHoldings([...loadHoldings(), next]);
    setCode(""); setName(""); setCost(""); setQty("");
    say(`已添加 ${nm}（${c}）`);
  };

  const update = (c: string, newCost: number | undefined, newQty: number | undefined) => {
    saveHoldings(loadHoldings().map((h) => {
      if (h.code !== c) return h;
      const next: FrHolding = { code: h.code, name: h.name };
      if (newCost !== undefined) next.cost = newCost;
      if (newQty !== undefined) next.qty = newQty;
      return next;
    }));
  };

  const remove = (c: string) => {
    saveHoldings(loadHoldings().filter((h) => h.code !== c));
  };

  return (
    <div>
      <p className="fr-body mb-3 text-muted-foreground">
        这里录入的持仓会全局生效：首页持仓行、持仓页盈亏、个股页「●我的持仓」标记都读它。
      </p>

      {holdings.length === 0 ? (
        <p className="fr-body rounded-btn border border-dashed border-border bg-muted/40 px-4 py-4 text-muted-foreground">暂无持仓，请在下方添加。</p>
      ) : (
        <ul className="space-y-2">
          {holdings.map((h) => (
            <HoldingRow key={h.code} h={h} onUpdate={update} onDelete={remove} />
          ))}
        </ul>
      )}

      {/* 添加持仓表单 */}
      <div className="mt-4 rounded-btn border border-border bg-muted/40 p-4">
        <div className="fr-body mb-2 font-bold">添加持仓</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="fr-body block font-bold">
            代码
            <input value={code} onChange={(e) => { setCode(e.target.value.trim()); say(""); }}
              onBlur={() => { if (/^\d{6}$/.test(code.trim()) && !name.trim()) void lookupName(); }}
              placeholder="6 位代码，如 600183" inputMode="numeric" maxLength={6}
              className={`${HOLDING_INPUT} block w-44`} />
          </label>
          <button type="button" onClick={() => void lookupName()} disabled={lookingUp}
            className="fr-btn-h fr-tap fr-body inline-flex items-center gap-2 rounded-btn border border-border bg-card px-5 font-bold text-primary hover:border-primary/50 disabled:opacity-60">
            {lookingUp && <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />}
            {lookingUp ? "查名称中…" : "自动带出名称"}
          </button>
          <label className="fr-body block font-bold">
            名称
            <input value={name} onChange={(e) => { setName(e.target.value); say(""); }}
              placeholder="查不到就手填" className={`${HOLDING_INPUT} block w-56`} />
          </label>
          <label className="fr-body block font-bold">
            成本价（元）
            <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="可选" inputMode="decimal"
              className={`${HOLDING_INPUT} block w-40`} />
          </label>
          <label className="fr-body block font-bold">
            数量（股）
            <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="可选" inputMode="decimal"
              className={`${HOLDING_INPUT} block w-40`} />
          </label>
          <button type="button" onClick={add}
            className="fr-btn-h fr-tap fr-body rounded-btn bg-primary px-8 font-bold text-primary-foreground hover:opacity-90">
            保存
          </button>
        </div>
        {msgErr && <p role="alert" className="fr-body mt-2 rounded-btn border border-destructive/40 bg-destructive/10 px-4 py-2 font-bold text-destructive">{msgErr}</p>}
        {msg && <p role="status" className="fr-body mt-2 rounded-btn border border-success/40 bg-success/10 px-4 py-2 font-bold text-success">{msg}</p>}
      </div>
    </div>
  );
}

export function FundradarSettings() {
  const [tier, setTier] = useState<FontTier>(loadFontTier);
  // 双向同步：侧栏改档 → applyFontTier 派发 fr-font-tier-changed → 本页高亮跟上（反之亦然）
  useEffect(() => {
    const onTierChanged = (e: Event) => {
      const detail = (e as CustomEvent<FontTier>).detail;
      if (FONT_TIERS.some((t) => t.key === detail)) setTier((cur) => (cur === detail ? cur : detail));
    };
    window.addEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
    return () => window.removeEventListener(FR_FONT_TIER_CHANGED, onTierChanged);
  }, []);
  const { dark, toggle } = useDarkMode();
  // 示例控件状态（刀4 落库）
  const [remind, setRemind] = useState(true);
  const [remindLimit, setRemindLimit] = useState(true);
  const [remindLhb, setRemindLhb] = useState(false);
  const [speed, setSpeed] = useState<"0.8" | "1.0" | "1.2">("1.0");
  // 数据更新组：盘中自动刷新状态（由 AutoRefresh 模块每秒派发状态事件驱动）
  const autoStatus = useAutoRefreshStatus();
  const [updating, setUpdating] = useState(false);
  const manualUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      await updateAllFrData(); // 与首页指示器 / 侧栏入口同一入口
    } finally {
      setUpdating(false);
    }
  };
  const savedLlm = loadUserLlm();

  useAiPage({
    key: "fundradar-settings",
    title: "资金雷达 · 设置",
    // 🔴 只放供应商名与模型名，绝不放 Key / 地址（这段 context 会随提问发出去）
    context:
      "资金雷达设置页（示例控件）：字号四档、深浅模式可用；持仓/板块/晨报/提醒/AI 接入为刀4 落库项。" +
      `AI 接入：${savedLlm ? `已保存供应商 ${savedLlm.provider} / 模型 ${savedLlm.model}（真实测试通过才保存，本页不显示 Key）。` : "尚未测试连接（面板含供应商/地址/模型/Key，真实测试成功才保存）。"}`,
    suggestions: [...FR_SUGGESTIONS, "AI 接入怎么测试和保存"],
  });

  return (
    <div data-fr-page="fundradar-settings" className="fr-elder-page p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <h1 className="fr-title mb-5 flex items-center gap-2 font-bold"><Settings className="h-7 w-7 text-primary" aria-hidden="true" />设置</h1>

        {/* 字号档位（可用） */}
        <Group icon={Type} title="字号档位（加大为默认）">
          <div className="flex flex-wrap gap-2" role="group" aria-label="字号档位">
            {FONT_TIERS.map((t) => (
              <button key={t.key} type="button" aria-pressed={tier === t.key}
                onClick={() => { saveFontTier(t.key); setTier(t.key); }}
                className={`fr-btn-h fr-tap rounded-btn border px-8 font-bold transition-colors ${tier === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50"}`}>
                {t.label}
                <span className="fr-sub block font-normal opacity-80">{FR_TIER_NUM[t.key]}</span>
              </button>
            ))}
          </div>
          <p className="fr-sub mt-2 text-muted-foreground">切换立即生效，全局所有页面同步；紧凑档字号最小（数字 24px），最小点击区恒为 48×48。</p>
        </Group>

        {/* 深浅模式（可用） */}
        <Group icon={SunMoon} title="深浅模式">
          <button type="button" onClick={toggle}
            className="fr-btn-h fr-tap flex items-center gap-3 rounded-btn border border-border bg-card px-6 font-bold hover:border-primary/50">
            {dark ? <Sun className="h-7 w-7 text-primary" /> : <Moon className="h-7 w-7 text-primary" />}
            {dark ? "当前：深色 · 点击切换为浅色" : "当前：浅色 · 点击切换为深色"}
          </button>
          <p className="fr-sub mt-2 text-muted-foreground">主线雷达/盘后复盘/Agent 对话为深色大屏，不受此开关影响（选型 v0.1 §4）。</p>
        </Group>

        {/* 持仓管理（增删改，全局生效） */}
        <Group icon={Wallet} title="持仓管理">
          <HoldingsManagePanel />
        </Group>

        {/* 关注板块 */}
        <Group icon={Tag} title="关注板块">
          <p className="fr-body mb-2 text-muted-foreground">默认科技链 10 板块（可增删，刀4 落库）：</p>
          <div className="flex flex-wrap gap-2">
            {FR_DEFAULT_SECTORS.map((s) => (
              <span key={s} className="fr-sub rounded-btn border border-border bg-muted px-3 py-1.5">{s}</span>
            ))}
          </div>
          <button type="button" className="fr-sub fr-tap mt-3 rounded-btn border border-primary/30 px-4 py-2 font-bold text-primary hover:bg-primary-100">
            一键恢复默认组
          </button>
        </Group>

        {/* 晨报与免打扰 */}
        <Group icon={BellOff} title="晨报与免打扰">
          <p className="fr-body">晨报时间：<b>08:30</b> 自动生成 + 朗读（精简版约 1 分钟）</p>
          <p className="fr-body">免打扰时段：<b>12:30 - 13:30</b> 不自动朗读，可手动点播</p>
          <p className="fr-sub mt-1 text-muted-foreground">非交易日不生成晨报（按交易日历，刀4 接入）</p>
        </Group>

        {/* 语速与音量 */}
        <Group icon={Volume2} title="语速与音量">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="语速">
            {(["0.8", "1.0", "1.2"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}
                className={`fr-tap rounded-btn border px-4 font-bold ${speed === v ? "border-primary bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
                {v}×
              </button>
            ))}
            <label className="fr-sub flex items-center gap-2">
              音量
              <input type="range" min={0} max={100} defaultValue={70} aria-label="音量" className="w-40 accent-primary" />
            </label>
          </div>
        </Group>

        {/* 提醒开关与阈值 */}
        <Group icon={Bell} title="提醒开关与阈值">
          <div className="grid gap-2">
            <DemoSwitch label="涨跌提醒（默认阈值 ±5%）" on={remind} onToggle={() => setRemind(!remind)} />
            <DemoSwitch label="炸板 / 放量（量比>3）提醒" on={remindLimit} onToggle={() => setRemindLimit(!remindLimit)} />
            <DemoSwitch label="龙虎榜上榜提醒" on={remindLhb} onToggle={() => setRemindLhb(!remindLhb)} />
          </div>
          <p className="fr-sub mt-2 text-muted-foreground">
            去重：单股单类每天最多 1 次、大盘类每天最多 3 次；[今日免打扰] 一键静音当天（刀4 落库）。
          </p>
        </Group>

        {/* 快捷键 */}
        <Group icon={Keyboard} title="快捷键">
          <p className="fr-body"><b>F2</b> 唤起语音问答 · <b>Esc</b> 停止朗读（可自定义修改，也可完全用屏幕按钮替代）</p>
        </Group>

        {/* AI 设置组：完整接入面板（供应商/地址/模型/Key/真实测试并保存） */}
        <Group icon={Bot} title="AI 接入">
          <p className="fr-sub mb-3 text-muted-foreground">
            DeepSeek 为预充值制，建议小额充值（如 20 元）防失控；API Key 只存本机浏览器。
          </p>
          <AiConnectPanel />
        </Group>

        {/* 数据更新 */}
        <Group icon={RefreshCw} title="数据更新">
          <div className="space-y-4">
            <button type="button" onClick={() => void manualUpdate()} disabled={updating}
              className="fr-btn-h fr-tap inline-flex items-center gap-2 rounded-btn border border-border bg-card px-6 font-bold hover:border-primary/50 disabled:cursor-wait disabled:opacity-60">
              {updating && <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />}
              {updating ? "正在更新…" : "立即更新数据"}
            </button>

            <div className="flex items-center justify-between gap-3">
              <DemoSwitch label="盘中自动刷新" on={autoStatus.enabled}
                onToggle={() => saveAutoRefreshEnabled(!autoStatus.enabled)} />
            </div>

            <div role="radiogroup" aria-label="自动刷新间隔" className="flex flex-wrap items-center gap-2">
              <span className="fr-sub font-bold text-muted-foreground">间隔：</span>
              {FR_AUTO_INTERVAL_OPTIONS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={autoStatus.intervalMin === m}
                  onClick={() => saveAutoRefreshInterval(m)}
                  className={`fr-tap rounded-btn border px-4 py-1.5 font-bold ${autoStatus.intervalMin === m ? "border-primary bg-primary-subtle-strong text-primary" : "border-border text-muted-foreground"}`}>
                  {m} 分钟
                </button>
              ))}
            </div>

            <p className="fr-sub text-muted-foreground">
              上次更新：{frLastRefreshLabel(autoStatus.lastRefreshAt)}
              {frCountdownLabel(autoStatus.nextTickAt, autoStatus.enabled)
                ? ` · 下次自动刷新 ${frCountdownLabel(autoStatus.nextTickAt, autoStatus.enabled)}`
                : ""}
            </p>
            <p className="fr-sub text-muted-foreground">
              盘中每 {autoStatus.intervalMin} 分钟自动刷新实时类数据（行情 / 分钟资金流 / 涨停池 / 炸板池 / 情绪）；
              盘后 15:30 后自动跑一次完整盘后批（龙虎榜 / 全球要闻等），当天只跑一次；标签页切到后台时暂停。
            </p>
          </div>
        </Group>

        {/* 软件更新（electron-updater · GitHub Releases，未签名） */}
        <Group icon={Download} title="软件更新">
          <p className="fr-sub mb-3 text-muted-foreground">
            应用启动后会自动检查 GitHub Releases 是否有新版本；发现新版本时先提示，由你确认后再下载安装。
          </p>
          <FrAppUpdate />
        </Group>

        <p className="fr-sub mt-4 leading-relaxed text-muted-foreground/80">{FR_DISCLAIMER}</p>
      </div>
    </div>
  );
}
