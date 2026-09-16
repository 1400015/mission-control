/**
 * agents/tools/files.ts
 * ----------------------------------------------------------------------------
 * Ferramentas de sistema de ficheiros do agente. Todas as operações são
 * CONFINADAS ao workspace do agente (proteção contra path traversal) e
 * produzidas como Artifacts verificáveis (diffs) sempre que alteram algo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolDefinition } from "../../../shared/types";

/**
 * Garante que `target` está dentro de `workspace`.
 * Bloqueia caminhos como "../fora" ou caminhos absolutos externos.
 */
export function safeJoin(workspace: string, target: string): string {
  const resolved = path.resolve(workspace, target);
  const normalizedWs = path.resolve(workspace);
  if (resolved !== normalizedWs && !resolved.startsWith(normalizedWs + path.sep)) {
    throw new Error(`Caminho fora do workspace bloqueado: ${target}`);
  }
  return resolved;
}

/** Ferramenta: listar ficheiros/pastas de um diretório do workspace. */
export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "Lista ficheiros e pastas de um diretório do workspace. Usa '.' para a raiz do workspace.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho relativo ao workspace (ex.: 'src' ou '.')" },
    },
    required: ["path"],
  },
};

export function runListFiles(workspace: string, args: { path: string }): string {
  const dir = safeJoin(workspace, args.path || ".");
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`)
    .join("\n") || "(pasta vazia)";
}

/** Ferramenta: ler o conteúdo de um ficheiro de texto do workspace. */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Lê o conteúdo de um ficheiro de texto do workspace.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho relativo do ficheiro" },
    },
    required: ["path"],
  },
};

export function runReadFile(workspace: string, args: { path: string }): string {
  const file = safeJoin(workspace, args.path);
  const content = fs.readFileSync(file, "utf-8");
  // Limita leituras gigantes para não estourar a janela de contexto
  return content.length > 60_000
    ? content.slice(0, 60_000) + `\n... (truncado; ${content.length} caracteres no total)`
    : content;
}

/** Ferramenta: escrever/criar um ficheiro (com diff para o artifact). */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Cria ou substitui um ficheiro no workspace com o conteúdo dado. Pastas são criadas automaticamente.",
  requiresApproval: true, // alterações no disco pedem confirmação
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho relativo do ficheiro" },
      content: { type: "string", description: "Conteúdo completo do ficheiro" },
    },
    required: ["path", "content"],
  },
};

export function runWriteFile(workspace: string, args: { path: string; content: string }): string {
  const file = safeJoin(workspace, args.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, args.content, "utf-8");
  return `Ficheiro escrito: ${args.path} (${args.content.length} caracteres)`;
}

/** Ferramenta: edição por substituição exata (mais segura que reescrever tudo). */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Substitui a primeira ocorrência exata de 'search' por 'replace' num ficheiro do workspace.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho relativo do ficheiro" },
      search: { type: "string", description: "Texto exato a encontrar" },
      replace: { type: "string", description: "Texto que o substitui" },
    },
    required: ["path", "search", "replace"],
  },
};

export function runEditFile(
  workspace: string,
  args: { path: string; search: string; replace: string }
): string {
  const file = safeJoin(workspace, args.path);
  const content = fs.readFileSync(file, "utf-8");
  if (!content.includes(args.search)) {
    throw new Error(`Texto a substituir não encontrado em ${args.path}`);
  }
  fs.writeFileSync(file, content.replace(args.search, args.replace), "utf-8");
  return `Ficheiro editado: ${args.path}`;
}

/**
 * Diff mínimo (estilo unified) entre dois textos — usado nos artifacts
 * para o utilizador verificar exatamente o que o agente alterou.
 */
export function simpleDiff(before: string, after: string, fileLabel: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [`--- ${fileLabel} (antes)`, `+++ ${fileLabel} (depois)`];

  // LCS simples para alinhar linhas comuns
  const m = a.length, n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push(`- ${a[i]}`); i++; }
    else { out.push(`+ ${b[j]}`); j++; }
  }
  while (i < m) out.push(`- ${a[i++]}`);
  while (j < n) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}
