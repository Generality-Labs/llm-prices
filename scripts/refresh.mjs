import { existsSync, readFileSync } from "node:fs";

// Same file scripts/put-secrets.sh pushes to the Worker; .env is the older location.
const envFile = [".dev.vars.production", ".env"].find((f) => existsSync(f));
if (!envFile) {
  console.error("No .dev.vars.production or .env found (see .dev.vars.example)");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=").map((s) => s.trim())),
);

const token = env.REFRESH_SECRET;
if (!token) {
  console.error("REFRESH_SECRET not found in .env");
  process.exit(1);
}

const url = "https://llm-prices.generality.org/api/refresh";
console.log("Refreshing model prices...");

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));

if (!data.ok) process.exit(1);
