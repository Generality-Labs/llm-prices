# LLM Prices

> A filterable, sortable directory of LLM model pricing data sourced from litellm, plus OpenRouter's model list for `openrouter/...` models. Provides a REST API and web UI for exploring costs, context windows, and capabilities across 2,700+ models from 100+ providers.

Data is refreshed every 6 hours from [litellm](https://github.com/BerriAI/litellm) and [OpenRouter](https://openrouter.ai/api/v1/models).

## API

- [List Models]({{BASE}}/api/models): GET — returns paginated model data. Supports query params: q, provider, mode, sort, order, limit, offset, supports, max_input_cost, min_context.
- [List Providers]({{BASE}}/api/providers): GET — returns all available provider names.
- [List Modes]({{BASE}}/api/modes): GET — returns all available model modes (chat, embedding, completion, etc.).
- [Metadata]({{BASE}}/api/meta): GET — returns cache metadata including last refresh timestamp and model count.
- [Inspect Costs]({{BASE}}/api/inspect-costs?model=openai/gpt-4o): GET — returns Inspect-compatible model cost data for one or more requested models. Supports `model`, `models`, and `format=json|yaml`.
- [OpenAPI Spec]({{BASE}}/openapi.json): GET — full OpenAPI 3.0 specification for tool/MCP integration.

## Inspect AI

Retrieve Inspect-compatible pricing data from `/api/inspect-costs` using either repeated `model` params or a comma-separated `models` param.

- JSON example: [`{{BASE}}/api/inspect-costs?model=openai/gpt-4o&model=anthropic/claude-sonnet-4-5`]({{BASE}}/api/inspect-costs?model=openai/gpt-4o&model=anthropic/claude-sonnet-4-5)
- YAML example: [`{{BASE}}/api/inspect-costs?models=openai/gpt-4o,google/gemini-2.5-pro&format=yaml`]({{BASE}}/api/inspect-costs?models=openai/gpt-4o,google/gemini-2.5-pro&format=yaml)
- `curl`: `curl "{{BASE}}/api/inspect-costs?models=openai/gpt-4o,anthropic/claude-sonnet-4-5&format=yaml" -o inspect-costs.yaml`

## MCP

- [MCP Endpoint]({{BASE}}/mcp): Remote MCP server endpoint exposed over Streamable HTTP.
- Tools:
  - `search_models`: Search and filter models using the same provider/mode/query/capability/cost/context filters as the REST API.
  - `list_providers`: List all known providers.
  - `list_modes`: List all known model modes.
  - `get_metadata`: Return the last refresh timestamp and total model count.
- For clients that only support local stdio MCP, use `mcp-remote {{BASE}}/mcp` as a bridge.

## Query Parameters for /api/models

- q: Search across model name and provider. Supports wildcards (*) and multi-term (space-separated, all must match). Examples: `gpt-*-codex`, `claude sonnet`, `gemini pro`
- provider: Filter by provider (e.g. openai, anthropic, gemini, bedrock)
- mode: Filter by mode (e.g. chat, embedding, completion, rerank)
- sort: Sort field (e.g. input_cost_per_token, output_cost_per_token, max_input_tokens, key)
- order: Sort direction (asc or desc)
- limit: Max results to return (default 100, max 10000)
- offset: Pagination offset
- supports: Comma-separated capabilities filter (e.g. supports_function_calling,supports_vision)
- max_input_cost: Max input cost per token (decimal)
- min_context: Minimum context window size in tokens

## Example Queries

- [All OpenAI chat models sorted by input cost]({{BASE}}/api/models?provider=openai&mode=chat&sort=input_cost_per_token&order=asc)
- [Models with vision and function calling under $5/1M input tokens]({{BASE}}/api/models?supports=supports_vision,supports_function_calling&max_input_cost=0.000005&sort=input_cost_per_token&order=asc)
- [All models with 100K+ context]({{BASE}}/api/models?min_context=100000&sort=max_input_tokens&order=desc)
- [Search for "claude"]({{BASE}}/api/models?q=claude&sort=input_cost_per_token&order=asc)

## Response Format

The /api/models endpoint returns JSON:

```json
{
  "total": 2702,
  "limit": 100,
  "offset": 0,
  "data": [
    {
      "key": "openai/gpt-4o",
      "litellm_provider": "openai",
      "mode": "chat",
      "input_cost_per_token": 0.0000025,
      "output_cost_per_token": 0.00001,
      "max_input_tokens": 128000,
      "max_output_tokens": 16384,
      "supports_function_calling": true,
      "supports_vision": true,
      "supports_prompt_caching": true
    }
  ]
}
```
