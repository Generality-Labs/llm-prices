import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Two projects, so only tests that need the Workers runtime pay for it:
//   unit    plain Node, for pure-function modules (the existing suites mock
//           ../src/data and never import cloudflare:* at runtime).
//   worker  runs inside workerd via @cloudflare/vitest-pool-workers, with
//           real (locally simulated) bindings via `cloudflare:test`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/worker.test.ts"],
          passWithNoTests: true,
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
        test: {
          name: "worker",
          include: ["test/worker.test.ts"],
        },
      },
    ],
  },
});
