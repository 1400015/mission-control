/**
 * AgentView.tsx
 * ----------------------------------------------------------------------------
 * Vista detalhada de um agente:
 *  - coluna esquerda: conversa com o agente (streaming de texto + raciocínio),
 *    trace de ferramentas e pedidos de aprovação inline;
 *  - coluna direita: ARTIFACTS (plano, diffs, relatório) — os entregáveis
 *    verificáveis ao estilo Antigravity.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, ApprovalRequest } from "../../shared/types";
import { api } from "../lib/api";

export function AgentView({ runId, runs }: { runId: string; runs: AgentRun[] }) {
  const run = useMemo(() => runs.find((r) => r.id === runId), [runs, runId]);
  const chatRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [tab, setTab] = useState<"chat" | "trace">("chat");

  // Subscreve pedidos de aprovação (eventos globais filtrados por run)
  useEffect(() => {
    const unsubscribe = api.onRunEvent((event) => {
      if (event.runId !== runId) return;
      if (event.kind === "approval-request") {
        setApprovals((prev) => [...prev, event.approval]);
      }
      if (event.kind === "approval-resolved") {
        setApprovals((prev) => prev.filter((a) => a.id !== event.approvalId));
      }
    });
    return unsubscribe;
  }, [runId]);

  // Auto-scroll do chat
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [run?.messages.length, run?.status]);

  if (!run) return <div className="muted pad">Agente não encontrado.</div>;

  return (
    <div className="agent">
      <header className="agent-head">
        <div>
          <h1>{run.title}</h1>
          <p className="muted">
            {run.workspacePath} · {run.modelId} · raciocínio {run.reasoning}
          </p>
        </div>
        <div className="row">
          {run.status === "running" || run.status === "planning" ? (
            <button className="danger" onClick={() => void api.stopRun(run.id)}>Parar</button>
          ) : (
            <button className="primary" onClick={() => void api.startRun(run.id)}>
              {run.status === "completed" ? "Retomar" : "Iniciar"}
            </button>
          )}
        </div>
      </header>

      {run.error && <div className="error-banner">Erro: {run.error}</div>}

      <div className="agent-body">
        {/* ---- Coluna da conversa ---- */}
        <div className="chat-col">
          <div className="tabs">
            <button className={tab === "chat" ? "tab active" : "tab"} onClick={() => setTab("chat")}>Conversa</button>
            <button className={tab === "trace" ? "tab active" : "tab"} onClick={() => setTab("trace")}>Trace de ferramentas</button>
          </div>

          <div className="chat" ref={chatRef}>
            {run.messages.length === 0 && <p className="muted">Sem mensagens. Inicia o agente para começar.</p>}
            {run.messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="msg-role">{roleLabel(m.role)}</div>
                {m.reasoning && <details className="reasoning"><summary>raciocínio</summary><pre>{m.reasoning}</pre></details>}
                {m.role === "tool"
                  ? <pre className="tool-out">{m.content}</pre>
                  : <div className="msg-body">{m.content}</div>}
                {m.toolCalls?.map((tc) => (
                  <div key={tc.id} className="toolcall">🔧 {tc.name}({tc.arguments.slice(0, 120)})</div>
                ))}
              </div>
            ))}

            {/* Pedidos de aprovação pendentes (gate de segurança) */}
            {approvals.map((a) => (
              <div key={a.id} className="approval">
                <strong>Aprovação necessária</strong>
                <pre>{a.description}</pre>
                <div className="row">
                  <button className="primary" onClick={() => void api.resolveApproval(a.id, true)}>Aprovar</button>
                  <button onClick={() => void api.resolveApproval(a.id, false)}>Negar</button>
                </div>
              </div>
            ))}
          </div>

          <form
            className="chat-input"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!input.trim()) return;
              const text = input;
              setInput("");
              await api.sendMessage(run.id, text);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enviar orientação ao agente…"
              disabled={run.status === "running" || run.status === "planning"}
            />
            <button className="primary" disabled={!input.trim()}>Enviar</button>
          </form>
        </div>

        {/* ---- Coluna de artifacts ---- */}
        <div className="artifacts">
          <h3>Artifacts ({run.artifacts.length})</h3>
          {run.artifacts.length === 0 && <p className="muted">Os entregáveis do agente aparecem aqui.</p>}
          {run.artifacts.map((a) => (
            <details key={a.id} className="artifact" open={a.type === "plan"}>
              <summary>
                <span className={`tag ${a.type}`}>{a.type}</span> {a.title}
              </summary>
              {/* Screenshots são data-URIs e exibem-se como imagem */}
              {a.type === "screenshot" && a.content.startsWith("data:image/")
                ? <img className="shot" src={a.content} alt={a.title} />
                : <pre>{a.content}</pre>}
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "user": return "Tu";
    case "assistant": return "Agente";
    case "tool": return "Ferramenta";
    default: return "Sistema";
  }
}
