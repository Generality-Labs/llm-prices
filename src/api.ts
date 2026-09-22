import { getMeta, getModels } from "./data";
import { buildInspectCostExport, renderInspectCostsYaml } from "./inspect";
import type { Env, FilterParams, ModelEntry } from "./types";

function parseFilterParams(url: URL): FilterParams {
  const params: FilterParams = {};
  const p = url.searchParams;

  // biome-ignore-start lint/style/noNonNullAssertion: each get() is guarded by the has() check on the same line
  if (p.has("provider")) params.provider = p.get("provider")!;
  if (p.has("mode")) params.mode = p.get("mode")!;
  if (p.has("q")) params.q = p.get("q")!;
  if (p.has("sort")) params.sort = p.get("sort")!;
  if (p.has("order")) params.order = p.get("order") === "asc" ? "asc" : "desc";
  if (p.has("limit")) params.limit = parseInt(p.get("limit")!, 10);
  if (p.has("offset")) params.offset = parseInt(p.get("offset")!, 10);
  if (p.has("supports")) params.supports = p.get("supports")!;
  if (p.has("max_input_cost")) params.max_input_cost = parseFloat(p.get("max_input_cost")!);
  if (p.has("min_context")) params.min_context = parseInt(p.get("min_context")!, 10);
  // biome-ignore-end lint/style/noNonNullAssertion: each get() is guarded by the has() check on the same line

  return params;
}

