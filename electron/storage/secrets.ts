/**
 * storage/secrets.ts
 * ----------------------------------------------------------------------------
 * Cofre de segredos baseado em Electron safeStorage, que cifra a nível do
 * sistema operativo:
 *   - Windows : DPAPI (Credential Manager)
 *   - macOS   : Keychain
 *   - Linux   : libsecret / kwallet
 *
 * As chaves de API NUNCA são guardadas em texto simples no disco — apenas o
 * blob cifrado. O valor decifrado existe apenas em memória no processo
 * principal e é injetado diretamente nos pedidos HTTP aos provedores.
 */
import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { dataDirOf } from "../paths";

function secretsFile(): string {
  return path.join(dataDirOf(), "secrets.bin");
}

/** Guarda um segredo cifrado sob uma referência (ex.: "key:<providerId>"). */
export function setSecret(ref: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Cifra do sistema indisponível — não é possível guardar segredos com segurança.");
  }
  const blob = safeStorage.encryptString(value);
  const map = readAll();
  map[ref] = blob.toString("base64");
  fs.writeFileSync(secretsFile(), JSON.stringify(map), "utf-8");
}

/** Lê e decifra um segredo; devolve undefined se não existir. */
export function getSecret(ref: string): string | undefined {
  const map = readAll();
  const encoded = map[ref];
  if (!encoded) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return undefined;
  }
}

/** Remove um segredo do cofre. */
export function deleteSecret(ref: string): void {
  const map = readAll();
  delete map[ref];
  fs.writeFileSync(secretsFile(), JSON.stringify(map), "utf-8");
}

function readAll(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), "utf-8"));
  } catch {
    return {};
  }
}
