# LLM Prices

A Cloudflare Worker that caches [litellm's model pricing data](https://github.com/BerriAI/litellm) and provides:

- **Web UI** — filterable, sortable table of all LLM model prices
- **REST API** — query models by provider, mode, capabilities, cost, and context window
- **MCP server** — native remote MCP endpoint at `/mcp`
- **OpenAPI spec** — at `/openapi.json` for integration with LLM tools and MCP clients

Data is refreshed automatically every 6 hours via cron trigger. Zero ongoing cost on Cloudflare's free tier.

Production deployment:

```text
https://llm-prices.generality.org/
```

## Quick Start

Requires Node 26 or later for the toolchain (`nvm use` reads `.nvmrc`); `npm install` refuses older versions. The Worker itself runs on workerd.

```bash
# Install dependencies
npm install

# Run locally
npm run dev
```

On first run, visit `http://localhost:8787` — the table will be empty until data is loaded. Trigger a data refresh by calling the scheduled handler (wrangler dev supports this via the dashboard).

## Deploy

The repository is [Generality-Labs/llm-prices](https://github.com/Generality-Labs/llm-prices). The Worker and its `MODEL_PRICES` KV namespace live in the Generality Labs Cloudflare account; `wrangler.toml` declares the production environment (account, namespace id, custom domain, six-hour refresh schedule). The top level of `wrangler.toml` is local development and tests only.

### CI and deployment

Pull requests and pushes to `main` run type-checking, the unit and worker-runtime tests, a `wrangler deploy --dry-run` bundle check, and the pre-commit stack (Biome, zizmor, actionlint, mdformat) through the shared [`worker-ci`](https://github.com/Generality-Labs/cloudflare-worker-template) workflow.

Every push to `main` then deploys production through the shared `worker-deploy` workflow and smoke-tests `GET /health`. Two repository secrets are required:

- `CLOUDFLARE_API_TOKEN` — an account-owned token with **Workers Editor** at the Workers product scope, plus **Zone > Zone > Read** and **Zone > Workers Routes > Write** on `generality.org` (wrangler resolves the zone for the custom domain on every deploy).
- `CLOUDFLARE_ACCOUNT_ID` — the Generality Labs account id.

Set the `HEALTH_URL` variable on the `production` GitHub environment to `https://llm-prices.generality.org/health` to enable the post-deploy check.

**Template pin.** `.copier-answers.yml`'s `_commit` records the template revision this repo was adopted from; after the template's `v1.1.0` release it must point at that tag.

Cloudflare Workers Builds is no longer used. Disconnect the Builds connection on the `llm-prices` Worker (**Settings > Builds**) before merging a change that introduces the named environments: Builds runs a bare `npx wrangler deploy`, which now resolves the local-only top-level config and would create a stray `llm-prices-dev` Worker instead of deploying production.

### Compatibility with existing clients

Keep the personal-account Worker at `https://llm-prices.llm-prices.workers.dev` running with its KV namespace and six-hour refresh schedule until existing clients have migrated. Older installations of [Inspect Costs Plugin](https://github.com/jasongwartz/inspect_costs_plugin) use that endpoint, and their HTTP client does not follow redirects. The old endpoint must continue returning pricing responses directly. Merging the plugin's URL update alone does not update existing installations.

### Manual deployment

Authenticate with the Generality Labs Cloudflare account using `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` in your shell. Push the Worker's secrets with `npm run secrets` from a gitignored `.dev.vars.production` containing `REFRESH_SECRET=...` (see `.dev.vars.example`), then deploy:

```bash
npm ci && npm run typecheck && npm test && npm run deploy
```

`npm run deploy` runs `wrangler deploy --env production`, the named environment in `wrangler.toml` that carries the real KV namespace, route, and cron trigger. A bare `wrangler deploy` (no `--env`) reads the top-level, local-only configuration instead and would create a separate `llm-prices-dev` Worker rather than touching production.

### Refresh pricing data

The Worker refreshes pricing automatically every six hours. To populate a new deployment immediately, push the secret with `npm run secrets`, which reads a gitignored `.dev.vars.production` file containing:

```dotenv
REFRESH_SECRET=your-refresh-secret
```

Then run:

```bash
npm run refresh
```

`npm run refresh` reads the same `.dev.vars.production` file (falling back to the older `.env` location) and sends the secret in an Authorization header to `https://llm-prices.generality.org/api/refresh`.

## API

### `GET /health`

Returns `{"status":"ok"}`. Used by the post-deploy smoke test.

### `GET /api/models`

Query parameters:

| Param            | Description                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `q`              | Search model name or provider; supports wildcards like `gpt-*-codex` and multi-term queries like `claude sonnet` |
| `provider`       | Filter by provider (e.g. `openai`, `anthropic`)                                                                  |
| `mode`           | Filter by mode (`chat`, `embedding`, `completion`, etc.)                                                         |
| `supports`       | Comma-separated capabilities (`vision`, `function_calling`, `reasoning`, `prompt_caching`)                       |
| `max_input_cost` | Max input cost per token                                                                                         |
| `min_context`    | Minimum context window (tokens)                                                                                  |
| `sort`           | Sort field (e.g. `input_cost_per_token`, `max_input_tokens`)                                                     |
| `order`          | `asc` or `desc`                                                                                                  |
| `limit`          | Results per page (default 100)                                                                                   |
| `offset`         | Pagination offset                                                                                                |

### `GET /api/providers`

List all available providers.

### `GET /api/modes`

List all available model modes.

### `GET /api/meta`

Cache metadata (last update time).

### `GET /api/inspect-costs`

Export Inspect-compatible model pricing as JSON or YAML.

Query parameters:

| Param    | Description                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `model`  | Inspect model name. Repeat the parameter to request multiple models.             |
| `models` | Comma-separated Inspect model names. Alternative to repeated `model` parameters. |
| `format` | `json` or `yaml` (default `json`). Use `yaml` for `--model-cost-config`.         |

The response format matches Inspect's `ModelCost` object shape:

- `input`
- `output`
- `input_cache_write`
- `input_cache_read`

All values are returned in dollars per million tokens.

Examples:

```bash
curl "https://llm-prices.generality.org/api/inspect-costs?model=openai/gpt-4o&model=anthropic/claude-sonnet-4-5&format=yaml" -o pricing.yaml
```

```bash
inspect eval ctf.py --model-cost-config pricing.yaml --cost-limit 2.00
```

```bash
curl "https://llm-prices.generality.org/api/inspect-costs?models=openai/gpt-4o,google/gemini-2.5-pro,openrouter/gryphe/mythomax-l2-13b&format=json" -o pricing.json
```

If you want a Claude, GPT, or Gemini model but are not sure which exact model key to use, search the catalog first and pick the model yourself. You can also add `sort` (for example `sort=key&order=desc` or `sort=input_cost_per_token&order=asc`) to make the list easier to scan:

```bash
curl "https://llm-prices.generality.org/api/models?provider=anthropic&q=claude&sort=key&order=desc"
```

```bash
curl "https://llm-prices.generality.org/api/models?provider=openai&q=gpt&sort=key&order=desc"
```

```bash
curl "https://llm-prices.generality.org/api/models?provider=gemini&q=gemini&sort=key&order=desc"
```

Then request Inspect-formatted pricing for the exact model you selected:

```bash
curl "https://llm-prices.generality.org/api/inspect-costs?model=anthropic/claude-sonnet-4-5&format=yaml" -o pricing.yaml
```

If you want to confirm which cached dataset key was matched, add `debug=1`:

```bash
curl "https://llm-prices.generality.org/api/inspect-costs?model=anthropic/claude-sonnet-4-5&format=yaml&debug=1" -o pricing-debug.yaml
```

Provider naming notes:

- Use Inspect-style provider prefixes such as `openai`, `anthropic`, `google`, `openrouter`, `groq`, `ollama`, `bedrock`, `azureai`, `cf`, `fireworks`, `together`, and `perplexity`.
- The service maps common Inspect names to LiteLLM dataset keys where they differ, for example:
  - `google/...` -> `gemini/...`
  - `azureai/...` -> `azure_ai/...`
  - `cf/...` -> `cloudflare/@cf/...`
  - `groq/...` -> `xai/...` is **not** applied; `groq/...` resolves against Groq dataset keys, while `grok/...` resolves against xAI keys
  - `fireworks/...` -> `fireworks_ai/...`
  - `together/...` -> `together_ai/...`
- If a model name cannot be resolved, the API returns a `400` with the unresolved model names and the candidate dataset keys it tried.

### `GET /openapi.json`

OpenAPI 3.1 spec for tool/MCP integration.

## MCP

### `POST /mcp`

Remote MCP server endpoint exposed over Streamable HTTP.

Available tools:

- `search_models` — search and filter models using the same provider/mode/query/capability/cost/context filters as the REST API
- `export_inspect_costs` — export Inspect-compatible model cost config for one or more Inspect model names as JSON or YAML
- `list_providers` — list all known providers
- `list_modes` — list all known model modes
- `get_metadata` — return the last refresh timestamp and total model count

For clients that support remote MCP directly, use:

```text
https://llm-prices.generality.org/mcp
```

For clients that only support local stdio MCP, bridge with `mcp-remote`:

```json
{
  "mcpServers": {
    "llm-prices": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://llm-prices.generality.org/mcp"
      ]
    }
  }
}
```

## Using with LLMs / OpenAPI

The `/openapi.json` endpoint can be used directly with clients that support OpenAPI-based tool import.

Example: find the cheapest chat models with vision support and 100K+ context:

```text
GET /api/models?mode=chat&supports=vision&min_context=100000&sort=input_cost_per_token&order=asc&limit=10
```

## License

MIT
