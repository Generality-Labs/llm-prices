import { describe, expect, it } from "vitest";
import { buildInspectCostExport, renderInspectCostsYaml, toInspectModelCost } from "../src/inspect";
import type { ModelEntry } from "../src/types";

const models: ModelEntry[] = [
  {
    key: "gpt-4o",
    litellm_provider: "openai",
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 0.00000125,
  },
  {
    key: "claude-sonnet-4-5",
    litellm_provider: "anthropic",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
  },
  {
    key: "claude-sonnet-4-5",
    litellm_provider: "bedrock",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00015,
  },
  {
    key: "gemini/gemini-2.5-pro",
    litellm_provider: "gemini",
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 0.000000125,
  },
  {
    key: "cloudflare/@cf/meta/llama-2-7b-chat-fp16",
    litellm_provider: "cloudflare",
    input_cost_per_token: 0.000001923,
    output_cost_per_token: 0.000001923,
  },
  {
    key: "xai/grok-4",
    litellm_provider: "xai",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
];

describe("toInspectModelCost", () => {
  it("converts token prices into dollars per million tokens", () => {
    expect(toInspectModelCost(models[0])).toEqual({
      input: 2.5,
      output: 10,
      input_cache_write: 0,
      input_cache_read: 1.25,
    });
  });
});

describe("buildInspectCostExport", () => {
  it("resolves inspect-style model names across provider naming differences", () => {
    const result = buildInspectCostExport(models, [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-pro",
      "cf/meta/llama-2-7b-chat-fp16",
      "grok/grok-4",
    ]);

    expect(result.unresolved).toEqual([]);
    expect(result.costs).toEqual({
      "openai/gpt-4o": {
        input: 2.5,
        output: 10,
        input_cache_write: 0,
        input_cache_read: 1.25,
      },
      "anthropic/claude-sonnet-4.5": {
        input: 3,
        output: 15,
        input_cache_write: 3.75,
        input_cache_read: 0.3,
      },
      "google/gemini-2.5-pro": {
        input: 1.25,
        output: 10,
        input_cache_write: 0,
        input_cache_read: 0.125,
      },
      "cf/meta/llama-2-7b-chat-fp16": {
        input: 1.923,
        output: 1.923,
        input_cache_write: 0,
        input_cache_read: 0,
      },
      "grok/grok-4": {
        input: 3,
        output: 15,
        input_cache_write: 0,
        input_cache_read: 0,
      },
    });
  });

  it("prefers the requested provider when multiple providers share the same model key", () => {
    const result = buildInspectCostExport(models, ["bedrock/claude-sonnet-4.5"]);

    expect(result.unresolved).toEqual([]);
    expect(result.costs["bedrock/claude-sonnet-4.5"]).toEqual({
      input: 30,
      output: 150,
      input_cache_write: 0,
      input_cache_read: 0,
    });
  });

  it("includes matched model metadata when debug output is enabled", () => {
    const result = buildInspectCostExport(models, ["anthropic/claude-sonnet-4.5"], {
      includeDebugInfo: true,
    });

    expect(result.unresolved).toEqual([]);
    expect(result.costs["anthropic/claude-sonnet-4.5"]).toEqual({
      input: 3,
      output: 15,
      input_cache_write: 3.75,
      input_cache_read: 0.3,
      _requested_model: "anthropic/claude-sonnet-4.5",
      _matched_key: "claude-sonnet-4-5",
      _matched_provider: "anthropic",
    });
  });

  it("returns candidate keys for unresolved model names", () => {
    const result = buildInspectCostExport(models, ["azureai/Llama-3.3-70B-Instruct"]);

    expect(result.costs).toEqual({});
    expect(result.unresolved).toEqual([
      {
        model: "azureai/Llama-3.3-70B-Instruct",
        candidates: [
          "azureai/Llama-3.3-70B-Instruct",
          "azureai/Llama-3-3-70B-Instruct",
          "azure_ai/Llama-3.3-70B-Instruct",
          "azure_ai/Llama-3-3-70B-Instruct",
        ],
      },
    ]);
  });
});

describe("renderInspectCostsYaml", () => {
  it("renders Inspect cost config as YAML", () => {
    const yaml = renderInspectCostsYaml({
      "openai/gpt-4o": {
        input: 2.5,
        output: 10,
        input_cache_write: 0,
        input_cache_read: 1.25,
      },
    });

    expect(yaml).toBe(
      '"openai/gpt-4o":\n  input: 2.50\n  output: 10.00\n  input_cache_write: 0.00\n  input_cache_read: 1.25\n',
    );
  });

  it("renders matched model metadata in YAML when present", () => {
    const yaml = renderInspectCostsYaml({
      "anthropic/claude-sonnet-4.5": {
        input: 3,
        output: 15,
        input_cache_write: 3.75,
        input_cache_read: 0.3,
        _requested_model: "anthropic/claude-sonnet-4.5",
        _matched_key: "claude-sonnet-4-5",
        _matched_provider: "anthropic",
      },
    });

    expect(yaml).toBe(
      '"anthropic/claude-sonnet-4.5":\n  input: 3.00\n  output: 15.00\n  input_cache_write: 3.75\n  input_cache_read: 0.30\n  _requested_model: "anthropic/claude-sonnet-4.5"\n  _matched_key: "claude-sonnet-4-5"\n  _matched_provider: "anthropic"\n',
    );
  });
});
