import type { ModelEntry } from "./types";

export interface InspectModelCost {
  input: number;
  output: number;
  input_cache_write: number;
  input_cache_read: number;
  _requested_model?: string;
  _matched_key?: string;
  _matched_provider?: string;
}

export interface InspectResolutionError {
  model: string;
  candidates: string[];
}

export interface InspectExportResult {
  costs: Record<string, InspectModelCost>;
  unresolved: InspectResolutionError[];
}

export interface InspectExportOptions {
  includeDebugInfo?: boolean;
}

/**
 * Inspect provider names do not always line up with the LiteLLM provider names
 * used in the cached dataset. This table captures the common provider-level
 * rewrites before model-level resolution happens.
 */
const PROVIDER_ALIASES: Record<string, string> = {
  azureai: "azure_ai",
  cf: "cloudflare",
  fireworks: "fireworks_ai",
  google: "gemini",
  grok: "xai",
  together: "together_ai",
};

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

function costPerMillion(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? roundCost(value * 1_000_000) : 0;
}

function splitInspectModelName(modelName: string): {
  provider: string | null;
  model: string;
} {
  const trimmed = modelName.trim();
  const slash = trimmed.indexOf("/");

  if (slash === -1) {
    return { provider: null, model: trimmed };
  }

  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

/**
 * Adds a candidate lookup key and, when helpful, a punctuation-normalized
 * variant. This is primarily used for model versions such as `4.5` vs `4-5`.
 */
function addCandidate(candidates: Set<string>, candidate: string): void {
  if (!candidate) {
    return;
  }

  candidates.add(candidate);

  if (candidate.includes(".")) {
    candidates.add(candidate.replace(/\./g, "-"));
  }
}

/**
 * Normalizes model identifiers for fuzzy comparison when exact key matching is
 * not enough. The goal is to be tolerant of `.`, `_`, and `-` differences while
 * still keeping provider segments intact.
 */
function normalizeForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split("/")
    .map((segment) => segment.replace(/[._-]+/g, "-"))
    .join("/");
}

/**
 * Returns the LiteLLM provider key that should be used for provider-scoped
 * matching.
 */
function providerAlias(provider: string): string {
  return PROVIDER_ALIASES[provider.toLowerCase()] ?? provider.toLowerCase();
}

function splitModelSegments(modelName: string): string[] {
  return modelName
    .trim()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function preferredProvidersForInspectModel(modelName: string): string[] {
  const [provider = "", qualifier = "", subqualifier = ""] = splitModelSegments(modelName).map(
    (segment) => segment.toLowerCase(),
  );

  if (provider === "openai" && qualifier === "azure") {
    return ["azure", "openai"];
  }

  if (provider === "anthropic" && qualifier === "bedrock") {
    return ["bedrock", "bedrock_converse"];
  }

  if (provider === "anthropic" && qualifier === "vertex") {
    return ["vertex_ai-anthropic_models"];
  }

  if (provider === "anthropic" && qualifier === "azure") {
    return ["azure_ai", "anthropic"];
  }

  if (provider === "google" && qualifier === "vertex") {
    return ["vertex_ai-language-models", "gemini"];
  }

  if (provider === "mistral" && qualifier === "azure") {
    return ["azure_ai", "mistral"];
  }

  if (provider === "together" && qualifier === "minimaxai") {
    return ["minimax", "together_ai"];
  }

  if (provider === "openai-api" && qualifier) {
    return [providerAlias(qualifier), qualifier];
  }

  if (provider === "hf-inference-providers" && qualifier) {
    const selectedProvider = subqualifier.split(":")[1];
    if (selectedProvider) {
      return [providerAlias(selectedProvider), selectedProvider];
    }
  }

  return [providerAlias(provider)];
}

function formatYamlNumber(value: number): string {
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/u, "$1");

  if (trimmed.endsWith(".000000")) {
    return `${value.toFixed(2)}`;
  }

  if (/^\d+\.\d$/u.test(trimmed)) {
    return `${trimmed}0`;
  }

  if (/^\d+$/u.test(trimmed)) {
    return `${trimmed}.00`;
  }

  return trimmed;
}

/**
 * Expands a requested Inspect model name into the set of dataset keys that are
 * plausible matches. The first candidates preserve the user-supplied provider
 * prefix, and provider-specific rewrites add the equivalent LiteLLM forms.
 */
