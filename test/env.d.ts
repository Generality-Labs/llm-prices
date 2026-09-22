// `wrangler types` cannot see this secret (it has no default in wrangler.toml),
// so it is not present in the generated worker-configuration.d.ts. Augment
// Cloudflare.Env directly: that's the type @cloudflare/vitest-pool-workers
// actually uses for the pool's `env`, not `ProvidedEnv`.
declare global {
  namespace Cloudflare {
    interface Env {
      REFRESH_SECRET?: string;
    }
  }
}

export {};
