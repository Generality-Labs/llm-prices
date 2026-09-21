import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, ModelEntry } from "../src/types";

vi.mock("../src/data", () => ({
  getMeta: vi.fn(),
  getModels: vi.fn(),
}));

import { applyFilters, handleApiRequest } from "../src/api";
import { getMeta, getModels } from "../src/data";

const models: ModelEntry[] = [
  {
    key: "gpt-4o",
    litellm_provider: "openai",
    mode: "chat",
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 0.00000125,
    supports_vision: true,
    max_input_tokens: 128000,
  },
  {
    key: "claude-sonnet-4-5",
    litellm_provider: "anthropic",
    mode: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
  },
  {
    key: "claude-sonnet-4-5",
    litellm_provider: "bedrock",
    mode: "chat",
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00015,
  },
  {
    key: "gemini/gemini-2.5-pro",
    litellm_provider: "gemini",
    mode: "chat",
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 0.000000125,
    supports_vision: true,
    max_input_tokens: 1048576,
  },
  {
    key: "text-embedding-3-small",
    litellm_provider: "openai",
    mode: "embedding",
    input_cost_per_token: 0.00000002,
    max_input_tokens: 8191,
  },
];

const env = {} as Env;
const mockedGetModels = vi.mocked(getModels);
const mockedGetMeta = vi.mocked(getMeta);

describe("applyFilters", () => {
  it("supports wildcard search, capability filters, and sorting", () => {
    const filtered = applyFilters(models, {
      q: "gpt*",
      supports: "vision",
      sort: "input_cost_per_token",
      order: "asc",
    });

    expect(filtered.map((model) => model.key)).toEqual(["gpt-4o"]);
  });
});

describe("handleApiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetModels.mockResolvedValue(models);
    mockedGetMeta.mockResolvedValue({ updated_at: "2026-03-13T00:00:00.000Z" });
  });

  it("returns Inspect costs as YAML", async () => {
    const response = await handleApiRequest(
      new URL(
        "https://example.com/api/inspect-costs?model=openai/gpt-4o&model=google/gemini-2.5-pro&format=yaml",
      ),
      env,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("application/yaml");
    await expect(response?.text()).resolves.toBe(
      '"openai/gpt-4o":\n  input: 2.50\n  output: 10.00\n  input_cache_write: 0.00\n  input_cache_read: 1.25\n"google/gemini-2.5-pro":\n  input: 1.25\n  output: 10.00\n  input_cache_write: 0.00\n  input_cache_read: 0.125\n',
    );
  });

  it("resolves dotted anthropic model names and keeps provider-specific matches", async () => {
    const response = await handleApiRequest(
      new URL(
        "https://example.com/api/inspect-costs?model=anthropic/claude-sonnet-4.5&model=bedrock/claude-sonnet-4.5",
      ),
      env,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      "anthropic/claude-sonnet-4.5": {
        input: 3,
        output: 15,
        input_cache_write: 3.75,
        input_cache_read: 0.3,
      },
      "bedrock/claude-sonnet-4.5": {
        input: 30,
        output: 150,
        input_cache_write: 0,
        input_cache_read: 0,
      },
    });
  });

  it("includes matched model metadata when inspect debug output is requested", async () => {
    const response = await handleApiRequest(
      new URL("https://example.com/api/inspect-costs?model=anthropic/claude-sonnet-4.5&debug=1"),
      env,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
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
  });

  it("includes matched model metadata in YAML when inspect debug output is requested", async () => {
    const response = await handleApiRequest(
      new URL(
        "https://example.com/api/inspect-costs?model=anthropic/claude-sonnet-4.5&format=yaml&debug=1",
      ),
      env,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe(
      '"anthropic/claude-sonnet-4.5":\n  input: 3.00\n  output: 15.00\n  input_cache_write: 3.75\n  input_cache_read: 0.30\n  _requested_model: "anthropic/claude-sonnet-4.5"\n  _matched_key: "claude-sonnet-4-5"\n  _matched_provider: "anthropic"\n',
    );
  });

  it("returns a 400 when no inspect model names are provided", async () => {
    const response = await handleApiRequest(new URL("https://example.com/api/inspect-costs"), env);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error:
        "At least one model is required. Provide ?model=openai/gpt-4o or ?models=openai/gpt-4o,anthropic/claude-sonnet-4-5",
    });
  });

  it("returns unresolved inspect model names with a 400 response", async () => {
    const response = await handleApiRequest(
      new URL("https://example.com/api/inspect-costs?model=azureai/Llama-3.3-70B-Instruct"),
      env,
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "One or more requested models could not be resolved",
      unresolved: [
        {
          model: "azureai/Llama-3.3-70B-Instruct",
          candidates: [
            "azureai/Llama-3.3-70B-Instruct",
            "azureai/Llama-3-3-70B-Instruct",
            "azure_ai/Llama-3.3-70B-Instruct",
            "azure_ai/Llama-3-3-70B-Instruct",
          ],
        },
      ],
    });
  });

  it("returns null for non-API routes", async () => {
    await expect(handleApiRequest(new URL("https://example.com/"), env)).resolves.toBeNull();
  });
});