export function applyFilters(models: ModelEntry[], params: FilterParams): ModelEntry[] {
  let result = models;

  if (params.provider) {
    const prov = params.provider.toLowerCase();
    result = result.filter((m) => m.litellm_provider?.toLowerCase() === prov);
  }

  if (params.mode) {
    const mode = params.mode.toLowerCase();
    result = result.filter((m) => m.mode?.toLowerCase() === mode);
  }

  if (params.q) {
    const terms = params.q.toLowerCase().split(/\s+/).filter(Boolean);
    const matchers = terms.map((term) => {
      if (term.includes("*")) {
        const pattern = term.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
        const re = new RegExp(pattern);
        return (s: string) => re.test(s);
      }
      return (s: string) => s.includes(term);
    });
    result = result.filter((m) => {
      const haystack = `${m.key.toLowerCase()} ${m.litellm_provider?.toLowerCase() ?? ""}`;
      return matchers.every((fn) => fn(haystack));
    });
  }

  if (params.supports) {
    const flags = params.supports.split(",").map((s) => s.trim());
    result = result.filter((m) =>
      flags.every((flag) => {
        const key = flag.startsWith("supports_") ? flag : `supports_${flag}`;
        return (m as Record<string, unknown>)[key] === true;
      }),
    );
  }

  if (params.max_input_cost !== undefined) {
    result = result.filter(
      (m) =>
        // biome-ignore lint/style/noNonNullAssertion: narrowed by the enclosing `!== undefined` check; TS can't see through the closure
        m.input_cost_per_token !== undefined && m.input_cost_per_token <= params.max_input_cost!,
    );
  }

  if (params.min_context !== undefined) {
    result = result.filter((m) => {
      const ctx = m.max_input_tokens ?? m.max_tokens ?? 0;
      // biome-ignore lint/style/noNonNullAssertion: narrowed by the enclosing `!== undefined` check; TS can't see through the closure
      return ctx >= params.min_context!;
    });
  }

  if (params.sort) {
    const sortKey = params.sort as keyof ModelEntry;
    const dir = params.order === "asc" ? 1 : -1;
    result.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  return result;
}

function paginate(
  models: ModelEntry[],
  params: FilterParams,
): { data: ModelEntry[]; total: number } {
  const total = models.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 100;
  return { data: models.slice(offset, offset + limit), total };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function text(data: string, contentType: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function parseInspectModelParams(url: URL): string[] {
  const requested = [
    ...url.searchParams.getAll("model"),
    ...url.searchParams.getAll("models").flatMap((value) => value.split(",")),
  ];

  return requested.map((value) => value.trim()).filter(Boolean);
}

export async function handleApiRequest(url: URL, env: Env): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/api/models") {
    const models = await getModels(env);
    const params = parseFilterParams(url);
    const filtered = applyFilters(models, params);
    const { data, total } = paginate(filtered, params);
    return json({
      total,
      count: data.length,
      offset: params.offset ?? 0,
      data,
    });
  }

  if (path === "/api/providers") {
    const models = await getModels(env);
    const providers = [...new Set(models.map((m) => m.litellm_provider))].sort();
    return json({ providers });
  }

  if (path === "/api/modes") {
    const models = await getModels(env);
    const modes = [...new Set(models.map((m) => m.mode).filter(Boolean))].sort();
    return json({ modes });
  }

  if (path === "/api/meta") {
    const meta = await getMeta(env);
    return json(meta ?? { updated_at: null });
  }

  if (path === "/api/inspect-costs") {
    const requestedModels = parseInspectModelParams(url);
    if (requestedModels.length === 0) {
      return json(
        {
          error:
            "At least one model is required. Provide ?model=openai/gpt-4o or ?models=openai/gpt-4o,anthropic/claude-sonnet-4-5",
        },
        400,
      );
    }

    const format = url.searchParams.get("format")?.toLowerCase() ?? "json";
    if (format !== "json" && format !== "yaml") {
      return json({ error: "format must be either 'json' or 'yaml'" }, 400);
    }

    const debug = url.searchParams.get("debug") === "1";

    const models = await getModels(env);
    const result = buildInspectCostExport(models, requestedModels, {
      includeDebugInfo: debug,
    });

    if (result.unresolved.length > 0) {
      return json(
        {
          error: "One or more requested models could not be resolved",
          unresolved: result.unresolved,
        },
        400,
      );
    }

    if (format === "yaml") {
      return text(renderInspectCostsYaml(result.costs), "application/yaml; charset=utf-8");
    }

    return json(result.costs);
  }

  if (path === "/api/refresh") {
    // Manual refresh — returns immediately, cron does the real work
    return json({ message: "Use cron trigger to refresh data" });
  }

  if (path === "/openapi.json") {
    return json(openApiSpec(url));
  }

  return null;
}

function openApiSpec(url: URL) {
  const base = `${url.protocol}//${url.host}`;
  return {
    openapi: "3.1.0",
    info: {
      title: "LLM Prices API",
      description:
        "Query LLM model pricing, context windows, and capabilities. Data sourced from litellm.",
      version: "1.0.0",
    },
    servers: [{ url: base }],
    paths: {
      "/api/models": {
        get: {
          operationId: "listModels",
          summary: "List and filter LLM models with pricing info",
          parameters: [
            {
              name: "provider",
              in: "query",
              schema: { type: "string" },
              description: "Filter by provider (e.g. openai, anthropic, bedrock)",
            },
            {
              name: "mode",
              in: "query",
              schema: { type: "string" },
              description: "Filter by mode (chat, embedding, completion, image_generation, etc.)",
            },
            {
              name: "q",
              in: "query",
              schema: { type: "string" },
              description: "Search model name or provider",
            },
            {
              name: "sort",
              in: "query",
              schema: { type: "string" },
              description: "Sort by field (e.g. input_cost_per_token, max_input_tokens)",
            },
            {
              name: "order",
              in: "query",
              schema: { type: "string", enum: ["asc", "desc"] },
              description: "Sort order (default: desc)",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
              description: "Max results to return",
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
              description: "Offset for pagination",
            },
            {
              name: "supports",
              in: "query",
              schema: { type: "string" },
              description:
                "Comma-separated capability filters (e.g. vision,function_calling,reasoning)",
            },
            {
              name: "max_input_cost",
              in: "query",
              schema: { type: "number" },
              description: "Max input cost per token",
            },
            {
              name: "min_context",
              in: "query",
              schema: { type: "integer" },
              description: "Minimum context window size (tokens)",
            },
          ],
          responses: {
            "200": {
              description: "Filtered list of models",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      count: { type: "integer" },
                      offset: { type: "integer" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Model" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/providers": {
        get: {
          operationId: "listProviders",
          summary: "List all available providers",
          responses: {
            "200": {
              description: "List of provider names",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      providers: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/modes": {
        get: {
          operationId: "listModes",
          summary: "List all available model modes",
          responses: {
            "200": {
              description: "List of mode names",
            },
          },
        },
      },
      "/api/meta": {
        get: {
          operationId: "getMeta",
          summary: "Get metadata about the cached data",
          responses: {
            "200": {
              description: "Cache metadata including last update time",
            },
          },
        },
      },
      "/api/inspect-costs": {
        get: {
          operationId: "getInspectModelCosts",
          summary: "Export Inspect-compatible model cost data as JSON or YAML",
          parameters: [
            {
              name: "model",
              in: "query",
              schema: { type: "string" },
              description: "Inspect model name. Repeat the parameter to request multiple models.",
            },
            {
              name: "models",
              in: "query",
              schema: { type: "string" },
              description:
                "Comma-separated Inspect model names. Alternative to repeated model parameters.",
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["json", "yaml"], default: "json" },
              description: "Export format. YAML output is suitable for --model-cost-config.",
            },
          ],
          responses: {
            "200": {
              description: "Inspect-compatible model cost configuration",
            },
            "400": {
              description: "Invalid request or unresolved model names",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Model: {
          type: "object",
          properties: {
            key: { type: "string", description: "Model identifier" },
            litellm_provider: { type: "string" },
            mode: { type: "string" },
            max_tokens: { type: "integer" },
            max_input_tokens: { type: "integer" },
            max_output_tokens: { type: "integer" },
            input_cost_per_token: { type: "number" },
            output_cost_per_token: { type: "number" },
            supports_function_calling: { type: "boolean" },
            supports_vision: { type: "boolean" },
            supports_reasoning: { type: "boolean" },
            supports_prompt_caching: { type: "boolean" },
          },
        },
      },
    },
  };
}
