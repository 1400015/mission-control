/**
 * ipcContract.ts
 * ----------------------------------------------------------------------------
 * Contrato tipado da ponte IPC. Tanto o preload (implementa) como o renderer
 * (consome via window.api) importam daqui, para que qualquer alteração de
 * assinatura falhe na compilação dos dois lados em simultâneo.
 */
import type {
  AgentRun,
  ProviderConfig,
  ProviderView,
  ProviderStreamEvent,
  RunEvent,
} from "../shared/types";

/** Dados necessários para criar um novo agente. */
export interface CreateRunInput {
  title: string;
  goal: string;
  workspacePath: string;
  providerId: string;
  modelId: string;
  reasoning: AgentRun["reasoning"];
  systemPrompt?: string;
}

/** API exposta ao renderer via contextBridge (window.api). */
export interface IpcApi {
  // --- Provedores -----------------------------------------------------------
  listProviders(): Promise<ProviderView[]>;
  saveProvider(provider: Partial<Omit<ProviderConfig, "apiKeyRef" | "createdAt">> & { name: string }): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<void>;
  /** Guarda a chave de API no cofre do SO (nunca via Providers table). */
  setProviderKey(providerId: string, key: string): Promise<void>;
  /** Testa a ligação (faz uma chamada mínima). Devolve erro em falha. */
  testProvider(providerId: string): Promise<{ ok: boolean; error?: string; detail?: string }>;
  /** Re-busca a lista de modelos junto do provedor. */
  refreshModels(providerId: string): Promise<ProviderConfig>;

  // --- Agentes ---------------------------------------------------------------
  listRuns(): Promise<AgentRun[]>;
  getRun(id: string): Promise<AgentRun | undefined>;
  createRun(input: CreateRunInput): Promise<AgentRun>;
  startRun(id: string): Promise<void>;
  stopRun(id: string): Promise<void>;
  sendMessage(runId: string, content: string): Promise<void>;
  resolveApproval(approvalId: string, approved: boolean): Promise<void>;

  // --- Streaming --------------------------------------------------------------
  /** Subscreve eventos de execução; devolve função para cancelar a subscrição. */
  onRunEvent(listener: (event: RunEvent & { type?: ProviderStreamEvent["type"] }) => void): () => void;

  // --- Utilitários --------------------------------------------------------------
  pickWorkspace(): Promise<string | undefined>;
  appVersion(): Promise<string>;
}
