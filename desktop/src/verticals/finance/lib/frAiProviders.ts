/**
 * 资金雷达工作台 · 设置页 AI 供应商清单（刀4）。
 *
 * 数据来源：底座仓库 `providers/*.json` 模板。base_url / env_key / default_model 逐字段取用，
 * **不在前端再抄一份** —— 抄的第二份迟早与模板对不上（与 ai-models.ts 里那条纪律同款）。
 * 这里只补模板里没有的东西：UI 文案（中文标签、说明），以及模板字段为 null 时的兜底建议值。
 *
 * 🔴 模板存在 ≠ 已实测：本清单不声称任何一家跑过兼容矩阵（矩阵状态由后端
 *    `/product` 的 provider_templates 下发，本页不打「已实测」标）。
 * ⚠️ Key 变量名只用于展示「密钥从哪个变量名注入」，从不展示任何值。
 */
import deepseekTemplate from "../../../../../providers/deepseek.json";
import glmTemplate from "../../../../../providers/glm.json";
import kimiTemplate from "../../../../../providers/kimi.json";
import openaiTemplate from "../../../../../providers/openai.json";
import qwenTemplate from "../../../../../providers/qwen.json";
import selfhostedTemplate from "../../../../../providers/selfhosted.json";
import { API_MODELS } from "./ai-models.ts";

interface ProviderTemplateShape {
  id?: string;
  base_url?: string | null;
  env_key?: string;
  default_model?: string | null;
}

const asTemplate = (t: unknown): ProviderTemplateShape => (t ?? {}) as ProviderTemplateShape;

/** OpenAI 模板 base_url / default_model 为 null（官方默认由引擎决定），面板给一个常见默认值方便填写 */
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o";

export interface FrAiProvider {
  /** 传给底座 runtime_provider 的 provider id（providers/ 目录里的模板 id） */
  id: string;
  label: string;
  desc: string;
  /** 选中后自动填入 API 地址框；模板里的 {…} 占位符原样保留，用户必须替换 */
  baseUrl: string;
  /** 选中后自动填入模型框；空 = 需要用户自己填 */
  defaultModel: string;
  /** 模板声明的密钥环境变量名（只显示名字，从不显示值） */
  envKey: string;
  /** API 地址里是否还带着必须替换的 {…} 占位符 */
  placeholder: boolean;
}

const build = (
  template: unknown,
  label: string,
  desc: string,
  fallbackBase: string,
  fallbackModel: string,
): FrAiProvider => {
  const t = asTemplate(template);
  const baseUrl = t.base_url?.trim() || fallbackBase;
  const defaultModel = t.default_model?.trim() || fallbackModel;
  return {
    id: t.id ?? label,
    label,
    desc,
    baseUrl,
    defaultModel,
    envKey: t.env_key ?? "",
    placeholder: /[{<][A-Za-z_]/.test(baseUrl),
  };
};

export const FR_AI_PROVIDERS: FrAiProvider[] = [
  build(deepseekTemplate, "DeepSeek", "官方 Responses API；预充值制，建议小额充值", "", "deepseek-flash"),
  build(openaiTemplate, "OpenAI", "官方 API，GPT 系列", OPENAI_DEFAULT_BASE, OPENAI_DEFAULT_MODEL),
  build(qwenTemplate, "通义千问", "阿里云百炼托管；地址里要换成自己的工作空间 ID", "", "qwen3.8-max"),
  build(glmTemplate, "智谱 GLM", "经阿里云百炼托管；地址里要换成自己的工作空间 ID", "", "glm-5.2"),
  build(kimiTemplate, "Kimi", "经阿里云百炼托管；地址里要换成自己的工作空间 ID", "", "kimi-k2.7-code"),
  build(selfhostedTemplate, "自托管", "本机 / 局域网模型（如 Ollama），需兼容 Responses", "", ""),
];

export function frProvider(id: string): FrAiProvider | undefined {
  return FR_AI_PROVIDERS.find((p) => p.id === id);
}

/**
 * 模型输入框的建议清单：模板 default_model 排第一，其余来自 `API_MODELS`
 * （清单里的模型名都是模板 default_model 或开源版真实用户在用的，不凭印象编）。
 */
export function frModelSuggestions(providerId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (m: string | undefined | null): void => {
    if (m && !seen.has(m)) { seen.add(m); out.push(m); }
  };
  push(frProvider(providerId)?.defaultModel);
  for (const m of API_MODELS) {
    if (m.provider === providerId) push(m.id);
  }
  return out;
}
