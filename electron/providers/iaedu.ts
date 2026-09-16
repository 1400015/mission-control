/**
 * providers/iaedu.ts
 * ----------------------------------------------------------------------------
 * Adapter para a API de chatbots do iaedu (api.iaedu.pt).
 *
 * Características deste formato (diferente de OpenAI e Google):
 *  - autenticação por header `x-api-key` (não Bearer);
 *  - pedido em multipart/form-data com os campos:
 *      channel_id  → canal do chatbot (configuração do provedor)
 *      thread_id   → conversa (usamos o id do run, estável por agente)
 *      user_info   → "{}" (obrigatório; metadados do utilizador)
 *      message     → a mensagem a enviar
 *  - endpoint: {base}/agent-chat/api/v1/agent/{agentId}/stream
 *  - o histórico/conteúdo é gerido pelo lado do iaedu (via thread_id), por
 *    isso enviamos apenas a última mensagem do utilizador.
 *
 * O stream de resposta é interpretado de forma tolerante: sequiser json,
 * são extraídos campos comuns; caso contrário o texto é passado "in raw".
 */
import type { ChatRequest, ProviderAdapter } from "./types";
import type { ModelInfo, ProviderConfig, ProviderStreamEvent } from "../../shared/types";

export const iaeduAdapter: ProviderAdapter = {
  usesFormData: true,

  buildHeaders(_provider: ProviderConfig, apiKey: string) {
    // NOTA: sem Content-Type — o fetch define o boundary do multipart
    return { "x-api-key": apiKey };
  },

  chatEndpoint(provider: ProviderConfig, _modelId: string) {
    const base = (provider.baseUrl || "https://api.iaedu.pt").replace(/\/+$/, "");
    const agentId = provider.iaeduAgentId ?? _modelId;
    return `${base}/agent-chat/api/v1/agent/${agentId}/stream`;
  },

  buildFormData(provider: ProviderConfig, request: ChatRequest, formData: FormData) {
    formData.append("channel_id", provider.iaeduChannelId ?? "");
    // thread_id estável → o iaedu mantém a memória da conversa por agente
    formData.append("thread_id", request.sessionKey ?? `mc-${Date.now()}`);
    formData.append("user_info", "{}");
    // Envia a última mensagem do utilizador (o histórico vive no iaedu)
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    formData.append("message", lastUser?.content ?? "");
  },

  /**
   * Parser tolerante: o iaedu pode enviar SSE, NDJSON ou texto simples.
   * Estratégia:
   *  - linhas "data: ..." → tenta JSON e extrai campos de texto comuns;
   *  - linhas JSON soltas → idem;
   *  - resto → emite como texto bruto (para o utilizador ver o stream real).
   */
  parseStreamChunk(_provider: ProviderConfig, raw: string): ProviderStreamEvent[] {
    const line = raw.trim();
    if (!line) return [];
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]") return payload === "[DONE]" ? [{ type: "done" }] : [];

    // Tenta interpretar como JSON e extrair texto de campos conhecidos
    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      const text =
        pickString(json, ["content", "text", "token", "delta", "message", "response", "answer", "output"]) ??
        pickNestedChoice(json);
      if (text) return [{ type: "text", delta: text }];
      // JSON sem texto reconhecível: ignora (pode ser metadado)
      return [];
    } catch {
      // Texto simples → emite diretamente
      if (payload.startsWith("{") || payload.startsWith("<")) return [];
      return [{ type: "text", delta: payload }];
    }
  },

  async listModels(provider: ProviderConfig, _apiKey: string): Promise<ModelInfo[]> {
    // O "modelo" é o próprio agente iaedu configurado
    return [
      {
        id: provider.iaeduAgentId ?? "iaedu-agent",
        label: `Agente iaedu (${provider.iaeduAgentId ?? "?"})`,
        supportsReasoning: false,
      },
    ];
  },
};

/** Procura a primeira propriedade string existente num objeto (por ordem). */
function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

/** Cobre respostas tipo OpenAI aninhadas (choices[0].delta/message.content). */
function pickNestedChoice(json: Record<string, unknown>): string | undefined {
  const choices = json.choices as Record<string, unknown>[] | undefined;
  const first = choices?.[0];
  if (!first) return undefined;
  const delta = (first.delta ?? first.message) as Record<string, unknown> | undefined;
  const content = delta?.content ?? first.text;
  return typeof content === "string" && content.length ? content : undefined;
}
