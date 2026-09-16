# Mission Control

Orquestração de **agentes de IA em paralelo** sobre workspaces locais, com
**múltiplos provedores de LLM** — Google AI Studio, OpenRouter, Groq, Venice,
Alibaba (DashScope) e **qualquer endpoint OpenAI-compatible** que configures —
com controlo do **nível de raciocínio** por modelo e **artifacts verificáveis**
(planos, diffs, relatórios), ao estilo do Antigravity Desktop (Google), mas
independente de um único provedor.

> Projeto em desenvolvimento ativo. Consulta `docs/MANUAL.md` para o manual
> técnico completo (arquitetura, ficheiros e decisões de desenho).

## Funcionalidades

- **Manager** — lança vários agentes autónomos em paralelo, cada um sobre o seu workspace local
- **Agente com ferramentas** — ler/listar/escrever/editar ficheiros e executar comandos no terminal, sempre com **gate de aprovação** para operações sensíveis
- **Artifacts** — plano da missão, diffs de cada alteração, relatório final
- **Multi-provedor** — presets para Google AI Studio, OpenRouter, Groq, Venice e Alibaba + provedores personalizados (endpoint + chave)
- **Raciocínio configurável** — off/leve/médio/máximo, traduzido automaticamente para o parâmetro de cada API (`thinkingBudget`, `reasoning_effort`, `reasoning{effort}`, `enable_thinking`, ou custom)
- **Segurança** — chaves de API cifradas no cofre do SO (Credential Manager/Keychain), caminhos confinados ao workspace, contexto isolado no renderer

## Stack

Electron · React 18 · TypeScript · Vite · persistência JSON local · Electron `safeStorage`

## Desenvolvimento

```bash
npm install
npm run typecheck     # verifica tipos (renderer + main)
npm run build:main    # compila o processo principal
npm run build:renderer
npm start             # arranca a app
```

## Licença

MIT
