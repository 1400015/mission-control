/**
 * lib/api.ts
 * ----------------------------------------------------------------------------
 * Acesso tipado à ponte IPC. O objeto é injetado pelo preload como
 * window.api; daqui em diante o renderer só usa `api.xpto()`.
 */
import type { IpcApi } from "../../electron/ipcContract";

declare global {
  interface Window {
    api: IpcApi;
  }
}

export const api: IpcApi = window.api;
