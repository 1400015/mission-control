/**
 * providers/google.ts
 * ----------------------------------------------------------------------------
 * Adapter para o Google AI Studio (API Generative Language / Gemini).
 *
 * Particularidades desta API face ao formato OpenAI:
 *  - mensagens: `contents[]` com role "user"/"model" e `parts[]`;
 *  - mensagens de ferramenta: functionCall (no assistant) / functionResponse (tool);
 *  - system prompt: campo separado `systemInstruction`;
 *  - raciocínio: `generationConfig.thinkingConfig.thinkingBudget` (ver reasoning.ts);
 *  - streaming: SSE em `:streamGenerateContent?alt=sse`.
 */
import type { ChatRequest, ProviderAdapter } from "./types";
import type { ModelInfo, ProviderConfig, ProviderStreamEvent } from "../../shared/types";
import { reasoningBody } from "./reasoning";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GooglePart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response?: unknown };
}

/** Converte as mensagens internas para `contents[]` + `systemInstruction`. */
function toGoogleContents(request: ChatRequest) {
  const contents: { role: string; parts: GooglePart[] }[] = [];
  let systemInstruction: { parts: GooglePart[] } | undefined;

  for (const m of request.messages) {
    if (m.role === "system") {
      systemInstruction = { parts: [{ text: m.content }] };
      continue;
    }
    if (m.role === "tool") {
      // Resultado de ferramenta → functionResponse na conversa
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? "tool",
              response: { result: m.content },
            },
          },
        ],
      });
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const parts: GooglePart[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const tc of m.toolCalls ?? []) {
      // Chamada emitida pelo modelo
      parts.push({
        functionCall: {
          name: tc.name,
          args: safeParse(tc.arguments),
        },
      });
    }
    contents.push({ role, parts: parts.length ? parts : [{ text: "" }] });
  }
  return { contents, systemInstruction };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export const googleAdapter: ProviderAdapter = {
  buildHeaders(_provider: ProviderConfig, apiKey: string) {
    // O Google usa um header próprio em vez de Authorization: Bearer
    return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  },

  chatEndpoint(provider: ProviderConfig, modelId: string) {
    const base = (provider.baseUrl || GOOGLE_BASE).replace(/\/+$/, "");
    return `${base}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  },

  buildBody(provider: ProviderConfig, request: ChatRequest, options: { stream: boolean }) {
    const { contents, systemInstruction } = toGoogleContents(request);
    const body: Record<string, unknown> = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(request.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
          }
        : {}),
    };
    // thinkingConfig + temperatura etc.
    Object.assign(body, reasoningBody(provider.reasoningParam, request.reasoning));
    return body;
  },

  /**
   * Interpreta uma linha SSE do Google. Cada evento `data:` contém um
   * GenerateContentResponse parcial com `candidates[].content.parts[]`.
   */
  parseStreamChunk(_provider: ProviderConfig, raw: string): ProviderStreamEvent[] {
    const line = raw.trim();
    if (!line.startsWith("data:")) return [];
    try {
      const json = JSON.parse(line.slice(5).trim());
      const events: ProviderStreamEvent[] = [];
      const candidate = json.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (typeof part.text === "string" && part.text.length) {
          // Parts com thought:true são o raciocínio interno do modelo
          events.push(
            part.thought
              ? { type: "reasoning", delta: part.text }
              : { type: "text", delta: part.text }
          );
        }
        if (part.functionCall) {
          events.push({
            type: "tool-call",
            call: {
              id: crypto.randomUUID(),
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }
      if (json.usageMetadata) {
        events.push({
          type: "done",
          usage: {
            inputTokens: json.usageMetadata.promptTokenCount,
            outputTokens: json.usageMetadata.candidatesTokenCount,
          },
        });
      }
      return events;
    } catch {
      return [];
    }
  },

  async listModels(provider: ProviderConfig, apiKey: string): Promise<ModelInfo[]> {
    const base = (provider.baseUrl || GOOGLE_BASE).replace(/\/+$/, "");
    const res = await fetch(`${base}/models`, {
      headers: this.buildHeaders(provider, apiKey),
    });
    if (!res.ok) throw new Error(`Erro ${res.status} ao listar modelos: ${await res.text()}`);
    const json = (await res.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    return (json.models ?? [])
      // Apenas modelos de geração de conteúdo (exclui embeddings, etc.)
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        label: m.displayName ?? m.name.replace(/^models\//, ""),
        supportsReasoning: true,
      }));
  },
};
