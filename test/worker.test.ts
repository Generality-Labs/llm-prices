import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
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

describe("static assets", () => {
  it("serves public/index.html through the ASSETS binding", async () => {
    const res = await env.ASSETS.fetch(new Request("https://example.com/index.html"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
