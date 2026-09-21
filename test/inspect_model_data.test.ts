import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildInspectCostExport } from "../src/inspect";
import type { ModelEntry } from "../src/types";

function loadBackupModels(): ModelEntry[] {
  const backupPath = path.resolve(
    process.cwd(),
    "resources/model_prices_and_context_window_backup_2026-03-13.json"
  );
  const parsed = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;

  return Object.entries(parsed)
    .filter(([key]) => key !== "sample_spec")
    .map(([key, value]) => ({ key, ...value }) as ModelEntry);
}

const backupModels = loadBackupModels();

// Extracted from Inspect's canonical model data files:
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/openai.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/anthropic.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/gdm.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/mistral.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/deepseek.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/grok.yml
// https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_ai/6fddd009f66d85507c0b398e50a60f53c2abee71/src/inspect_ai/model/_model_data/together.yml
const canonicalInspectModelNames = [
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "openai/o1",
  "openai/o3-mini",
  "openai/o4-mini",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-3-7-sonnet",
  "anthropic/claude-3-5-sonnet",
  "anthropic/claude-3-5-haiku",
  "anthropic/claude-3-opus",
  "anthropic/claude-3-haiku",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash",
  "google/gemini-1.5-flash",
  "google/gemini-1.5-pro",
  "mistral/mistral-medium-2505",
  "mistral/magistral-medium-2506",
  "mistral/mistral-large-2411",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
  "grok/grok-4",
  "grok/grok-3",
  "grok/grok-3-mini",
  "together/MiniMaxAI/MiniMax-M2.5",
] as const;

// These qualified forms come from Inspect provider/model conventions documented
// alongside the canonical YAML-backed model ids:
// https://inspect.aisi.org.uk/providers.html
const qualifiedInspectAliases = [
  "openai/azure/gpt-4o-mini",
  "anthropic/bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
  "anthropic/vertex/claude-3-5-sonnet-v2@20241022",
  "google/vertex/gemini-2.0-flash",
  "mistral/azure/Mistral-Large-2411",
  "openai-api/deepseek/deepseek-reasoner",
  "hf-inference-providers/openai/gpt-oss-120b:cerebras",
] as const;

describe("Inspect model-data compatibility", () => {
  it("resolves canonical model names extracted from Inspect _model_data YAMLs", () => {
    const result = buildInspectCostExport(backupModels, [...canonicalInspectModelNames]);

    expect(result.unresolved).toEqual([]);
    expect(Object.keys(result.costs)).toEqual([...canonicalInspectModelNames]);
  });

  it("resolves qualified provider aliases used by Inspect alongside canonical YAML model ids", () => {
    const result = buildInspectCostExport(backupModels, [...qualifiedInspectAliases]);

    expect(result.unresolved).toEqual([]);
    expect(Object.keys(result.costs)).toEqual([...qualifiedInspectAliases]);
  });
});
