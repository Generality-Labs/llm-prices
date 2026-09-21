import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, ModelEntry } from "../src/types";

vi.mock("agents/mcp", () => ({
  createMcpHandler: vi.fn(),
}));

vi.mock("../src/data", () => ({
  getMeta: vi.fn(),
  getModels: vi.fn(),
}));

import { getMeta, getModels } from "../src/data";
import { createServer } from "../src/mcp";

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
];

const env = {} as Env;
const mockedGetModels = vi.mocked(getModels);
const mockedGetMeta = vi.mocked(getMeta);

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetModels.mockResolvedValue(models);
    mockedGetMeta.mockResolvedValue({ updated_at: "2026-03-13T00:00:00.000Z" });
  });

  it("registers export_inspect_costs and returns YAML output", async () => {
    const server = createServer(env) as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
    };

    const result = (await server._registeredTools.export_inspect_costs.handler({
      models: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5"],
      format: "yaml",
    })) as {
      content: Array<{ text: string }>;
      structuredContent: { format: string; costs: Record<string, unknown> };
    };

    expect(result.structuredContent.format).toBe("yaml");
    expect(result.structuredContent.costs).toEqual({
      "openai/gpt-4o": {
        input: 2.5,
        output: 10,
        input_cache_write: 0,
        input_cache_read: 1.25,
      },
      "anthropic/claude-sonnet-4-5": {
        input: 3,
        output: 15,
        input_cache_write: 3.75,
        input_cache_read: 0.3,
      },
    });
    expect(result.content[0]?.text).toContain('"openai/gpt-4o":');
  });

  it("includes matched model metadata when MCP debug output is requested", async () => {
    const server = createServer(env) as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
    };

    const result = (await server._registeredTools.export_inspect_costs.handler({
      models: ["anthropic/claude-sonnet-4-5"],
      format: "json",
      debug: true,
    })) as {
      structuredContent: { format: string; costs: Record<string, unknown> };
    };

    expect(result.structuredContent).toEqual({
      format: "json",
      costs: {
        "anthropic/claude-sonnet-4-5": {
          input: 3,
          output: 15,
          input_cache_write: 3.75,
          input_cache_read: 0.3,
          _requested_model: "anthropic/claude-sonnet-4-5",
          _matched_key: "claude-sonnet-4-5",
          _matched_provider: "anthropic",
        },
      },
    });
  });

  it("returns MCP errors for unresolved inspect model names", async () => {
    const server = createServer(env) as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
    };

    const result = (await server._registeredTools.export_inspect_costs.handler({
      models: ["google/gemini-2.5-pro"],
      format: "json",
    })) as {
      isError?: boolean;
      structuredContent: unknown;
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: "One or more requested models could not be resolved",
      unresolved: [
        {
          model: "google/gemini-2.5-pro",
          candidates: [
            "google/gemini-2.5-pro",
            "google/gemini-2-5-pro",
            "gemini/gemini-2.5-pro",
            "gemini/gemini-2-5-pro",
          ],
        },
      ],
    });
  });
});