function candidateKeysForInspectModel(modelName: string): string[] {
  const trimmed = modelName.trim();
  const { provider, model } = splitInspectModelName(trimmed);
  const candidates = new Set<string>();
  const segments = splitModelSegments(trimmed);
  const qualifier = segments[1]?.toLowerCase();
  const lastSegment = segments.at(-1) ?? "";

  if (!trimmed) {
    return [];
  }

  addCandidate(candidates, trimmed);

  if (!provider) {
    return [...candidates];
  }

  const providerLower = provider.toLowerCase();
  const aliasedProvider = providerAlias(providerLower);

  switch (providerLower) {
    case "openai":
      if (qualifier === "azure") {
        const deployment = segments.slice(2).join("/");
        addCandidate(candidates, deployment);
        addCandidate(candidates, `azure/${deployment}`);
        addCandidate(candidates, `openai/${deployment}`);
        break;
      }

      addCandidate(candidates, model);
      break;

    case "anthropic":
      if (qualifier === "bedrock") {
        const bedrockModel = segments.slice(2).join("/");
        addCandidate(candidates, bedrockModel);
        addCandidate(candidates, `bedrock/${bedrockModel}`);
        break;
      }

      if (qualifier === "vertex") {
        const vertexModel = segments.slice(2).join("/");
        addCandidate(candidates, vertexModel);
        addCandidate(candidates, `vertex_ai/${vertexModel}`);
        break;
      }

      if (qualifier === "azure") {
        const deployment = segments.slice(2).join("/");
        addCandidate(candidates, deployment);
        addCandidate(candidates, `azure_ai/${deployment}`);
        break;
      }

      addCandidate(candidates, model);
      break;

    case "bedrock":
    case "bedrock_converse":
    case "bedrock-converse":
      addCandidate(candidates, model);
      break;

    case "google":
      if (qualifier === "vertex") {
        const vertexModel = segments.slice(2).join("/");
        addCandidate(candidates, vertexModel);
        addCandidate(candidates, `vertex_ai/${vertexModel}`);
        addCandidate(candidates, `gemini/${vertexModel}`);
        break;
      }

      addCandidate(candidates, `gemini/${model}`);
      break;

    case "azureai":
      addCandidate(candidates, `azure_ai/${model}`);
      break;

    case "cf":
      addCandidate(candidates, `cloudflare/@cf/${model}`);
      addCandidate(candidates, `cloudflare/${model}`);
      addCandidate(candidates, `@cf/${model}`);
      break;

    case "together":
      addCandidate(candidates, `together_ai/${model}`);
      addCandidate(candidates, model);
      if (qualifier === "minimaxai") {
        addCandidate(candidates, `minimax/${lastSegment}`);
        addCandidate(candidates, lastSegment);
      }
      break;

    case "fireworks":
      addCandidate(candidates, `fireworks_ai/${model}`);
      addCandidate(candidates, model);
      break;

    case "grok":
      addCandidate(candidates, `xai/${model}`);
      addCandidate(candidates, model);
      break;

    case "deepseek":
      addCandidate(candidates, `deepseek/${model}`);
      addCandidate(candidates, model);
      break;

    case "mistral":
      if (qualifier === "azure") {
        const deployment = segments.slice(2).join("/");
        addCandidate(candidates, deployment);
        addCandidate(candidates, `azure_ai/${deployment}`);
        addCandidate(candidates, `mistral/${deployment}`);
        break;
      }

      addCandidate(candidates, `${aliasedProvider}/${model}`);
      addCandidate(candidates, model);
      break;

    case "openai-api": {
      const compatProvider = segments[1];
      const compatModel = segments.slice(2).join("/");
      addCandidate(candidates, compatModel);
      addCandidate(candidates, `${compatProvider}/${compatModel}`);
      if (compatProvider) {
        addCandidate(candidates, `${providerAlias(compatProvider)}/${compatModel}`);
      }
      break;
    }

    case "hf-inference-providers": {
      const baseProvider = segments[1];
      const rawModel = segments.slice(2).join("/");
      const [baseModel, selectedProvider] = rawModel.split(":");

      addCandidate(candidates, `${baseProvider}/${baseModel}`);
      addCandidate(candidates, baseModel);

      if (selectedProvider) {
        addCandidate(candidates, `${selectedProvider}/${baseModel}`);
        addCandidate(candidates, `${selectedProvider}/${baseProvider}/${baseModel}`);
      }
      break;
    }

    default:
      addCandidate(candidates, `${aliasedProvider}/${model}`);
      addCandidate(candidates, model);
      break;
  }

  return [...candidates];
}

/**
 * Tries exact key matches first, then falls back to punctuation-normalized
 * comparisons. This keeps resolution deterministic while still handling common
 * naming differences between Inspect and LiteLLM.
 */
