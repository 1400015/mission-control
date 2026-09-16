/**
 * ipc.ts
 * ----------------------------------------------------------------------------
 * Registo de todos os handlers IPC — a "API interna" que o renderer consome.
 * Cada handler é fino: valida e delega no módulo responsável
 * (providers/registry, storage/db, agents/orchestrator...).
 */
import { app, dialog, ipcMain } from "electron";
import type { ProviderConfig } from "../shared/types";
import { db } from "./storage/db";
import { deleteSecret, getSecret, setSecret } from "./storage/secrets";
import { adapterFor, PROVIDER_PRESETS } from "./providers/registry";
import { streamChat } from "./providers/chatService";
import {
  createRun, getRun, listRuns, resolveApproval, sendMessage, startRun, stopRun,
} from "./agents/orchestrator";
import type { CreateRunInput, IpcApi } from "./ipcContract";

/**
 * Cria uma configuração de provedor a partir de um preset da UI,
 * gerando id/apiKeyRef/createdAt (o renderer não controla estes campos).
 */
function saveProviderInternal(input: Partial<ProviderConfig> & { name: string }): ProviderConfig {
  const preset = PROVIDER_PRESETS.find((p) => p.name === input.name || p.key === (input as any).presetKey);
  const existing = input.id ? db.get<ProviderConfig>("providers", input.id) : undefined;

  const config: ProviderConfig = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name,
    kind: input.kind ?? existing?.kind ?? preset?.kind ?? "openai-compatible",
    baseUrl: input.baseUrl ?? existing?.baseUrl ?? "",
    apiKeyRef: existing?.apiKeyRef ?? `key:${crypto.randomUUID()}`,
    extraHeaders: input.extraHeaders ?? existing?.extraHeaders ?? preset?.extraHeaders,
    reasoningParam: input.reasoningParam ?? existing?.reasoningParam ?? preset?.reasoningParam ?? "none",
    customReasoningParam: input.customReasoningParam ?? existing?.customReasoningParam,
    customReasoningValues: input.customReasoningValues ?? existing?.customReasoningValues,
    models: input.models ?? existing?.models ?? preset?.suggestedModels ?? [],
    createdAt: existing?.createdAt ?? Date.now(),
  };
  return db.put("providers", config);
}

/** Teste de ligação: conversa mínima ("ping") para validar chave + endpoint. */
async function testProvider(id: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const provider = db.get<ProviderConfig>("providers", id);
  if (!provider) return { ok: false, error: "Provedor não encontrado." };
  const key = getSecret(provider.apiKeyRef);
  if (!key) return { ok: false, error: "Sem chave de API guardada para este provedor." };
  const model = provider.models[0];
  if (!model) return { ok: false, error: "Sem modelos configurados — adiciona pelo menos um." };

  try {
    let firstText = "";
    await streamChat(
      provider,
      {
        modelId: model.id,
        reasoning: "off",
        messages: [{ id: "1", role: "user", content: "Responde apenas com: OK" }],
      },
      (ev) => {
        if (ev.type === "text") firstText += ev.delta;
        if (ev.type === "error") throw new Error(ev.error);
      }
    );
    return { ok: true, detail: `Resposta recebida: "${firstText.slice(0, 80)}"` };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

/** Busca modelos ao provedor e atualiza a configuração guardada. */
async function refreshModels(id: string): Promise<ProviderConfig> {
  const provider = db.get<ProviderConfig>("providers", id);
  if (!provider) throw new Error("Provedor não encontrado.");
  const key = getSecret(provider.apiKeyRef);
  if (!key) throw new Error("Configura primeiro a chave de API.");
  try {
    const models = await adapterFor(provider).listModels(provider, key);
    if (models.length === 0) throw new Error("O provedor não devolveu modelos.");
    provider.models = models;
    return db.put("providers", provider);
  } catch (err) {
    throw new Error(`Não foi possível obter modelos: ${(err as Error)?.message ?? err}`);
  }
}

/** Registra TODOS os handlers. Chamado no arranque (main.ts). */
export function registerIpc(): void {
  // ---- Provedores ----------------------------------------------------------
  ipcMain.handle("providers:list", () =>
    db.list<ProviderConfig>("providers").map(({ apiKeyRef, ...p }) => ({ ...p, hasKey: Boolean(getSecret(apiKeyRef)) }))
  );
  ipcMain.handle("providers:save", (_e, input) => saveProviderInternal(input));
  ipcMain.handle("providers:delete", (_e, id: string) => {
    const provider = db.get<ProviderConfig>("providers", id);
    if (provider) deleteSecret(provider.apiKeyRef);
    db.delete("providers", id);
  });
  ipcMain.handle("providers:set-key", (_e, providerId: string, key: string) => {
    const provider = db.get<ProviderConfig>("providers", providerId);
    if (!provider) throw new Error("Provedor não encontrado.");
    setSecret(provider.apiKeyRef, key);
  });
  ipcMain.handle("providers:test", (_e, id: string) => testProvider(id));
  ipcMain.handle("providers:refresh-models", (_e, id: string) => refreshModels(id));

  // ---- Agentes --------------------------------------------------------------
  ipcMain.handle("runs:list", () => listRuns());
  ipcMain.handle("runs:get", (_e, id: string) => getRun(id));
  ipcMain.handle("runs:create", (_e, input: CreateRunInput) => createRun(input));
  ipcMain.handle("runs:start", (_e, id: string) => startRun(id));
  ipcMain.handle("runs:stop", (_e, id: string) => stopRun(id));
  ipcMain.handle("runs:send-message", (_e, runId: string, content: string) => sendMessage(runId, content));
  ipcMain.handle("approvals:resolve", (_e, approvalId: string, approved: boolean) =>
    resolveApproval(approvalId, approved)
  );

  // ---- Utilitários ------------------------------------------------------------
  ipcMain.handle("dialog:pick-workspace", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Escolhe o workspace do agente",
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("app:version", () => app.getVersion());
}
