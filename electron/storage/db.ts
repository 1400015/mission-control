/**
 * storage/db.ts
 * ----------------------------------------------------------------------------
 * Camada de persistência local. Nesta fase inicial usamos um "armazém JSON"
 * (ficheiros em app.getPath("userData")) — zero dependências nativas, o que
 * mantém o build fiável em Windows/macOS/Linux.
 *
 * A interface (coleções nomeadas, get/set/merge) foi desenhada para permitir,
 * no futuro, trocar por SQLite (better-sqlite3) sem tocar no resto do código.
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/** Pasta onde tudo é guardado, ex.: %APPDATA%/mission-control/data */
function dataDir(): string {
  const dir = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Caminho do ficheiro de uma coleção (ex.: providers.json). */
function fileFor(collection: string): string {
  return path.join(dataDir(), `${collection}.json`);
}

/** Lê uma coleção inteira; devolve fallback se o ficheiro não existir. */
export function readCollection<T>(collection: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(fileFor(collection), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Escreve uma coleção inteira (gravação atómica via ficheiro temporário). */
export function writeCollection<T>(collection: string, value: T): void {
  const target = fileFor(collection);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

/** Acesso a registos individuais dentro de uma coleção (por id). */
export const db = {
  list<T extends { id: string }>(collection: string): T[] {
    return readCollection<T[]>(collection, []);
  },
  get<T extends { id: string }>(collection: string, id: string): T | undefined {
    return db.list<T>(collection).find((r) => r.id === id);
  },
  put<T extends { id: string }>(collection: string, record: T): T {
    const all = db.list<T>(collection);
    const idx = all.findIndex((r) => r.id === record.id);
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    writeCollection(collection, all);
    return record;
  },
  delete(collection: string, id: string): void {
    writeCollection(
      collection,
      db.list<{ id: string }>(collection).filter((r) => r.id !== id)
    );
  },
};
