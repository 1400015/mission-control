/**
 * providers/types.ts
 * ----------------------------------------------------------------------------
 * Contrato que TODOS os adapters de provedores têm de cumprir.
 *
 * Um adapter sabe:
 *  1. autenticar (injetar a chave nos headers corretos);
 *  2. traduzir o "formato interno" (mensagens + reasoning) para o formato
 *     específico da API do provedor;
 *  3. fazer streaming da resposta de volta para o formato interno normalizado
 *     (ProviderStreamEvent), independentemente de a API usar SSE, NDJSON, etc.
 */
import type {
  ChatMessage,
  ProviderConfig,
  ProviderStreamEvent,
  ReasoningLevel,
  ToolDefinition,
} from "../../shared/types";

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  reasoning: ReasoningLevel;
  /** Ferramentas disponíveis para o modelo chamar (agente com ferramentas). */
  tools?: ToolDefinition[];
}

export interface ProviderAdapter {
  /** Cabeçalhos HTTP de autenticação + extras (usados por TODOS os pedidos). */
  buildHeaders(provider: ProviderConfig, apiKey: string): Record<string, string>;

  /** URL completo do endpoint de chat completions (inclui o modelo). */
  chatEndpoint(provider: ProviderConfig, modelId: string): string;

  /**
   * Corpo do pedido já no formato da API. O adapter decide onde encaixar o
   * nível de raciocínio (thinkingBudget, reasoning_effort, ...).
   */
  buildBody(
    provider: ProviderConfig,
    request: ChatRequest,
    options: { stream: boolean }
  ): Record<string, unknown>;

  /**
   * Analisa uma linha/chunk de streaming e converte para eventos normalizados.
   * Devolve [] quando o chunk não contém nada relevante (ex.: comentários SSE).
   */
  parseStreamChunk(
    provider: ProviderConfig,
    raw: string
  ): ProviderStreamEvent[];

  /** Lista modelos disponíveis (usado pela UI de configuração). */
  listModels(provider: ProviderConfig, apiKey: string): Promise<ModelInfo[]>;
}

import type { ModelInfo } from "../../shared/types";
