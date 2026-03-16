import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFilters } from "./api";
import { getMeta, getModels } from "./data";
import { buildInspectCostExport, renderInspectCostsYaml } from "./inspect";
import { Env, FilterParams } from "./types";

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "LLM Prices MCP",
    version: "1.0.0",
  });

  server.registerTool(
    "search_models",
    {
      description:
        "Search and filter LLM models by provider, mode, wildcard query, capabilities, context window, and pricing.",
      inputSchema: z.object({
        q: z.string().optional(),
        provider: z.string().optional(),
        mode: z.string().optional(),
        sort: z.string().optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
        supports: z.string().optional(),
        max_input_cost: z.number().optional(),
        min_context: z.number().int().optional(),
      }),
    },
    async (args) => {
      const params: FilterParams = {
        q: args.q,
        provider: args.provider,
        mode: args.mode,
        sort: args.sort,
        order: args.order,
        limit: args.limit,
        offset: args.offset,
        supports: args.supports,
        max_input_cost: args.max_input_cost,
        min_context: args.min_context,
      };

      const models = await getModels(env);
      const filtered = applyFilters(models, params);
      const total = filtered.length;
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 100;
      const data = filtered.slice(offset, offset + limit);
      const result = {
        total,
        count: data.length,
        offset,
        data,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "export_inspect_costs",
    {
      description:
        "Export Inspect-compatible model cost data for one or more Inspect model names as JSON or YAML.",
      inputSchema: z.object({
        models: z.array(z.string()).min(1),
        format: z.enum(["json", "yaml"]).optional(),
        debug: z.boolean().optional(),
      }),
    },
    async (args) => {
      const models = await getModels(env);
      const result = buildInspectCostExport(models, args.models, {
        includeDebugInfo: args.debug === true,
      });
      const format = args.format ?? "json";

      if (result.unresolved.length > 0) {
        const errorResult = {
          error: "One or more requested models could not be resolved",
          unresolved: result.unresolved,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResult, null, 2),
            },
          ],
          structuredContent: errorResult,
          isError: true,
        };
      }

      if (format === "yaml") {
        const yaml = renderInspectCostsYaml(result.costs);
        return {
          content: [
            {
              type: "text",
              text: yaml,
            },
          ],
          structuredContent: {
            format,
            costs: result.costs,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.costs, null, 2),
          },
        ],
        structuredContent: {
          format,
          costs: result.costs,
        },
      };
    }
  );

  server.registerTool(
    "list_providers",
    {
      description: "List all available LLM providers in the pricing dataset.",
    },
    async () => {
      const models = await getModels(env);
      const providers = [...new Set(models.map((m) => m.litellm_provider))]
        .filter(Boolean)
        .sort();
      const result = { providers };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "list_modes",
    {
      description: "List all available model modes in the pricing dataset.",
    },
    async () => {
      const models = await getModels(env);
      const modes = [...new Set(models.map((m) => m.mode).filter(Boolean))].sort();
      const result = { modes };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "get_metadata",
    {
      description: "Get pricing dataset metadata, including the last refresh timestamp.",
    },
    async () => {
      const [models, meta] = await Promise.all([getModels(env), getMeta(env)]);
      const result = {
        updated_at: meta?.updated_at ?? null,
        model_count: models.length,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  return server;
}

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;
  const server = createServer(env);
  return createMcpHandler(server)(request, env, ctx);
}