function findMatchingModel(models: ModelEntry[], candidates: string[]): ModelEntry | null {
  const exactCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()));

  for (const model of models) {
    if (exactCandidates.has(model.key.toLowerCase())) {
      return model;
    }
  }

  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeForComparison(candidate)),
  );

  for (const model of models) {
    if (normalizedCandidates.has(normalizeForComparison(model.key))) {
      return model;
    }
  }

  const rankedPrefixMatches = models
    .map((model) => {
      const normalizedKey = normalizeForComparison(model.key);
      let bestScore: [number, number] | null = null;

      for (const candidate of normalizedCandidates) {
        if (!normalizedKey.startsWith(`${candidate}-`)) {
          continue;
        }

        const suffix = normalizedKey.slice(candidate.length + 1);
        const score: [number, number] = /^(latest|preview|\d{3,}|\d{4}-\d{2}-\d{2}|v\d.*)$/u.test(
          suffix,
        )
          ? [0, normalizedKey.length]
          : [/^\d$/u.test(suffix) ? 2 : 1, normalizedKey.length];

        if (
          !bestScore ||
          score[0] < bestScore[0] ||
          (score[0] === bestScore[0] && score[1] < bestScore[1])
        ) {
          bestScore = score;
        }
      }

      return bestScore ? { model, score: bestScore } : null;
    })
    .filter((value): value is { model: ModelEntry; score: [number, number] } => value !== null)
    .sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1]);

  if (rankedPrefixMatches.length > 0) {
    return rankedPrefixMatches[0]?.model ?? null;
  }

  return null;
}

/**
 * Resolves a requested Inspect model name against the cached model dataset.
 * When the request includes a provider, resolution is intentionally scoped to
 * that provider first so that overlapping model keys across providers do not
 * silently return the wrong entry.
 */
function findModelByCandidates(models: ModelEntry[], modelName: string): ModelEntry | null {
  const candidates = candidateKeysForInspectModel(modelName);
  const { provider, model } = splitInspectModelName(modelName);
  if (!provider) {
    return findMatchingModel(models, candidates);
  }

  const preferredProviders = preferredProvidersForInspectModel(modelName);
  const providerModels = models.filter(
    (entry) =>
      entry.litellm_provider && preferredProviders.includes(entry.litellm_provider.toLowerCase()),
  );
  const providerMatch = findMatchingModel(providerModels, candidates);
  if (providerMatch) {
    return providerMatch;
  }

  const normalizedModel = normalizeForComparison(model);
  for (const entry of providerModels) {
    if (normalizeForComparison(entry.key) === normalizedModel) {
      return entry;
    }
  }

  return null;
}

/**
 * Converts LiteLLM's per-token pricing fields into Inspect's dollars-per-million
 * `ModelCost` shape.
 */
export function toInspectModelCost(model: ModelEntry): InspectModelCost {
  return {
    input: costPerMillion(model.input_cost_per_token),
    output: costPerMillion(model.output_cost_per_token),
    input_cache_write: costPerMillion(model.cache_creation_input_token_cost),
    input_cache_read: costPerMillion(
      model.cache_read_input_token_cost ?? model.input_cost_per_token_cache_hit,
    ),
  };
}

/**
 * Builds an Inspect-compatible export for the requested model names while also
 * reporting unresolved lookups together with the candidate keys that were tried.
 */
export function buildInspectCostExport(
  models: ModelEntry[],
  requestedModels: string[],
  options: InspectExportOptions = {},
): InspectExportResult {
  const costs: Record<string, InspectModelCost> = {};
  const unresolved: InspectResolutionError[] = [];

  for (const requestedModel of requestedModels) {
    const trimmed = requestedModel.trim();
    if (!trimmed) {
      continue;
    }

    const resolved = findModelByCandidates(models, trimmed);
    if (!resolved) {
      unresolved.push({
        model: trimmed,
        candidates: candidateKeysForInspectModel(trimmed),
      });
      continue;
    }

    costs[trimmed] = {
      ...toInspectModelCost(resolved),
      ...(options.includeDebugInfo
        ? {
            _requested_model: trimmed,
            _matched_key: resolved.key,
            _matched_provider: resolved.litellm_provider ?? "",
          }
        : {}),
    };
  }

  return { costs, unresolved };
}

/**
 * Serializes the Inspect cost map into a minimal YAML document suitable for
 * writing directly to `--model-cost-config`. A trailing newline is included so
 * shell prompts do not get appended to the last line when using `curl -o`.
 */
export function renderInspectCostsYaml(costs: Record<string, InspectModelCost>): string {
  const body = Object.entries(costs)
    .map(([model, cost]) =>
      [
        `${JSON.stringify(model)}:`,
        `  input: ${formatYamlNumber(cost.input)}`,
        `  output: ${formatYamlNumber(cost.output)}`,
        `  input_cache_write: ${formatYamlNumber(cost.input_cache_write)}`,
        `  input_cache_read: ${formatYamlNumber(cost.input_cache_read)}`,
        ...(cost._requested_model
          ? [`  _requested_model: ${JSON.stringify(cost._requested_model)}`]
          : []),
        ...(cost._matched_key ? [`  _matched_key: ${JSON.stringify(cost._matched_key)}`] : []),
        ...(cost._matched_provider
          ? [`  _matched_provider: ${JSON.stringify(cost._matched_provider)}`]
          : []),
      ].join("\n"),
    )
    .join("\n");

  return body ? `${body}\n` : "";
}
