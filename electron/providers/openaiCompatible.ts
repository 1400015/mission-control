/**
 * providers/openaiCompatible.ts
 * ----------------------------------------------------------------------------
 * Adapter único para TODOS os provedores que falam o formato OpenAI
 * (chat/completions com streaming SSE):
 *   OpenRouter, Groq, Venice, Alibaba DashScope (modo compatível) e qualquer
 *   endpoint customizado que o utilizador configurar.
 *
 * Diferenças entre eles (autenticação e raciocínio) ficam nas definições do
 * provider em registry.ts, e o mapping de raciocínio em reasoning.ts.
 */
import type { ModelInfo } from "../../shared/types";
import type { ChatRequest, ProviderAdapter } from "./types";
import type { ProviderConfig, ProviderStreamEvent, ToolDefinition } from "../../shared/types";
import { reasoningBody } from "./reasoning";

/**
 * Converte as mensagens internas para o formato OpenAI.
 *  - mensagens "tool" viram role:"tool" com tool_call_id;
 *  - toolCalls do assistente viram "tool_calls".
 */
function toOpenAIMessages(request: ChatRequest): Record<string, unknown>[] {
  return request.messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Converte definições de ferramentas para o schema "functions" da OpenAI. */
function toOpenAITools(tools?: ToolDefinition[]): Record<string, unknown>[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export const openAICompatibleAdapter: ProviderAdapter = {
  buildHeaders(provider: ProviderConfig, apiKey: string) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(provider.extraHeaders ?? {}),
    };
  },

  chatEndpoint(provider: ProviderConfig, modelId: string) {
    // Normaliza: remove "/" final e acrescenta o caminho padrão de chat
    const base = provider.baseUrl.replace(/\/+$/, "");
    return `${base}/chat/completions`;
  },

  buildBody(provider: ProviderConfig, request: ChatRequest, options: { stream: boolean }) {
    const body: Record<string, unknown> = {
      model: request.modelId,
      messages: toOpenAIMessages(request),
      stream: options.stream,
      tools: toOpenAITools(request.tools),
    };
    // Encaixa o raciocínio conforme o formato do provedor
    Object.assign(
      body,
      reasoningBody(provider.reasoningParam, request.reasoning, {
        customReasoningParam: provider.customReasoningParam,
        customReasoningValues: provider.customReasoningValues,
      })
    );
    return body;
  },

  /**
   * Interpreta uma linha SSE `data: {...}` no formato OpenAI.
   * Extrai: delta de texto, delta de raciocínio (reasoning_content —
   * convenção usada por Groq/OpenRouter/Venice) e tool calls parciais.
   */
  parseStreamChunk(_provider: ProviderConfig, raw: string): ProviderStreamEvent[] {
    const line = raw.trim();
    if (!line.startsWith("data:")) return [];
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return [{ type: "done" }];

    try {
      const json = JSON.parse(payload);
      const choice = json.choices?.[0];
      if (!choice) {
        // Alguns provedores enviam usage final sem choices
        if (json.usage) {
          return [{ type: "done", usage: { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens } }];
        }
        return [];
      }
      const delta = choice.delta ?? {};
      const events: ProviderStreamEvent[] = [];

      if (typeof delta.content === "string" && delta.content.length) {
        events.push({ type: "text", delta: delta.content });
      }
      // "reasoning" (OpenRouter) ou "reasoning_content" (Groq/Venice/DashScope)
      const r = delta.reasoning ?? delta.reasoning_content;
      if (typeof r === "string" && r.length) {
        events.push({ type: "reasoning", delta: r });
      }
      for (const tc of delta.tool_calls ?? []) {
        if (tc.function?.name) {
          events.push({
            type: "tool-call",
            call: { id: tc.id ?? crypto.randomUUID(), name: tc.function.name, arguments: tc.function.arguments ?? "" },
          });
        } else if (tc.function?.arguments) {
          // Continuação dos argumentos de uma chamada anterior
          events.push({ type: "tool-call", call: { id: tc.id ?? "", name: "", arguments: tc.function.arguments } });
        }
      }
      return events;
    } catch {
      return []; // linhas mal formadas são ignoradas silenciosamente
    }
  },

  async listModels(provider: ProviderConfig, apiKey: string): Promise<ModelInfo[]> {
    const base = provider.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/models`, {
      headers: this.buildHeaders(provider, apiKey),
    });
    if (!res.ok) throw new Error(`Erro ${res.status} ao listar modelos: ${await res.text()}`);
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      label: m.id,
      supportsReasoning: true, // por defeito; o utilizador pode ajustar na UI
    }));
  },
};
