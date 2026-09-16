/**
 * providers/reasoning.ts
 * ----------------------------------------------------------------------------
 * Mapeia o nível de raciocínio escolhido pelo utilizador (off/low/medium/high)
 * para os parâmetros concretos de cada formato de API.
 *
 * Isto é o que permite, por exemplo, escolher "high" num modelo Gemini e
 * ver automaticamente `thinkingConfig.thinkingBudget: 32768` no pedido, ou
 * "medium" na Groq e ver `reasoning_effort: "medium"`.
 */
import type { ReasoningLevel, ReasoningParam } from "../../shared/types";

/** Nível → thinkingBudget em tokens (convenção Google/Gemini). */
const THINKING_BUDGETS: Record<Exclude<ReasoningLevel, "off">, number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
};

/**
 * Devolve o fragmento de body relativo a raciocínio para o parâmetro dado.
 * Devolve {} quando o provedor não suporta (ou nível = off).
 */
export function reasoningBody(
  param: ReasoningParam,
  level: ReasoningLevel,
  custom?: {
    customReasoningParam?: string;
    customReasoningValues?: Partial<Record<ReasoningLevel, string>>;
  }
): Record<string, unknown> {
  if (level === "off") return {};

  switch (param) {
    // Google GenAI (REST): thinkingConfig dentro de generationConfig
    case "google-thinkingBudget":
      return {
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: THINKING_BUDGETS[level],
            includeThoughts: true,
          },
        },
      };

    // Padrão OpenAI: reasoning_effort direto no top-level
    case "reasoning_effort":
      return { reasoning_effort: level };

    // OpenRouter: objeto reasoning { effort }
    case "openrouter-reasoning":
      return { reasoning: { effort: level } };

    // Alibaba DashScope: enable_thinking é booleano (ligado/desligado);
    // interpretamos níveis como "ligado", off = ausente.
    case "alibaba-enable_thinking":
      return { enable_thinking: true };

    // Custom: valor definido pelo utilizador por nível (ex.: high → "ultra")
    case "custom": {
      if (!custom?.customReasoningParam) return {};
      const value = custom.customReasoningValues?.[level] ?? level;
      return { [custom.customReasoningParam]: value };
    }

    case "none":
    default:
      return {};
  }
}
