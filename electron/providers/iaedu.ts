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
   * Parser do stream NDJSON do iaedu (uma linha JSON por evento, sem prefixo
   * "data:"). Eventos observados na API real:
   *   {"type":"start",  "content":"Processing"}
   *   {"type":"token",  "content":"texto delta"}   ← delta de resposta
   *   {"type":"message","content":{...objeto...}}  ← mensagem final (ignorado;
   *                                    os tokens já transmitiram o texto)
   *   {"type":"done",   ...}
   */
  parseStreamChunk(_provider: ProviderConfig, raw: string): ProviderStreamEvent[] {
    const line = raw.trim();
    if (!line) return [];
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload) return [];

    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      const type = typeof json.type === "string" ? json.type : "";

      if (type === "done") return [{ type: "done" }];
      if (type === "token") {
        const text = json.content;
        return typeof text === "string" && text.length
          ? [{ type: "text", delta: text }]
          : [];
      }
      // "start", "message" e outros metadados: ignorados (texto já veio nos tokens)
      return [];
    } catch {
      // Linha não-JSON: ignora (robustez contra comentários/ruído)
      return [];
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
