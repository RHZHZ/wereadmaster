import type { AiProviderPresetId, AiResponseFormatPolicy } from "./types";

export type AiProviderPreset = {
  id: AiProviderPresetId;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  responseFormatPolicy: AiResponseFormatPolicy;
};

export type AiResponseFormatPolicyOption = {
  value: AiResponseFormatPolicy;
  label: string;
  description: string;
};

export const DEFAULT_AI_PROVIDER_PRESET_ID: AiProviderPresetId = "openai";
export const DEFAULT_AI_RESPONSE_FORMAT_POLICY: AiResponseFormatPolicy =
  "jsonSchemaFirst";

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "官方 OpenAI API",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    responseFormatPolicy: "jsonSchemaFirst",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek OpenAI 兼容接口",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    responseFormatPolicy: "noResponseFormatFirst",
  },
  {
    id: "dashscope",
    label: "通义千问",
    description: "DashScope OpenAI 兼容模式",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    responseFormatPolicy: "jsonObjectFirst",
  },
  {
    id: "moonshot",
    label: "Kimi",
    description: "Moonshot OpenAI 兼容接口",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    responseFormatPolicy: "jsonObjectFirst",
  },
  {
    id: "r-api",
    label: "R-API",
    description: "R-API 中转站",
    defaultBaseUrl: "https://api.cccc.asia",
    defaultModel: "gpt-4o-mini",
    responseFormatPolicy: "auto",
  },
  {
    id: "custom",
    label: "自定义",
    description: "自定义 OpenAI-compatible Provider",
    defaultBaseUrl: "",
    defaultModel: "",
    responseFormatPolicy: "auto",
  },
];

export const AI_RESPONSE_FORMAT_POLICY_OPTIONS: AiResponseFormatPolicyOption[] = [
  {
    value: "auto",
    label: "自动兼容",
    description: "由应用自动选择更合适的输出方式。",
  },
  {
    value: "jsonSchemaFirst",
    label: "严格结构化",
    description: "适合完整支持结构化输出的模型。",
  },
  {
    value: "jsonObjectFirst",
    label: "通用 JSON",
    description: "适合部分兼容结构化输出的模型。",
  },
  {
    value: "noResponseFormatFirst",
    label: "宽松兼容",
    description: "适合提示不支持结构化输出参数的模型。",
  },
];

const AI_PROVIDER_PRESET_IDS = new Set<AiProviderPresetId>(
  AI_PROVIDER_PRESETS.map((preset) => preset.id),
);
const AI_RESPONSE_FORMAT_POLICIES = new Set<AiResponseFormatPolicy>(
  AI_RESPONSE_FORMAT_POLICY_OPTIONS.map((option) => option.value),
);

export function normalizeAiProviderPresetId(
  value?: string,
): AiProviderPresetId {
  return AI_PROVIDER_PRESET_IDS.has(value as AiProviderPresetId)
    ? (value as AiProviderPresetId)
    : "custom";
}

export function normalizeAiResponseFormatPolicy(
  value?: string,
): AiResponseFormatPolicy {
  return AI_RESPONSE_FORMAT_POLICIES.has(value as AiResponseFormatPolicy)
    ? (value as AiResponseFormatPolicy)
    : "auto";
}

export function getAiProviderPreset(
  id: AiProviderPresetId,
): AiProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    AI_PROVIDER_PRESETS[0]
  );
}
