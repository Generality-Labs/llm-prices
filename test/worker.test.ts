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

describe("static assets", () => {
  it("serves public/index.html through the ASSETS binding", async () => {
    const res = await env.ASSETS.fetch(new Request("https://example.com/index.html"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });
});
