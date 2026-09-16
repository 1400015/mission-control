/**
 * SettingsView.tsx
 * ----------------------------------------------------------------------------
 * Configuração de provedores:
 *  - adicionar a partir de presets (Google AI Studio, OpenRouter, Groq,
 *    Venice, Alibaba) ou criar um endpoint totalmente personalizado;
 *  - guardar a chave de API no cofre do SO (nunca em texto simples);
 *  - testar a ligação; obter modelos automaticamente;
 *  - escolher o formato de raciocínio (com opções custom: nome do parâmetro
 *    e valor por nível).
 */
import { useEffect, useState } from "react";
import type { ModelInfo, ProviderView, ReasoningLevel } from "../../shared/types";
import { api } from "../lib/api";

/** Presets mostrados na UI (espelham electron/providers/registry.ts). */
const PRESETS: {
  key: string; name: string;
  kind: "google" | "openai-compatible";
  baseUrl: string; reasoningParam: string; hint: string;
}[] = [
  { key: "google-ai-studio", name: "Google AI Studio", kind: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", reasoningParam: "google-thinkingBudget", hint: "Chave em aistudio.google.com/apikey" },
  { key: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", reasoningParam: "openrouter-reasoning", hint: "Chave em openrouter.ai/keys" },
  { key: "groq", name: "Groq", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", reasoningParam: "reasoning_effort", hint: "Chave em console.groq.com/keys" },
  { key: "venice", name: "Venice", kind: "openai-compatible", baseUrl: "https://api.venice.ai/api/v1", reasoningParam: "reasoning_effort", hint: "Chave em venice.ai/settings/api" },
  { key: "alibaba", name: "Alibaba (DashScope)", kind: "openai-compatible", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", reasoningParam: "alibaba-enable_thinking", hint: "Chave no console DashScope" },
  { key: "custom", name: "Outro (endpoint personalizado)", kind: "openai-compatible", baseUrl: "", reasoningParam: "custom", hint: "Indica endpoint + chave" },
];

export function SettingsView() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [editing, setEditing] = useState<null | {
    id?: string;
    name: string;
    kind: "google" | "openai-compatible";
    baseUrl: string;
    reasoningParam: string;
    customReasoningParam?: string;
    apiKey?: string;
    models: ModelInfo[];
  }>(null);
  const [status, setStatus] = useState<string>("");

  const reload = () => void api.listProviders().then(setProviders);
  useEffect(reload, []);

  function addPreset(p: (typeof PRESETS)[number]) {
    setEditing({
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      reasoningParam: p.reasoningParam,
      models: [],
    });
  }

  async function save() {
    if (!editing) return;
    setStatus("A guardar…");
    try {
      const saved = await api.saveProvider({
        id: editing.id,
        name: editing.name,
        kind: editing.kind,
        baseUrl: editing.baseUrl,
        reasoningParam: editing.reasoningParam as ProviderView["reasoningParam"],
        customReasoningParam: editing.customReasoningParam,
        models: editing.models,
      });
      if (editing.apiKey) {
        await api.setProviderKey(saved.id, editing.apiKey);
      }
      setEditing(null);
      setStatus("Guardado.");
      reload();
    } catch (e) {
      setStatus(`Erro: ${(e as Error).message}`);
    }
  }

  return (
    <div className="settings">
      <h1>Provedores de IA</h1>
      <p className="muted">
        As chaves de API são guardadas cifradas no cofre do sistema operativo
        (Credential Manager / Keychain) — nunca em ficheiros de texto.
      </p>
      {status && <p className="muted">{status}</p>}

      {/* ---- Lista de provedores configurados ---- */}
      <div className="provider-list">
        {providers.length === 0 && <p className="muted">Nenhum provedor configurado ainda.</p>}
        {providers.map((p) => (
          <div key={p.id} className="provider-row">
            <div>
              <strong>{p.name}</strong> {p.hasKey ? <span className="ok">chave ✓</span> : <span className="warn">sem chave</span>}
              <div className="muted">{p.baseUrl || "sem endpoint"} · raciocínio: {p.reasoningParam}</div>
              <div className="muted">{p.models.length} modelo(s)</div>
            </div>
            <div className="row">
              <button onClick={() => setEditing({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, reasoningParam: p.reasoningParam, models: p.models })}>Editar</button>
              <button onClick={async () => {
                const key = prompt("Chave de API para " + p.name);
                if (key) { await api.setProviderKey(p.id, key); reload(); }
              }}>{p.hasKey ? "Trocar chave" : "Definir chave"}</button>
              <button onClick={async () => {
                setStatus("A testar ligação…");
                const r = await api.testProvider(p.id);
                setStatus(r.ok ? `✓ Ligação OK — ${r.detail ?? ""}` : `✗ ${r.error}`);
              }}>Testar</button>
              <button onClick={async () => {
                try { await api.refreshModels(p.id); setStatus("Modelos atualizados."); reload(); }
                catch (e) { setStatus(`✗ ${(e as Error).message}`); }
              }}>Obter modelos</button>
              <button className="danger" onClick={async () => { await api.deleteProvider(p.id); reload(); }}>Remover</button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Adicionar por preset ---- */}
      <h2>Adicionar provedor</h2>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.key} className="card" onClick={() => addPreset(p)}>
            <strong>{p.name}</strong>
            <div className="muted">{p.hint}</div>
          </button>
        ))}
      </div>

      {/* ---- Formulário de edição ---- */}
      {editing && (
        <section className="panel">
          <h2>{editing.id ? "Editar" : "Novo"} provedor</h2>
          <div className="grid2">
            <label>Nome
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>Formato da API
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as any })}>
                <option value="openai-compatible">OpenAI-compatible (chat/completions)</option>
                <option value="google">Google GenAI</option>
              </select>
            </label>
          </div>
          <label>Endpoint base
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder="https://meu-servidor/v1"
            />
          </label>
          <label>Chave de API
            <input
              type="password"
              value={editing.apiKey ?? ""}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder="sk-… (guardada cifrada no cofre do SO)"
            />
          </label>
          <div className="grid2">
            <label>Tipo de raciocínio
              <select value={editing.reasoningParam} onChange={(e) => setEditing({ ...editing, reasoningParam: e.target.value })}>
                <option value="none">Não suportado</option>
                <option value="reasoning_effort">reasoning_effort (padrão OpenAI)</option>
                <option value="openrouter-reasoning">reasoning: effort (OpenRouter)</option>
                <option value="alibaba-enable_thinking">enable_thinking (Alibaba)</option>
                <option value="google-thinkingBudget">thinkingBudget (Google)</option>
                <option value="custom">Personalizado…</option>
              </select>
            </label>
            {editing.reasoningParam === "custom" && (
              <label>Nome do parâmetro personalizado
                <input
                  value={editing.customReasoningParam ?? ""}
                  onChange={(e) => setEditing({ ...editing, customReasoningParam: e.target.value })}
                  placeholder="ex.: thinking_level"
                />
              </label>
            )}
          </div>
          <div className="row">
            <button className="primary" onClick={save}>Guardar</button>
            <button onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </section>
      )}
    </div>
  );
}
