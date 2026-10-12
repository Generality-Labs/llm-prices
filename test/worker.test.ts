import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAndCache, getModels } from "../src/data";
import worker from "../src/index";

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("404s unknown paths", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/nope"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});

describe("KV binding", () => {
  it("round-trips a value", async () => {
    await env.MODEL_PRICES.put("smoke-test-key", "hello");
    expect(await env.MODEL_PRICES.get("smoke-test-key")).toBe("hello");
  });
});

describe("POST /api/refresh", () => {
  it("is unauthorised without REFRESH_SECRET configured", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/refresh", {
        method: "POST",
        headers: { Authorization: "Bearer anything" },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("GET /api/models with data in KV", () => {
  it("serves cached models", async () => {
    // Raw upstream shape: a map of model key -> entry, with a "sample_spec"
    // key that getModels() skips. See src/data.ts.
    await env.MODEL_PRICES.put(
      "model_prices",
      JSON.stringify({
        sample_spec: { litellm_provider: "sample", mode: "chat" },
        "gpt-4o": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 0.0000025 },
      }),
    );
    await env.MODEL_PRICES.put(
      "model_prices_meta",
      JSON.stringify({ updated_at: "2026-09-21T00:00:00.000Z" }),
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/api/models"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      count: number;
      offset: number;
      data: Array<{ key: string; litellm_provider: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.data).toEqual([
      { key: "gpt-4o", litellm_provider: "openai", mode: "chat", input_cost_per_token: 0.0000025 },
    ]);
  });
});

describe("fetchAndCache", () => {
  const litellm = {
    sample_spec: { litellm_provider: "sample", mode: "chat" },
    "gpt-4o": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 0.0000025 },
  };
  const openrouter = {
    data: [
      {
        id: "openai/gpt-oss-20b",
        context_length: 131072,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        pricing: { prompt: "0.000000018", completion: "0.00000009" },
        top_provider: { context_length: 131072, max_completion_tokens: 32768 },
        supported_parameters: [],
      },
    ],
  };

  function stubSources(openrouterResponse: Response): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.startsWith("https://openrouter.ai/") ? openrouterResponse : Response.json(litellm);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches LiteLLM and OpenRouter rows together", async () => {
    stubSources(Response.json(openrouter));

    expect(await fetchAndCache(env)).toEqual({ count: 2 });

    const models = await getModels(env);
    expect(models.map((m) => m.key)).toEqual(["gpt-4o", "openrouter/openai/gpt-oss-20b"]);
  });

  it("keeps the previous cache when OpenRouter is unavailable", async () => {
    await env.MODEL_PRICES.put("model_prices", JSON.stringify({ previous: {} }));
    stubSources(new Response("unavailable", { status: 503 }));

    await expect(fetchAndCache(env)).rejects.toThrow("503");
    expect(await env.MODEL_PRICES.get("model_prices")).toBe(JSON.stringify({ previous: {} }));
  });
});

describe("static assets", () => {
  it("serves public/index.html through the ASSETS binding", async () => {
    const res = await env.ASSETS.fetch(new Request("https://example.com/index.html"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
