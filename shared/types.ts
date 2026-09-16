/**
 * shared/types.ts
 * ----------------------------------------------------------------------------
 * Tipos partilhados entre o PROCESSO PRINCIPAL (Electron/Node) e o RENDERER
 * (React). Viver aqui garante que ambos os lados falam exatamente a mesma
 * "língua" — o renderer nunca importa código de Node, apenas estes tipos.
 *
 * Domínio da aplicação:
 *  - ProviderConfig : um provedor de LLM configurado (Google, OpenRouter, ...)
 *  - AgentRun       : um agente autónomo a trabalhar sobre um workspace
 *  - ChatMessage    : mensagens trocadas com o modelo
 *  - Artifact       : entregável verificável produzido pelo agente
 */

// ---------------------------------------------------------------------------
// Raciocínio (reasoning)
// ---------------------------------------------------------------------------

/** Níveis de esforço de raciocínio que o utilizador pode escolher por agente. */
export type ReasoningLevel = "off" | "low" | "medium" | "high";

/**
 * Como é que o nível de raciocínio é comunicado a cada provedor.
 * Cada API tem nomes diferentes para a mesma ideia:
 *  - google-thinkingBudget   → Gemini usa `thinkingConfig.thinkingBudget`
 *  - reasoning_effort        → padrão OpenAI (Groq, Venice, custom)
 *  - openrouter-reasoning    → OpenRouter usa `reasoning: { effort }`
 *  - alibaba-enable_thinking → DashScope usa `enable_thinking` (bool)
 *  - custom                  → o utilizador define o nome do parâmetro
 */
export type ReasoningParam =
  | "google-thinkingBudget"
  | "reasoning_effort"
  | "openrouter-reasoning"
  | "alibaba-enable_thinking"
  | "custom"
  | "none";

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

/** Formato de API que o provedor fala. */
export type ProviderKind = "google" | "openai-compatible";

/** Descrição de um modelo oferecido por um provedor. */
export interface ModelInfo {
  /** Identificador do modelo enviado na API (ex.: "gemini-3-pro"). */
  id: string;
  /** Nome amigável mostrado na UI. */
  label: string;
  /** Se o modelo aceita parâmetros de raciocínio. */
  supportsReasoning: boolean;
}

/** Configuração guardada de um provedor de LLM. */
export interface ProviderConfig {
  id: string;
  /** Nome legível (ex.: "OpenRouter"). */
  name: string;
  kind: ProviderKind;
  /** URL base da API (ex.: https://api.groq.com/openai/v1). */
  baseUrl: string;
  /**
   * Referência (não o valor!) da chave de API no cofre do sistema operativo.
   * As chaves nunca circulam no renderer nem são guardadas em texto simples.
   */
  apiKeyRef: string;
  /** Headers extra opcionais (ex.: HTTP-Referer do OpenRouter). */
  extraHeaders?: Record<string, string>;
  /** Como este provedor recebe o nível de raciocínio. */
  reasoningParam: ReasoningParam;
  /** Quando reasoningParam === "custom": nome do parâmetro definido pelo utilizador. */
  customReasoningParam?: string;
  /** Mapeamento custom: nível → valor a enviar (ex.: high → "ultra"). */
  customReasoningValues?: Partial<Record<ReasoningLevel, string>>;
  models: ModelInfo[];
  createdAt: number;
}

/**
 * Como o provedor é visto pelo renderer: sem a referência da chave e com um
 * indicador de se a chave já foi configurada no cofre do SO.
 */
export type ProviderView = Omit<ProviderConfig, "apiKeyRef"> & { hasKey: boolean };

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Chamada a ferramenta pedida pelo modelo. */
export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos em JSON (string) como vieram do modelo. */
  arguments: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Texto de raciocínio devolvido pelo modelo (quando existir). */
  reasoning?: string;
  /** Chamadas de ferramenta pedidas pelo modelo (mensagens assistant). */
  toolCalls?: ToolCall[];
  /** Para mensagens role === "tool": id da ToolCall que originou este resultado. */
  toolCallId?: string;
  /** Nome da ferramenta (mensagens role === "tool"). */
  toolName?: string;
}

// ---------------------------------------------------------------------------
// Ferramentas / aprovações
// ---------------------------------------------------------------------------

/** Uma ferramenta executável pelo agente (ler ficheiros, correr comandos...). */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Schema JSON dos parâmetros (enviado ao modelo). */
  parameters: Record<string, unknown>;
  /** Se true, a execução requer aprovação explícita do utilizador. */
  requiresApproval: boolean;
}

/** Pedido de aprovação mostrado ao utilizador antes de executar algo sensível. */
export interface ApprovalRequest {
  id: string;
  runId: string;
  /** Descrição legível do que será executado (ex.: o comando shell). */
  description: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Artifacts (entregáveis verificáveis, ao estilo Antigravity)
// ---------------------------------------------------------------------------

export type ArtifactType =
  | "plan"        // plano de implementação (texto estruturado)
  | "checklist"   // lista de tarefas com estado
  | "diff"        // diferenças de código produzidas pelo agente
  | "screenshot"  // captura do navegador integrado
  | "report"      // relatório final da missão
  | "file";       // snapshot de ficheiro relevante

export interface Artifact {
  id: string;
  runId: string;
  type: ArtifactType;
  title: string;
  /** Conteúdo textual (markdown/diff) ou caminho/URI no caso de screenshots. */
  content: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Execução de agentes
// ---------------------------------------------------------------------------

export type RunStatus =
  | "idle"        // criado, ainda não iniciado
  | "planning"    // a elaborar o plano
  | "running"     // a executar
  | "waiting-approval" // parado à espera de aprovação do utilizador
  | "completed"
  | "failed"
  | "stopped";

/** Evento emitido durante uma execução (streaming para o renderer). */
export type RunEvent =
  | { kind: "status"; runId: string; status: RunStatus; ts: number }
  | { kind: "message"; runId: string; message: ChatMessage; ts: number }
  | { kind: "tool-start"; runId: string; toolCallId: string; tool: string; args: unknown; ts: number }
  | { kind: "tool-result"; runId: string; toolCallId: string; result: string; ts: number }
  | { kind: "approval-request"; runId: string; approval: ApprovalRequest; ts: number }
  | { kind: "approval-resolved"; runId: string; approvalId: string; approved: boolean; ts: number }
  | { kind: "artifact"; runId: string; artifact: Artifact; ts: number }
  | { kind: "error"; runId: string; error: string; ts: number };

/** Um agente: título, objetivo, workspace, modelo escolhido e histórico. */
export interface AgentRun {
  id: string;
  title: string;
  goal: string;
  /** Pasta local sobre a qual o agente trabalha. */
  workspacePath: string;
  providerId: string;
  modelId: string;
  reasoning: ReasoningLevel;
  status: RunStatus;
  systemPrompt?: string;
  messages: ChatMessage[];
  artifacts: Artifact[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------------

/** Resposta de streaming normalizada emitida pelos adapters de provedores. */
export type ProviderStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "done"; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: "error"; error: string };
