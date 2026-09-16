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
  /**
   * Chave estável de sessão (ex.: id do run) — usada por APIs que gerem a
   * própria memória de conversa via thread/sessão (ex.: iaedu thread_id).
   */
  sessionKey?: string;
}

export interface ProviderAdapter {
  /** Cabeçalhos HTTP de autenticação + extras (usados por TODOS os pedidos). */
  buildHeaders(provider: ProviderConfig, apiKey: string): Record<string, string>;

  /** URL completo do endpoint de chat completions (inclui o modelo). */
  chatEndpoint(provider: ProviderConfig, modelId: string): string;

  /**
   * Quando true, o pedido usa multipart/form-data em vez de JSON.
   * Nesse caso o adapter implementa buildFormData() e o chatService NÃO
   * define Content-Type (o fetch gera o boundary automaticamente).
   */
  usesFormData?: boolean;

  /** Preenche o FormData do pedido (só chamado se usesFormData). */
  buildFormData?(
    provider: ProviderConfig,
    request: ChatRequest,
    formData: FormData
  ): void;

  /**
   * Corpo do pedido já no formato da API. O adapter decide onde encaixar o
   * nível de raciocínio (thinkingBudget, reasoning_effort, ...).
   * (Não usado quando usesFormData === true.)
   */
  buildBody?(
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
