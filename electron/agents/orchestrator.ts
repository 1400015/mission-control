/**
 * agents/orchestrator.ts
 * ----------------------------------------------------------------------------
 * O MOTOR da aplicação: gere o ciclo de vida dos agentes.
 *
 * Fluxo de uma execução (estilo Antigravity):
 *   1. PLANEAMENTO  → pede ao modelo um plano e guarda-o como Artifact "plan";
 *   2. EXECUÇÃO     → loop: modelo responde com texto e/ou tool-calls;
 *                     ferramentas são executadas (com aprovação quando
 *                     sensíveis) e os resultados voltam ao modelo;
 *   3. RELATÓRIO    → quando o modelo responde sem tool-calls, o texto final
 *                     é guardado como Artifact "report" e o agente conclui.
 *
 * Todos os passos emitem RunEvents via IPC para o renderer atualizar a UI
 * em tempo real (streaming de texto, raciocínio, ferramentas, aprovações).
 */
import { BrowserWindow, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentRun,
  ApprovalRequest,
  Artifact,
  ChatMessage,
  RunEvent,
  RunStatus,
  ToolCall,
} from "../../shared/types";
import { db } from "../storage/db";
import { getSecret } from "../storage/secrets";
import { streamChat } from "../providers/chatService";
import { adapterFor } from "../providers/registry";
import { toolDefinitions, TOOLS } from "./tools";
import { simpleDiff } from "./tools/files";

// ---------------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------------

/** Promises de aprovação pendentes: approvalId → resolve(approved). */
const pendingApprovals = new Map<string, (approved: boolean) => void>();
/** AbortControllers por run — permitem o botão "Parar". */
const abortControllers = new Map<string, AbortController>();
/** Número máximo de iterações do loop (proteção contra loops infinitos). */
const MAX_ITERATIONS = 40;

/** Emite um evento para TODAS as janelas (renderer subscreve via preload). */
function emit(event: RunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("run:event", event);
  }
}

function now(): number {
  return Date.now();
}

function uid(): string {
  return crypto.randomUUID();
}

/** Atualiza o estado do run, persiste e emite evento de status. */
function setStatus(run: AgentRun, status: RunStatus): void {
  run.status = status;
  run.updatedAt = now();
  db.put("runs", run);
  emit({ kind: "status", runId: run.id, status, ts: now() });
}

/** Acrescenta mensagem ao histórico, persiste e emite. */
function pushMessage(run: AgentRun, message: ChatMessage): void {
  run.messages.push(message);
  run.updatedAt = now();
  db.put("runs", run);
  emit({ kind: "message", runId: run.id, message, ts: now() });
}

/** Guarda e emite um Artifact (plano, diff, relatório...). */
function pushArtifact(run: AgentRun, type: Artifact["type"], title: string, content: string): Artifact {
  const artifact: Artifact = { id: uid(), runId: run.id, type, title, content, createdAt: now() };
  run.artifacts.push(artifact);
  run.updatedAt = now();
  db.put("runs", run);
  emit({ kind: "artifact", runId: run.id, artifact, ts: now() });
  return artifact;
}

// ---------------------------------------------------------------------------
// API usada pelo IPC
// ---------------------------------------------------------------------------

