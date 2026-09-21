import { Env } from "./types";
import { fetchAndCache } from "./data";
import { handleApiRequest } from "./api";
import { renderLlmsTxt } from "./llms-txt";
import { handleMcpRequest } from "./mcp";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // The deploy pipeline smoke-tests this endpoint after every deploy — keep
    // it cheap and dependency-free.
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Manual refresh trigger (requires REFRESH_SECRET)
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const token =
        url.searchParams.get("token") ??
        request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.REFRESH_SECRET || token !== env.REFRESH_SECRET) {
        return new Response(
          JSON.stringify({ ok: false, error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        const { count } = await fetchAndCache(env);
        return new Response(
          JSON.stringify({ ok: true, count, refreshed_at: new Date().toISOString() }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(
          JSON.stringify({ ok: false, error: msg }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const mcpResponse = await handleMcpRequest(request, env, _ctx);
    if (mcpResponse) return mcpResponse;

    // API routes
    const apiResponse = await handleApiRequest(url, env);
    if (apiResponse) return apiResponse;

    // llms.txt
    if (url.pathname === "/llms.txt") {
      const base = url.origin;
      return new Response(renderLlmsTxt(base), {
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      fetchAndCache(env).then(({ count }) =>
        console.log(`Refreshed model prices: ${count} models cached`)
      )
    );
  },
};
