/**
 * agents/tools/index.ts
 * ----------------------------------------------------------------------------
 * Índice de ferramentas do agente. Cada ferramenta é uma ToolDefinition
 * (que o modelo vê) + uma função executora (que o processo principal corre).
 *
 * Para adicionar uma nova ferramenta (ex.: browser control na Fase 5):
 *   1. criar o ToolDefinition + runner;
 *   2. acrescentar uma entrada em TOOLS.
 */
import type { ToolDefinition } from "../../../shared/types";
import {
  listFilesTool, runListFiles,
  readFileTool, runReadFile,
  writeFileTool, runWriteFile,
  editFileTool, runEditFile,
} from "./files";
import { runCommandTool, runCommand } from "./shell";

/** Executor de uma ferramenta: recebe args já validados e devolve texto. */
export type ToolRunner = (workspace: string, args: any) => Promise<string> | string;

interface ToolEntry {
  def: ToolDefinition;
  run: ToolRunner;
  /** Produz diff (para artifact) quando a ferramenta altera ficheiros. */
  diffArg?: (args: any) => { file: string; previous?: string };
}

/** Catálogo completo de ferramentas disponíveis para os agentes. */
export const TOOLS: Record<string, ToolEntry> = {
  list_files: { def: listFilesTool, run: runListFiles },
  read_file: { def: readFileTool, run: runReadFile },
  write_file: {
    def: writeFileTool,
    run: runWriteFile,
    diffArg: (args) => ({ file: args.path, previous: args.__previous }),
  },
  edit_file: {
    def: editFileTool,
    run: runEditFile,
    diffArg: (args) => ({ file: args.path, previous: args.__previous }),
  },
  run_command: { def: runCommandTool, run: runCommand },
};

/** Lista de definições no formato que vai no pedido ao modelo. */
export function toolDefinitions(): ToolDefinition[] {
  return Object.values(TOOLS).map((t) => t.def);
}
