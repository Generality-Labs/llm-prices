import {
  OPENROUTER_MODELS_URL,
  type OpenRouterModelsResponse,
  openRouterEntries,
} from "./openrouter";
import type { Env, ModelEntry } from "./types";

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json";

const KV_KEY = "model_prices";
const KV_META_KEY = "model_prices_meta";

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * LiteLLM no longer carries OpenRouter rows, so those come from OpenRouter's
 * own model list. Both sources are written in one KV value: if either fetch
 * fails, the previous cache stays in place.
 */
export async function fetchAndCache(env: Env): Promise<{ count: number }> {
  const [litellm, openrouter] = await Promise.all([
    fetchJson<Record<string, unknown>>(SOURCE_URL),
    fetchJson<OpenRouterModelsResponse>(OPENROUTER_MODELS_URL),
  ]);
  const merged = { ...litellm };
  for (const { key, ...entry } of openRouterEntries(openrouter)) {
    merged[key] = entry;
  }

  await env.MODEL_PRICES.put(KV_KEY, JSON.stringify(merged));
  await env.MODEL_PRICES.put(KV_META_KEY, JSON.stringify({ updated_at: new Date().toISOString() }));

  const count = Object.keys(merged).filter((k) => k !== "sample_spec").length;
  return { count };
}

export async function getModels(env: Env): Promise<ModelEntry[]> {
  const raw = await env.MODEL_PRICES.get(KV_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  const entries: ModelEntry[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "sample_spec") continue;
    entries.push({ key, ...value } as ModelEntry);
  }

  return entries;
}

export async function getMeta(env: Env): Promise<{ updated_at: string } | null> {
  const raw = await env.MODEL_PRICES.get(KV_META_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}
