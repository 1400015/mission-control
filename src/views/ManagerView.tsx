/**
 * ManagerView.tsx
 * ----------------------------------------------------------------------------
 * Vista "Manager" (ao estilo do Antigravity Manager): painel de criação de
 * novos agentes + grelha de cartões com estado de cada agente em paralelo.
 */
import { useEffect, useState } from "react";
import type { AgentRun, ProviderView } from "../../shared/types";
import { api } from "../lib/api";

const STATUS_LABEL: Record<AgentRun["status"], string> = {
  idle: "em espera",
  planning: "a planear",
  running: "a executar",
  "waiting-approval": "à espera de aprovação",
  completed: "concluído",
  failed: "falhou",
  stopped: "parado",
};

export function ManagerView(props: {
  runs: AgentRun[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const { runs, onOpen, onChanged } = props;

  // Formulário de criação
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [reasoning, setReasoning] = useState<AgentRun["reasoning"]>("medium");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listProviders().then(setProviders);
  }, []);

  const provider = providers.find((p) => p.id === providerId);
  useEffect(() => {
    setModelId(provider?.models[0]?.id ?? "");
  }, [providerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createAndStart() {
    if (!title || !goal || !workspace || !providerId || !modelId) return;
    setBusy(true);
    try {
      const run = await api.createRun({ title, goal, workspacePath: workspace, providerId, modelId, reasoning });
      await api.startRun(run.id);
      setTitle(""); setGoal("");
      onChanged();
      onOpen(run.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manager">
      <h1>Agentes em paralelo</h1>

      {/* ---- Cartões dos agentes existentes ---- */}
      <div className="cards">
        {runs.length === 0 && <p className="muted">Sem agentes ainda — cria o primeiro abaixo.</p>}
        {runs.map((r) => (
          <button key={r.id} className="card" onClick={() => onOpen(r.id)}>
            <div className="card-top">
              <span className={`dot ${r.status}`} />
              <strong>{r.title}</strong>
              <span className="muted">{STATUS_LABEL[r.status]}</span>
            </div>
            <p className="muted clamp">{r.goal}</p>
            <div className="card-foot muted">
              {r.modelId} · raciocínio: {r.reasoning} · {r.artifacts.length} artifacts
            </div>
          </button>
        ))}
      </div>

      {/* ---- Criação de novo agente ---- */}
      <section className="panel">
        <h2>Novo agente</h2>
        <div className="grid2">
          <label>Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Migrar testes para Vitest" />
          </label>
          <label>Workspace
            <div className="row">
              <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="C:\caminho\para\projeto" />
              <button onClick={async () => { const d = await api.pickWorkspace(); if (d) setWorkspace(d); }}>…</button>
            </div>
          </label>
        </div>
        <label>Objetivo (tarefa delegada)
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            placeholder="Descreve a missão do agente em linguagem natural…"
          />
        </label>
        <div className="grid3">
          <label>Provedor
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">— escolhe —</option>
              {providers.filter((p) => p.hasKey).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>Modelo
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {(provider?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>Nível de raciocínio
            <select value={reasoning} onChange={(e) => setReasoning(e.target.value as AgentRun["reasoning"])}>
              <option value="off">Sem raciocínio</option>
              <option value="low">Leve</option>
              <option value="medium">Médio</option>
              <option value="high">Máximo</option>
            </select>
          </label>
        </div>
        <button className="primary" disabled={busy || !title || !goal || !workspace || !providerId || !modelId} onClick={createAndStart}>
          {busy ? "A criar…" : "Lançar agente"}
        </button>
        {providers.filter((p) => p.hasKey).length === 0 && (
          <p className="warn">Configura primeiro um provedor em “⚙ Provedores”.</p>
        )}
      </section>
    </div>
  );
}
