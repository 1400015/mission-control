/**
 * providers/chatService.ts
 * ----------------------------------------------------------------------------
 * Serviço de conversa: dado um ProviderConfig + ChatRequest, faz o pedido
 * HTTP com streaming e emite eventos normalizados (texto, raciocínio,
 * tool-calls) para quem chama — o orchestrador de agentes ou a UI de testes.
 *
 * Ponto central de segurança: a chave de API é lida aqui do cofre do SO e
 * nunca sai do processo principal.
 */
import type { ProviderConfig, ProviderStreamEvent } from "../../shared/types";
import type { ChatRequest } from "./types";
import { getSecret } from "../storage/secrets";
import { adapterFor } from "./registry";

/**
 * Executa uma conversa em streaming.
 * @param onEvent callback chamado para cada evento recebido.
 * @param signal permite cancelar (AbortController) — usado pelo botão "Parar".
 */
export async function streamChat(
  provider: ProviderConfig,
  request: ChatRequest,
  onEvent: (e: ProviderStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const apiKey = getSecret(provider.apiKeyRef);
  if (!apiKey) throw new Error(`Sem chave de API configurada para "${provider.name}".`);

  const adapter = adapterFor(provider);
  const url = adapter.chatEndpoint(provider, request.modelId);
  const body = adapter.buildBody(provider, request, { stream: true });

  const res = await fetch(url, {
    method: "POST",
    headers: adapter.buildHeaders(provider, apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`O provedor respondeu ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }

  // Leitura manual do stream SSE linha a linha
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Eventos SSE são separados por linhas em branco; processamos linha a linha
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // a última pode estar incompleta
    for (const line of lines) {
      for (const ev of adapter.parseStreamChunk(provider, line)) {
        onEvent(ev);
      }
    }
  }
  onEvent({ type: "done" });
}
