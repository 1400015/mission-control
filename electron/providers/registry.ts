/**
 * providers/registry.ts
 * ----------------------------------------------------------------------------
 * Registo de adapters e "presets" dos provedores conhecidos.
 *
 * - ADAPTERS liga cada ProviderKind ao código que fala com a API.
 * - PROVIDER_PRESETS são modelos de configuração usados pela UI de Settings:
 *   o utilizador escolhe um preset, insere a chave de API e fica configurado.
 * - Provedores "custom" usam kind "openai-compatible" por defeito (a esmagadora
 *   maioria das APIs do mercado fala esse formato).
 */
import type { ModelInfo, ProviderConfig } from "../../shared/types";
import { googleAdapter } from "./google";
import { openAICompatibleAdapter } from "./openaiCompatible";
import type { ProviderAdapter } from "./types";

/** Escolhe o adapter consoante o formato de API do provedor. */
export function adapterFor(provider: ProviderConfig): ProviderAdapter {
  return provider.kind === "google" ? googleAdapter : openAICompatibleAdapter;
}

export interface ProviderPreset {
  key: string;           // identificador do preset na UI
  name: string;
  kind: "google" | "openai-compatible";
  baseUrl: string;
  reasoningParam: ProviderConfig["reasoningParam"];
  extraHeaders?: Record<string, string>;
  /** Sugestões iniciais de modelos (editáveis; também pode buscar via /models). */
  suggestedModels: ModelInfo[];
  hint: string;          // dica mostrada ao utilizador sobre onde obter a chave
}

/** Presets dos provedores suportados "out of the box". */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "google-ai-studio",
    name: "Google AI Studio",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    reasoningParam: "google-thinkingBudget",
    suggestedModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", supportsReasoning: true },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", supportsReasoning: true },
    ],
    hint: "Chave em aistudio.google.com/apikey",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoningParam: "openrouter-reasoning",
    extraHeaders: { "HTTP-Referer": "https://github.com/1400015/mission-control", "X-Title": "Mission Control" },
    suggestedModels: [
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)", supportsReasoning: true },
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (via OpenRouter)", supportsReasoning: true },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS-120B (via OpenRouter)", supportsReasoning: true },
    ],
    hint: "Chave em openrouter.ai/keys",
  },
  {
    key: "groq",
    name: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    reasoningParam: "reasoning_effort",
    suggestedModels: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS-120B", supportsReasoning: true },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", supportsReasoning: false },
    ],
    hint: "Chave em console.groq.com/keys",
  },
  {
    key: "venice",
    name: "Venice",
    kind: "openai-compatible",
    baseUrl: "https://api.venice.ai/api/v1",
    reasoningParam: "reasoning_effort",
    suggestedModels: [
      { id: "qwen-2.5-qwq-32b", label: "Qwen QwQ 32B (raciocínio)", supportsReasoning: true },
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", supportsReasoning: false },
    ],
    hint: "Chave em venice.ai/settings/api",
  },
  {
    key: "alibaba",
    name: "Alibaba (DashScope)",
    kind: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    reasoningParam: "alibaba-enable_thinking",
    suggestedModels: [
      { id: "qwen3-235b-a22b", label: "Qwen3 235B A22B", supportsReasoning: true },
      { id: "qwen3-max", label: "Qwen3 Max", supportsReasoning: true },
    ],
    hint: "Chave em dashscope.console.aliyun.com (International/China)",
  },
  // Preset vazio para provedores personalizados (endpoint + chave definidos pelo utilizador)
  {
    key: "custom",
    name: "Outro (endpoint personalizado)",
    kind: "openai-compatible",
    baseUrl: "",
    reasoningParam: "custom",
    suggestedModels: [],
    hint: "Indique o endpoint base (ex.: https://meu-servidor/v1) e a chave de API",
  },
];
