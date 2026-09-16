/**
 * main.ts
 * ----------------------------------------------------------------------------
 * Ponto de entrada do PROCESSO PRINCIPAL do Electron.
 *
 * Responsabilidades:
 *  - criar a janela principal e carregar o renderer (Vite em dev, dist em prod);
 *  - registar todos os handlers de IPC (ponte renderer ↔ Node).
 *
 * Por segurança o renderer corre com contextIsolation e SEM integração com
 * Node — só acede ao que expomos no preload.
 */
import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { registerIpc } from "./ipc";

// Evita que a app arranque durante instalações/atualizações no Windows
if (require("electron-squirrel-startup")) {
  app.quit();
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0b0c10", // fundo escuro estilo Antigravity
    titleBarStyle: "hidden",    // barra de título própria (HTML)
    title: "Mission Control",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,  // isolamento total do mundo Node
      nodeIntegration: false,
      sandbox: false,          // o preload precisa de require para a ponte IPC
    },
  });

  // Em desenvolvimento carrega o dev-server do Vite (hot reload);
  // em produção carrega o bundle estático do dist/.
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "bottom" });
  } else {
    void win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc(); // toda a funcionalidade exposta ao renderer
  createWindow();

  app.on("activate", () => {
    // macOS: recriar janela se se clicar no dock sem janelas abertas
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
