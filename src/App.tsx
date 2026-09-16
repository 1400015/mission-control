/**
 * App.tsx
 * ----------------------------------------------------------------------------
 * Componente raiz: gestor de navegação e estado global leve.
 *
 * Navegação:
 *  - "manager"  → grelha de agentes (criar/monitorizar)
 *  - "agent:id" → vista detalhada de um agente (chat/ferramentas/artifacts)
 *  - "settings" → configuração de provedores e raciocínio
 *
 * O streaming de eventos (run:event) é subscrito AQUI e distribuído por um
 * pequeno "store" local — assim qualquer vista reflete o estado em tempo real.
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentRun, RunEvent } from "../shared/types";
import { api } from "./lib/api";
import { ManagerView } from "./views/ManagerView";
import { AgentView } from "./views/AgentView";
import { SettingsView } from "./views/SettingsView";

type Route = { view: "manager" } | { view: "agent"; id: string } | { view: "settings" };

export default function App() {
  const [route, setRoute] = useState<Route>({ view: "manager" });
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [connected, setConnected] = useState(false);

  // Carrega a lista de agentes e subscreve eventos em tempo real
  const refreshRuns = useCallback(async () => {
    setRuns(await api.listRuns());
  }, []);

  useEffect(() => {
    void refreshRuns();
    // Cada evento relevante atualiza o run correspondente no estado local
    const unsubscribe = api.onRunEvent((event: RunEvent) => {
      setRuns((prev) => {
        const runId = event.runId;
        const idx = prev.findIndex((r) => r.id === runId);
        if (idx === -1) return prev;
        const updated = [...prev];
        const run = { ...prev[idx] };

        if (event.kind === "status") run.status = event.status;
        if (event.kind === "message") {
          run.messages = [...run.messages, event.message];
        }
        if (event.kind === "artifact") {
          run.artifacts = [...run.artifacts, event.artifact];
        }
        if (event.kind === "error") run.error = event.error;

        run.updatedAt = event.ts;
        updated[idx] = run;
        return updated;
      });
    });
    setConnected(true);
    return unsubscribe;
  }, [refreshRuns]);

  return (
    <div className="app">
      {/* Barra lateral: identidade visual + navegação principal */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MC</div>
          <div>
            <div className="brand-name">Mission Control</div>
            <div className="brand-sub" style={{ color: connected ? "#7ee787" : "#f85149" }}>
              {connected ? "pronto" : "a ligar…"}
            </div>
          </div>
        </div>
        <nav>
          <button
            className={route.view === "manager" ? "nav active" : "nav"}
            onClick={() => setRoute({ view: "manager" })}
          >
            Agentes ({runs.length})
          </button>
          {runs.slice(0, 8).map((r) => (
            <button
              key={r.id}
              className={route.view === "agent" && route.id === r.id ? "nav sub active" : "nav sub"}
              onClick={() => setRoute({ view: "agent", id: r.id })}
            >
              <span className={`dot ${r.status}`} />
              {r.title}
            </button>
          ))}
          <button
            className={route.view === "settings" ? "nav active" : "nav"}
            onClick={() => setRoute({ view: "settings" })}
          >
            ⚙ Provedores
          </button>
        </nav>
      </aside>

      <main className="content">
        {route.view === "manager" && (
          <ManagerView runs={runs} onOpen={(id) => setRoute({ view: "agent", id })} onChanged={refreshRuns} />
        )}
        {route.view === "agent" && <AgentView runId={route.id} runs={runs} />}
        {route.view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
