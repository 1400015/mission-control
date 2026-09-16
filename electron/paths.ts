/**
 * paths.ts
 * ----------------------------------------------------------------------------
 * Centraliza caminhos de dados locais para evitar importações circulares
 * (db.ts e secrets.ts precisam ambos da pasta de dados).
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/** Pasta de dados da aplicação (criada a pedido). */
export function dataDirOf(): string {
  const dir = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
