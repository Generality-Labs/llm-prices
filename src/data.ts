import type { Env, ModelEntry } from "./types";

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json";

const KV_KEY = "model_prices";
const KV_META_KEY = "model_prices_meta";

export async function fetchAndCache(env: Env): Promise<{ count: number }> {
  const resp = await fetch(SOURCE_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch source: ${resp.status} ${resp.statusText}`);
  }
  const raw = await resp.text();
  await env.MODEL_PRICES.put(KV_KEY, raw);
  await env.MODEL_PRICES.put(KV_META_KEY, JSON.stringify({ updated_at: new Date().toISOString() }));

  const parsed = JSON.parse(raw);
  const count = Object.keys(parsed).filter((k) => k !== "sample_spec").length;
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