export function listRuns(): AgentRun[] {
  return db
    .list<AgentRun>("runs")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getRun(id: string): AgentRun | undefined {
  return db.get<AgentRun>("runs", id);
}

export function createRun(input: {
  title: string;
  goal: string;
  workspacePath: string;
  providerId: string;
  modelId: string;
  reasoning: AgentRun["reasoning"];
  systemPrompt?: string;
}): AgentRun {
  const run: AgentRun = {
    id: uid(),
    ...input,
    status: "idle",
    messages: [],
    artifacts: [],
    createdAt: now(),
    updatedAt: now(),
  };
  db.put("runs", run);
  return run;
}

/** Inicia (ou retoma) a execução autónoma de um agente. */
export function startRun(id: string): void {
  const run = getRun(id);
  if (!run) throw new Error("Agente não encontrado.");
  if (run.status === "running" || run.status === "planning") return;

  // Executa o loop em segundo plano; erros viram status "failed"
  void agentLoop(run).catch((err) => {
    run.error = String(err?.message ?? err);
    setStatus(run, "failed");
    emit({ kind: "error", runId: run.id, error: run.error, ts: now() });
  });
}

/** Pede o cancelamento da execução em curso. */
export function stopRun(id: string): void {
  abortControllers.get(id)?.abort();
}

/** Envia uma mensagem extra (follow-up) para um agente já concluído. */
export function sendMessage(runId: string, content: string): void {
  const run = getRun(runId);
  if (!run) throw new Error("Agente não encontrado.");
  pushMessage(run, { id: uid(), role: "user", content });
  startRun(runId);
}

/** Resolve um pedido de aprovação (aprovado/negado) vindo da UI. */
export function resolveApproval(approvalId: string, approved: boolean): void {
  const resolver = pendingApprovals.get(approvalId);
  if (resolver) {
    pendingApprovals.delete(approvalId);
    resolver(approved);
  }
}

// ---------------------------------------------------------------------------
// Loop principal do agente
// ---------------------------------------------------------------------------

/** Prompt de sistema padrão — define o comportamento "agente" do modelo. */
const DEFAULT_SYSTEM = [
  "És um agente autónomo que executa tarefas de engenharia num workspace local.",
  "Fluxo esperado: (1) investiga o workspace com as ferramentas; (2) executa as alterações;",
  "(3) quando a tarefa estiver concluída, responde com um relatório final em markdown,",
  "sem chamar ferramentas. Nunca inventes conteúdos de ficheiros — lê-os primeiro.",
].join(" ");

async function agentLoop(run: AgentRun): Promise<void> {
  const provider = db.get<import("../../shared/types").ProviderConfig>("providers", run.providerId);
  if (!provider) throw new Error("Provedor não configurado para este agente.");

  const controller = new AbortController();
  abortControllers.set(run.id, controller);

  // Mensagem inicial se o histórico estiver vazio (primeira execução)
  if (run.messages.length === 0) {
    pushMessage(run, { id: uid(), role: "user", content: run.goal });
  }

  let iteration = 0;
  let planCreated = false;

  while (true) {
    iteration++;
    if (iteration > MAX_ITERATIONS) {
      setStatus(run, "failed");
      run.error = "Atingido o número máximo de iterações.";
      return;
    }

    // --- Chamar o modelo (streaming) ------------------------------------
    setStatus(run, iteration === 1 && !planCreated ? "planning" : "running");

    let text = "";
    let reasoningText = "";
    const toolCalls: ToolCall[] = [];
    const pendingArgs = new Map<string, ToolCall>(); // para juntar chunks parciais

    try {
      await streamChat(
        provider,
        {
          modelId: run.modelId,
          reasoning: run.reasoning,
          tools: toolDefinitions(),
          messages: [
            // system na frente, sempre
            { id: "sys", role: "system", content: run.systemPrompt ?? DEFAULT_SYSTEM },
            ...run.messages,
          ],
          // Chave estável de sessão para APIs que gerem a própria memória
          // (iaedu usa isto como thread_id)
          sessionKey: run.id,
        },
        (ev) => {
          switch (ev.type) {
            case "text":
              text += ev.delta;
              break;
            case "reasoning":
              reasoningText += ev.delta;
              break;
            case "tool-call": {
              // Chunks podem ser parciais: sem nome → continua a anterior
              const last = pendingArgs.get("last");
              if (!ev.call.name && last) {
                last.arguments += ev.call.arguments;
              } else {
                pendingArgs.set("last", ev.call);
                toolCalls.push(ev.call);
              }
              break;
            }
            case "error":
              throw new Error(ev.error);
          }
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus(run, "stopped");
        return;
      }
      throw err;
    }

    // Regista a resposta do assistente no histórico
    pushMessage(run, {
      id: uid(),
      role: "assistant",
      content: text,
      reasoning: reasoningText || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    });

    // 1ª resposta sem ferramentas = plano da missão (Artifact)
    if (!planCreated && toolCalls.length === 0 && text) {
      pushArtifact(run, "plan", "Plano da missão", text);
      planCreated = true;
      // Depois do plano, pedimos ao modelo para começar a executar
      pushMessage(run, {
        id: uid(),
        role: "user",
        content: "Plano registado. Executa agora a tarefa usando as ferramentas disponíveis. Termina com um relatório final.",
      });
      continue;
    }

    // Sem tool-calls → o modelo considera a tarefa concluída
    if (toolCalls.length === 0) {
      pushArtifact(run, "report", "Relatório final", text || "(sem conteúdo)");
      setStatus(run, "completed");
      return;
    }

    // Executa cada ferramenta pedida
    setStatus(run, "running");
    for (const call of toolCalls) {
      const toolResult = await executeTool(run, call, controller);
      pushMessage(run, {
        id: uid(),
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: toolResult,
      });
      if (controller.signal.aborted) {
        setStatus(run, "stopped");
        return;
      }
      // Se uma aprovação foi negada, informa o modelo para não insistir
      if (toolResult.startsWith("APROVAÇÃO NEGADA")) {
        pushMessage(run, {
          id: uid(),
          role: "user",
          content: "O utilizador negou esta operação. Tenta uma abordagem alternativa ou termina com um relatório explicando o que falta.",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Execução de ferramentas
// ---------------------------------------------------------------------------

/**
 * Executa uma ToolCall, com gate de aprovação quando necessário.
 * Ferramentas de escrita produzem um Artifact "diff" para verificação.
 */
async function executeTool(
  run: AgentRun,
  call: ToolCall,
  controller: AbortController
): Promise<string> {
  const entry = TOOLS[call.name];
  if (!entry) return `ERRO: ferramenta desconhecida "${call.name}".`;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return "ERRO: argumentos inválidos (JSON mal formado).";
  }

  // Captura o estado atual do ficheiro (para o diff) antes de alterar
  if (entry.diffArg) {
    try {
      const file = path.resolve(run.workspacePath, String(args.path ?? ""));
      args.__previous = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
    } catch {
      args.__previous = undefined;
    }
  }

  // Gate de aprovação: ferramentas sensíveis esperam decisão do utilizador
  if (entry.def.requiresApproval) {
    const description = describeTool(call.name, args);
    const approval: ApprovalRequest = {
      id: uid(),
      runId: run.id,
      description,
      status: "pending",
      createdAt: now(),
    };
    emit({ kind: "approval-request", runId: run.id, approval, ts: now() });
    setStatus(run, "waiting-approval");

    const approved = await new Promise<boolean>((resolve) => {
      pendingApprovals.set(approval.id, resolve);
    });
    approval.status = approved ? "approved" : "denied";
    emit({ kind: "approval-resolved", runId: run.id, approvalId: approval.id, approved, ts: now() });
    setStatus(run, "running");

    if (!approved) return "APROVAÇÃO NEGADA pelo utilizador.";
  }

  emit({ kind: "tool-start", runId: run.id, toolCallId: call.id, tool: call.name, args, ts: now() });

  try {
    let result = await entry.run(run.workspacePath, args);

    // Screenshots do navegador → Artifact visual (data-URI exibível na UI)
    if (result.startsWith("DATA_URI:data:image/")) {
      const dataUri = result.slice("DATA_URI:".length);
      pushArtifact(run, "screenshot", `Screenshot — ${new Date().toLocaleTimeString()}`, dataUri);
      result = "Screenshot capturado e guardado como artifact para o utilizador.";
    }

    emit({ kind: "tool-result", runId: run.id, toolCallId: call.id, result: result.slice(0, 2000), ts: now() });

    // Produz artifact de diff para ferramentas de escrita
    if (entry.diffArg) {
      const { file, previous } = entry.diffArg(args);
      try {
        const after = fs.readFileSync(path.resolve(run.workspacePath, file), "utf-8");
        pushArtifact(run, "diff", `Alteração: ${file}`, simpleDiff(previous ?? "", after, file));
      } catch { /* ficheiro pode ter sido movido */ }
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    const msg = `ERRO ao executar ${call.name}: ${String((err as Error)?.message ?? err)}`;
    emit({ kind: "tool-result", runId: run.id, toolCallId: call.id, result: msg, ts: now() });
    return msg;
  }
}

/** Descrição legível para o pedido de aprovação. */
function describeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "run_command":
      return `Executar comando: ${args.command}`;
    case "write_file":
      return `Escrever ficheiro: ${args.path}`;
    case "edit_file":
      return `Editar ficheiro: ${args.path}`;
    default:
      return `${name}(${JSON.stringify(args).slice(0, 200)})`;
  }
}
