/**
 * agents/tools/shell.ts
 * ----------------------------------------------------------------------------
 * Ferramenta de TERMINAL: executa um comando no shell do utilizador dentro
 * do workspace. É a ferramenta mais sensível — por isso:
 *   1. requer SEMPRE aprovação do utilizador (gate na UI);
 *   2. limita o tempo de execução (timeout) e o tamanho da saída.
 */
import { exec } from "node:child_process";
import type { ToolDefinition } from "../../../shared/types";

export const runCommandTool: ToolDefinition = {
  name: "run_command",
  description:
    "Executa um comando no terminal (PowerShell no Windows) a partir da raiz do workspace. Usa para compilar, testar, instalar dependências, etc.",
  requiresApproval: true, // comandos shell exigem confirmação explícita
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "O comando a executar" },
    },
    required: ["command"],
  },
};

/**
 * Executa um comando de forma assíncrona.
 * @returns stdout+stderr (truncados) e código de saída.
 */
export function runCommand(
  workspace: string,
  command: string,
  timeoutMs = 120_000
): Promise<string> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    exec(
      command,
      {
        cwd: workspace,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1 MB de saída no máximo
        // PowerShell no Windows; /bin/sh nos restantes
        shell: isWindows ? "pwsh.exe" : "/bin/sh",
      },
      (error, stdout, stderr) => {
        const parts: string[] = [];
        if (stdout) parts.push(`[stdout]\n${stdout.toString()}`);
        if (stderr) parts.push(`[stderr]\n${stderr.toString()}`);
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        parts.push(`[exit code: ${code}]`);
        resolve(parts.join("\n").slice(0, 20_000));
      }
    );
  });
}
