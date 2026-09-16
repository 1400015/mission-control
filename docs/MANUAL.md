# Manual técnico — Mission Control

Este documento explica **como o projeto foi arquitetado**, **o que cada ficheiro
faz** e **como as peças se ligam**. Destina-se a quem quer perceber o código,
modificá-lo ou estendê-lo.

- Repositório: <https://github.com/1400015/mission-control>
- Estado: MVP funcional (Fases 1–5 concluídas)

---

## Índice

1. [O que é a aplicação](#1-o-que-é-a-aplicação)
2. [Arquitetura geral](#2-arquitetura-geral)
3. [Fluxo de dados de uma execução de agente](#3-fluxo-de-dados-de-uma-execução-de-agente)
4. [A camada de provedores (multi-API)](#4-a-camada-de-provedores-multi-api)
5. [Como funciona o raciocínio (reasoning)](#5-como-funciona-o-raciocínio-reasoning)
6. [Ferramentas do agente e aprovações](#6-ferramentas-do-agente-e-aprovações)
7. [Segurança](#7-segurança)
8. [Guia ficheiro a ficheiro](#8-guia-ficheiro-a-ficheiro)
9. [Como usar (passo a passo)](#9-como-usar-passo-a-passo)
10. [Como estender o projeto](#10-como-estender-o-projeto)
11. [Roadmap](#11-roadmap)

---

## 1. O que é a aplicação

**Mission Control** é uma aplicação desktop (inspirada na vista *Manager/Mission
Control* do Google Antigravity, mas **sem a IDE**) onde:

- lanças **vários agentes de IA autónomos em paralelo**, cada um a trabalhar
  sobre uma pasta local (*workspace*);
- cada agente produz **artifacts verificáveis**: plano da missão, diffs de cada
  ficheiro alterado, screenshots do navegador e um relatório final;
- escolhes livremente o **provedor** — Google AI Studio, OpenRouter, Groq,
  Venice, Alibaba (DashScope) — ou **qualquer endpoint OpenAI-compatible**
  (indicando endpoint + chave, sem código novo);
- controlas o **nível de raciocínio** (off/leve/médio/máximo), traduzido
  automaticamente para o parâmetro de cada API.

---

## 2. Arquitetura geral

```
┌─────────────────────────── Electron ────────────────────────────┐
│                                                                 │
│  RENDERER (React, sem acesso a Node)                            │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │ ManagerView │ │  AgentView   │ │      SettingsView        │  │
│  │ (grelha de  │ │ chat + trace │ │ provedores, chaves,      │  │
│  │  agentes)   │ │ + artifacts  │ │ reasoning, testes        │  │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘  │
│        │                │                  │                    │
│        └──────────── window.api (IPC tipado) ────┘              │
│                        │                     │                  │
│  PRELOAD (ponte segura, contextIsolation)    │                  │
│                        │                     │                  │
│  PROCESSO PRINCIPAL (Node)                   ▼                  │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │   ipc.ts     │→ │  agents/orchestrator.ts (motor)          │ │
│  │  (handlers)  │  │  loop: planejar → ferramentas → relatório│ │
│  └──────┬───────┘  └──────────┬───────────────────────────────┘ │
│         │                     │                                 │
│  ┌──────┴───────────┐  ┌──────┴──────────────┐  ┌────────────┐ │
│  │ storage/db.ts    │  │ providers/*         │  │ tools/*    │ │
│  │ (JSON local)     │  │ adapters + streaming│  │ ficheiros, │ │
│  │ secrets.ts       │  │ (Google + OpenAI)   │  │ shell, web │ │
│  │ (safeStorage)    │  └─────────────────────┘  └────────────┘ │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Decisões de arquitetura (e porquê)

| Decisão | Motivo |
|---|---|
| **Electron + React + TypeScript** | ecossistema maduro; controlo total da UI; IPC tipado |
| **Toda a lógica sensível no processo principal** | chaves de API nunca chegam ao renderer; ferramentas (fs/shell/browser) só existem em Node |
| **Renderer com `contextIsolation` + bridge tipada** | superfície de ataque mínima; o renderer só chama métodos explícitos de `window.api` |
| **Adapter pattern para provedores** | adicionar uma API nova = 1 ficheiro; o resto da app não muda |
| **Streaming normalizado (`ProviderStreamEvent`)** | a UI recebe a mesma forma de eventos venha de SSE, formato Google ou OpenAI |
| **Persistência JSON local** | zero dependências nativas (build fiável); coleções são ficheiros em `%APPDATA%/mission-control/data`. A interface (`db.list/get/put/delete`) permite trocar por SQLite depois sem alterar chamadas |
| **Chaves no cofre do SO** (`safeStorage`) | DPAPI no Windows, Keychain no macOS, libsecret no Linux — nunca texto simples |
| **Eventos em vez de polling** | o orquestrador emite `RunEvent`s via IPC; a UI subscreve uma vez e atualiza em tempo real |

---

## 3. Fluxo de dados de uma execução de agente

1. **Criação** — `ManagerView` chama `api.createRun(...)` → `ipc.ts` →
   `orchestrator.createRun()` → grava em `data/runs.json`.
2. **Arranque** — `api.startRun(id)` → `agentLoop()`:
   - iteração 1 sem ferramentas → resposta guardada como **Artifact `plan`**;
   - depois o modelo entra no **loop de ferramentas**: cada resposta com
     `tool_calls` é executada e o resultado devolvido ao modelo como mensagem
     `role: "tool"`;
   - primeira resposta **sem** tool-calls após o plano → texto guardado como
     **Artifact `report`** e o agente termina `completed`.
3. **Streaming** — durante a conversa, cada chunk vira um `RunEvent`:
   - `message` (texto/razoamento do modelo),
   - `tool-start` / `tool-result`,
   - `approval-request` / `approval-resolved`,
   - `artifact` (plano/diff/screenshot/relatório),
   - `status` (mudanças de estado),
   - `error`.
   O `App.tsx` subscreve `run:event` uma única vez e distribui aos componentes.
4. **Aprovações** — ferramentas com `requiresApproval: true` (escrever/editar
   ficheiros, comandos shell, interações com o navegador) colocam o run em
   `waiting-approval` e **bloqueiam** numa Promise até o utilizador aprovar
   (`api.resolveApproval(approvalId, ok)`).
5. **Paragem** — `api.stopRun(id)` aborta via `AbortController`; o stream é
   cancelado e o estado fica `stopped`.

---

## 4. A camada de provedores (multi-API)

### Contrato comum (`providers/types.ts`)

Todo provedor implementa `ProviderAdapter`:

| Método | Função |
|---|---|
| `buildHeaders` | autenticação (Google usa `x-goog-api-key`; os restantes `Authorization: Bearer`) |
| `chatEndpoint(provider, modelId)` | URL de chat completions (Google: `:streamGenerateContent?alt=sse`) |
| `buildBody(...)` | corpo do pedido, incluindo o bloco de raciocínio (`reasoningBody`) |
| `parseStreamChunk(...)` | linha SSE → eventos normalizados (`text`, `reasoning`, `tool-call`, `done`) |
| `listModels(...)` | descoberta de modelos para a UI (`GET /models`) |

### Dois adapters, muitos provedores

- **`google.ts`** — formato GenAI: `contents[]` com `parts`, `systemInstruction`
  separado, `functionCall`/`functionResponse` para ferramentas, e `thought: true`
  para distinguir raciocínio de resposta.
- **`openaiCompatible.ts`** — formato `chat/completions` (a maioria do mercado).
  Um único ficheiro serve **OpenRouter, Groq, Venice, Alibaba (modo
  compatível) e qualquer endpoint custom**, porque o que difere entre eles é:
  (a) URL base, (b) headers extra e (c) o formato de raciocínio — todos
  guardados como configuração, não como código.

### Presets (`registry.ts`)

`PROVIDER_PRESETS` define os modelos de configuração apresentados na UI.
Um provedor novo = escolher preset → colar chave → (opcional) "Obter modelos"
para re-buscar a lista ao provedor.

### Streaming (`chatService.ts`)

`streamChat()` faz o `fetch` com leitura manual do corpo, separa linhas SSE
(processando linhas parciais com um buffer) e invoca `parseStreamChunk` do
adapter. A chave de API é lida do cofre aqui — ponto único de contato.

---

## 5. Como funciona o raciocínio (reasoning)

O utilizador escolhe um **nível**: `off | low | medium | high`.
`reasoningBody()` (`providers/reasoning.ts`) traduz para o formato do provedor:

| Provedor | Parâmetro enviado (exemplo para `high`) |
|---|---|
| Google AI Studio | `generationConfig.thinkingConfig.thinkingBudget: 32768` + `includeThoughts: true` |
| Padrão OpenAI (Groq, Venice) | `reasoning_effort: "high"` |
| OpenRouter | `reasoning: { effort: "high" }` |
| Alibaba DashScope | `enable_thinking: true` |
| **Custom** | nome do parâmetro e valor definidos pelo utilizador por nível (ex.: `thinking_level: "ultra"`) |

Para provedores personalizados, o utilizador escolhe na UI:
- o **nome do parâmetro** (`customReasoningParam`),
- o **valor por nível** (`customReasoningValues`) — níveis sem valor usam
  o nome do nível.

Orçamentos de tokens (Google): `low → 2048`, `medium → 8192`, `high → 32768`.

O texto de raciocínio devolvido pelo modelo (quando existir) é mostrado na UI
num bloco expansível `<details>` sob cada mensagem do agente.

---

## 6. Ferramentas do agente e aprovações

Cada ferramenta = `ToolDefinition` (o que o modelo vê) + runner (execução real).
Registadas em `agents/tools/index.ts`:

| Ferramenta | O que faz | Aprovação |
|---|---|---|
| `list_files` | lista diretório do workspace | não |
| `read_file` | lê ficheiro (limitado a 60k caracteres) | não |
| `write_file` | cria/substitui ficheiro (pastas auto) | **sim** |
| `edit_file` | substituição exata `search → replace` | **sim** |
| `run_command` | comando no PowerShell/shell, cwd = workspace, timeout 120s | **sim** |
| `browser_open` | abre URL (headless, Edge/Chrome do sistema) | não |
| `browser_read` | texto visível da página (≤20k chars) | não |
| `browser_screenshot` | captura → artifact com data-URI | não |
| `browser_click` | clica num seletor CSS | **sim** |
| `browser_type` | escreve num campo (opcional Enter) | **sim** |

Mecanismos de proteção:

- **Workspace confinado** — `safeJoin()` rejeita qualquer caminho fora da
  pasta do agente (anti path-traversal).
- **Gate de aprovação** — ferramentas sensíveis só executam após decisão
  explícita na UI; negação é devolvida ao modelo com instrução para tentar
  outra abordagem.
- **Diff obrigatório** — antes de escrever/editar, o orquestrador lê o estado
  anterior do ficheiro e produz um **Artifact `diff`** para auditoria.
- **Limites** — 40 iterações máx. do loop; saída de comandos ≤ 20k chars;
  leituras de página ≤ 20k chars.

---

## 7. Segurança

| Camada | Medida |
|---|---|
| Chaves de API | cifradas com `safeStorage` (DPAPI/Keychain/libsecret); apenas blob cifrado em disco; decifradas só em memória no processo principal |
| Renderer | `contextIsolation: true`, `nodeIntegration: false`; sem acesso a fs/net/shell |
| CSP | `default-src 'self'` no `index.html` |
| Sistema de ficheiros | caminhos sempre resolvidos e validados dentro do workspace |
| Terminal | sempre com aprovação; timeout; saída truncada |
| Navegador | headless; interações com aprovação; screenshots são data-URIs locais |
| IPC | apenas canais nomeados definidos em `ipcContract.ts` |

---

## 8. Guia ficheiro a ficheiro

### Raiz

| Ficheiro | Função |
|---|---|
| `package.json` | scripts (`typecheck`, `build:main`, `build:renderer`, `start`, `dist`), dependências e ponto de entrada do Electron |
| `tsconfig.json` | TypeScript do **renderer** (JSX, DOM, sem emitir — o Vite constrói) |
| `tsconfig.node.json` | TypeScript do **processo principal** (CommonJS, saída em `dist-electron/`) |
| `vite.config.ts` | configuração do Vite: só constrói o renderer; `base: "./"` para `file://` |
| `index.html` | HTML anfitrião do React + CSP estrita |
| `.gitignore` | exclui `node_modules`, builds e dados locais |

### `shared/`

| Ficheiro | Função |
|---|---|
| `types.ts` | **fonte única de verdade dos tipos** partilhados entre os dois processos: `ProviderConfig`, `ReasoningLevel/Param`, `ChatMessage`, `ToolCall`, `Artifact`, `AgentRun`, `RunEvent`, `ProviderStreamEvent`, `ProviderView` |

### `electron/` (processo principal)

| Ficheiro | Função |
|---|---|
| `main.ts` | arranque: cria a janela (tema escuro, `titleBarStyle: hidden`), carrega Vite em dev / `dist` em prod, registra IPC, encerra o browser ao sair |
| `preload.ts` | ponte `contextBridge`: expõe `window.api` com a assinatura de `ipcContract.ts`; devolve funções de cancelamento das subscrições |
| `ipcContract.ts` | **contrato tipado** da ponte IPC (`IpcApi` + `CreateRunInput`); usado pelo preload e pelo renderer — alterações aqui quebram a compilação dos dois lados |
| `ipc.ts` | handlers de todos os canais: CRUD de provedores, `set-key`, `test` (conversa mínima "OK"), `refresh-models`, runs, aprovações, diálogo de pasta |
| `paths.ts` | pasta de dados (`%APPDATA%/mission-control/data`), evitando importações circulares |

### `electron/storage/`

| Ficheiro | Função |
|---|---|
| `db.ts` | armazém JSON com gravação atómica (tmp + rename); API de coleções `list/get/put/delete` — substituível por SQLite no futuro |
| `secrets.ts` | cofre de segredos sobre `safeStorage`: `setSecret`/`getSecret`/`deleteSecret`; guarda blobs base64 em `secrets.bin` |

### `electron/providers/`

| Ficheiro | Função |
|---|---|
| `types.ts` | interface `ProviderAdapter` + `ChatRequest` — o contrato que toda a camada usa |
| `registry.ts` | `adapterFor(kind)` + `PROVIDER_PRESETS` (Google, OpenRouter, Groq, Venice, Alibaba, custom) com URLs e parâmetros de raciocínio de cada um |
| `reasoning.ts` | `reasoningBody()`: nível → fragmento de body por formato (`thinkingBudget`, `reasoning_effort`, `reasoning{effort}`, `enable_thinking`, custom) |
| `google.ts` | adapter GenAI: `contents/parts`, `systemInstruction`, `functionCall/Response`, streaming SSE com `thought: true` |
| `openaiCompatible.ts` | adapter universal `chat/completions`: mensagens/tool-calls no formato OpenAI, `reasoning`/`reasoning_content` no streaming, `GET /models` |
| `chatService.ts` | `streamChat()`: fetch + leitura do SSE linha a linha, normalização e injeção segura da chave do cofre |

### `electron/agents/`

| Ficheiro | Função |
|---|---|
| `orchestrator.ts` | **motor**: CRUD de runs, loop planejar → ferramentas → relatório, gate de aprovações (Promises), emissão de `RunEvent`s, screenshots→artifacts, diffs, limites de iteração, AbortController |
| `tools/index.ts` | catálogo `TOOLS` (definição + runner por ferramenta); ponto de registo de ferramentas novas |
| `tools/files.ts` | `list/read/write/edit_file` + `safeJoin` (confinamento) + `simpleDiff` (LCS, estilo unified) |
| `tools/shell.ts` | `run_command`: `exec` com PowerShell/sh, timeout 120s, saída ≤ 20k chars, exit code |
| `tools/browser.ts` | browser headless partilhado via playwright-core (canais `msedge`/`chrome`): open/read/screenshot/click/type; screenshots como data-URI |

### `src/` (renderer React)

| Ficheiro | Função |
|---|---|
| `main.tsx` | montagem do React |
| `App.tsx` | navegação (manager/agent/settings), store local de runs, subscrição global de `run:event` |
| `lib/api.ts` | `window.api` tipado via `IpcApi` |
| `views/ManagerView.tsx` | cartões de agentes com estado + formulário de criação (workspace, provedor, modelo, nível de raciocínio) e lançamento |
| `views/AgentView.tsx` | conversa com streaming, blocos de raciocínio, trace de ferramentas, aprovações inline, coluna de artifacts (com `<img>` para screenshots), botões iniciar/parar, follow-up |
| `views/SettingsView.tsx` | lista de provedores, presets, formulário (endpoint, chave, formato de raciocínio + custom), testar ligação, obter modelos |
| `styles.css` | tema escuro completo (variáveis CSS, cards, chat, artifacts, aprovações) |

---

## 9. Como usar (passo a passo)

1. **Configurar um provedor** — separador "⚙ Provedores" → clica num preset
   (ex.: OpenRouter) → "Definir chave" → cola a chave → "Testar" (deve
   responder ✓) → opcionalmente "Obter modelos".
2. **Criar um agente** — separador "Agentes" → título, pasta do workspace,
   objetivo em linguagem natural, provedor/modelo, nível de raciocínio →
   "Lançar agente".
3. **Acompanhar** — a vista do agente mostra o streaming, o **plano** como
   artifact, cada chamada de ferramenta no trace, e **pedidos de aprovação**
   quando o agente vai escrever ficheiros ou correr comandos.
4. **Verificar** — a coluna de artifacts tem o plano, um diff por alteração,
   screenshots e o relatório final.
5. **Orientar** — envia mensagens no campo de baixo (o agente retoma com a
   nova instrução).

### Notas por provedor

| Provedor | Observações |
|---|---|
| Google AI Studio | chave em `aistudio.google.com/apikey`; reasoning via `thinkingBudget` |
| OpenRouter | reasoning via `reasoning: { effort }`; headers `HTTP-Referer`/`X-Title` já pré-configurados |
| Groq | `reasoning_effort` — só em modelos que suportam (ex.: GPT-OSS); outros modelos ignoram |
| Venice | `reasoning_effort`/`reasoning_format`; usa modelos com raciocínio para níveis terem efeito |
| Alibaba | DashScope *International* por defeito (`dashscope-intl.aliyuncs.com`); altera o baseUrl se usares a região China |
| Custom | endpoint OpenAI-compatible (ex.: `http://localhost:11434/v1` para Ollama); define o parâmetro de raciocínio personalizado se aplicável |

---

## 10. Como estender o projeto

**Adicionar um provedor novo com formato próprio:**
1. cria `electron/providers/meu.ts` implementando `ProviderAdapter`;
2. liga-o em `adapterFor()` (registry.ts);
3. adiciona um preset em `PROVIDER_PRESETS`.

**Adicionar uma ferramenta ao agente:**
1. define `ToolDefinition` + runner;
2. regista em `TOOLS` (tools/index.ts) — aparece automaticamente no schema
   enviado aos modelos.

**Trocar a persistência por SQLite:** reescreve `storage/db.ts` mantendo a
mesma assinatura — nada mais muda.

**Empacotar como instalador:** `npm run dist` (electron-builder já está nas
devDependencies; cria `electron-builder.yml` com targets NSC/DM/AppImage).

---

## 11. Roadmap

- [ ] Instaladores assinados (electron-builder)
- [ ] SQLite + migração das coleções JSON
- [ ] Gravação de sessões do navegador (vídeo) como artifact
- [ ] Conhecimento entre sessões (memória por workspace)
- [ ] Notificações do SO quando um agente precisa de aprovação
- [ ] Editores de diff lado a lado
- [ ] Testes unitários (vitest) e E2E (playwright test runner)
