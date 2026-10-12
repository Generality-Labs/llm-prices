import type { ModelEntry } from "./types";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

interface OpenRouterModel {
  id: string;
  context_length?: number | null;
  architecture?: { input_modalities?: string[] };
  pricing?: Record<string, unknown>;
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

/** OpenRouter reports per-token prices as decimal strings. */
function price(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Converts OpenRouter's model list into rows shaped like LiteLLM's dataset,
 * keyed `openrouter/<id>` so Inspect's `openrouter/<provider>/<model>` names
 * match directly. These are OpenRouter's own rates, which can differ from the
 * first-party provider's. Router models (priced at -1) are skipped.
 */
export function openRouterEntries(payload: OpenRouterModelsResponse): ModelEntry[] {
  const entries: ModelEntry[] = [];

  for (const model of payload.data) {
    const pricing = model.pricing ?? {};
    const input = price(pricing.prompt);
    const output = price(pricing.completion);
    if (input === undefined || output === undefined) continue;

    const cacheRead = price(pricing.input_cache_read);
    const cacheWrite = price(pricing.input_cache_write);
    const parameters = model.supported_parameters ?? [];

    entries.push({
      key: `openrouter/${model.id}`,
      litellm_provider: "openrouter",
      mode: "chat",
      input_cost_per_token: input,
      output_cost_per_token: output,
      ...(cacheRead !== undefined ? { cache_read_input_token_cost: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cache_creation_input_token_cost: cacheWrite } : {}),
      ...(model.context_length ? { max_input_tokens: model.context_length } : {}),
      ...(model.top_provider?.max_completion_tokens
        ? { max_output_tokens: model.top_provider.max_completion_tokens }
        : {}),
      supports_vision: model.architecture?.input_modalities?.includes("image") ?? false,
      supports_function_calling: parameters.includes("tools"),
      supports_reasoning: parameters.includes("reasoning"),
      supports_prompt_caching: cacheRead !== undefined,
    });
  }

  return entries;
}
