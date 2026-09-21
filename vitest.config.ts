import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Two projects, so only tests that need the Workers runtime pay for it:
//   unit    plain Node, for pure-function modules. Modules tested here must
//           have no runtime import of cloudflare:* / @cloudflare/* packages
//           (type-only imports are fine — TypeScript erases them).
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
          // A fresh scaffold has no unit tests yet; don't fail this project
          // while it is empty. The worker project always has tests, so an
          // accidentally-empty worker suite still fails.
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
