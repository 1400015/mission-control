/**
 * preload.ts
 * ----------------------------------------------------------------------------
 * Ponte de segurança entre o renderer (React) e o processo principal.
 * Expõe um objeto `window.api` com métodos tipados — o renderer nunca tem
 * acesso direto a Node, ficheiros, nem às chaves de API.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi } from "./ipcContract";

const api: IpcApi = {
  // Provedores
  listProviders: () => ipcRenderer.invoke("providers:list"),
  saveProvider: (p) => ipcRenderer.invoke("providers:save", p),
  deleteProvider: (id) => ipcRenderer.invoke("providers:delete", id),
  setProviderKey: (providerId, key) => ipcRenderer.invoke("providers:set-key", providerId, key),
  testProvider: (providerId) => ipcRenderer.invoke("providers:test", providerId),
  refreshModels: (providerId) => ipcRenderer.invoke("providers:refresh-models", providerId),
  // Agentes
  listRuns: () => ipcRenderer.invoke("runs:list"),
  getRun: (id) => ipcRenderer.invoke("runs:get", id),
  createRun: (input) => ipcRenderer.invoke("runs:create", input),
  startRun: (id) => ipcRenderer.invoke("runs:start", id),
  stopRun: (id) => ipcRenderer.invoke("runs:stop", id),
  sendMessage: (runId, content) => ipcRenderer.invoke("runs:send-message", runId, content),
  resolveApproval: (approvalId, approved) => ipcRenderer.invoke("approvals:resolve", approvalId, approved),

  // Eventos em tempo real (streaming)
  onRunEvent: (listener) => {
    const wrapped = (_e: unknown, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on("run:event", wrapped);
    return () => ipcRenderer.removeListener("run:event", wrapped);
  },

  // Utilitários
  pickWorkspace: () => ipcRenderer.invoke("dialog:pick-workspace"),
  appVersion: () => ipcRenderer.invoke("app:version"),
};

contextBridge.exposeInMainWorld("api", api);
