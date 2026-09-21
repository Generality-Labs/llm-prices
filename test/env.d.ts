import type { Env } from "../src/types";

declare module "cloudflare:test" {
  // biome-ignore lint/suspicious/noEmptyInterface: extends the app's Env for tests
  interface ProvidedEnv extends Env {}
}
