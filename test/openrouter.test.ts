import { describe, expect, it } from "vitest";
import { buildInspectCostExport } from "../src/inspect";
import { openRouterEntries } from "../src/openrouter";

// Trimmed from https://openrouter.ai/api/v1/models (2026-10-12).
const payload = {
  data: [
    {
      id: "openai/gpt-4o",
      context_length: 128000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000025", completion: "0.00001", input_cache_read: "0.00000125" },
      top_provider: { context_length: 128000, max_completion_tokens: 16384 },
      supported_parameters: ["max_tokens", "tools", "response_format"],
    },
    {
      id: "anthropic/claude-opus-4.1",
      context_length: 200000,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: {
        prompt: "0.000015",
        completion: "0.000075",
        input_cache_read: "0.0000015",
        input_cache_write: "0.00001875",
      },
      top_provider: { context_length: 200000, max_completion_tokens: 32000 },
      supported_parameters: ["reasoning", "tools"],
    },
    {
      id: "openrouter/auto-beta",
      context_length: 2000000,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "-1", completion: "-1" },
      top_provider: { context_length: null, max_completion_tokens: null },
      supported_parameters: [],
    },
  ],
};

describe("openRouterEntries", () => {
  it("converts an OpenRouter model into a LiteLLM-shaped row keyed by its Inspect name", () => {
    expect(openRouterEntries(payload)[0]).toEqual({
      key: "openrouter/openai/gpt-4o",
      litellm_provider: "openrouter",
      mode: "chat",
      input_cost_per_token: 0.0000025,
      output_cost_per_token: 0.00001,
      cache_read_input_token_cost: 0.00000125,
      max_input_tokens: 128000,
      max_output_tokens: 16384,
      supports_vision: true,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_prompt_caching: true,
    });
  });

  it("skips router models, which OpenRouter prices at -1", () => {
    expect(openRouterEntries(payload).map((entry) => entry.key)).not.toContain(
      "openrouter/openrouter/auto-beta",
    );
  });
});

describe("OpenRouter rows in the Inspect export", () => {
  it("prices openrouter/<provider>/<model> names, including dotted versions", () => {
    const result = buildInspectCostExport(openRouterEntries(payload), [
      "openrouter/openai/gpt-4o",
      "openrouter/anthropic/claude-opus-4-1",
    ]);

    expect(result.unresolved).toEqual([]);
    expect(result.costs).toEqual({
      "openrouter/openai/gpt-4o": {
        input: 2.5,
        output: 10,
        input_cache_write: 0,
        input_cache_read: 1.25,
      },
      "openrouter/anthropic/claude-opus-4-1": {
        input: 15,
        output: 75,
        input_cache_write: 18.75,
        input_cache_read: 1.5,
      },
    });
  });
});
