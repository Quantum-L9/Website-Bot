// Benchmark diagnostic: probe SEO-Bot reachability using the SAME hydration
// path as the pipeline (.env.local + Infisical). Prints ONLY reachability
// facts — never URLs, keys, or any secret value.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // optional
}

const { hydrateSecretsIfConfigured } = await import(
  resolve(process.cwd(), "scripts/lib/hydrate-secrets.mjs")
);
await hydrateSecretsIfConfigured();

const url = process.env.SEO_BOT_URL?.trim();
const key = process.env.SEO_BOT_API_KEY?.trim();
console.log(`SEO_BOT_URL configured: ${Boolean(url)}`);
console.log(`SEO_BOT_API_KEY configured: ${Boolean(key)}`);
if (!url) process.exit(0);

let scheme;
let hostClass = "unknown";
try {
  const parsed = new URL(url);
  scheme = parsed.protocol;
  const host = parsed.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") hostClass = "loopback";
  else if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) hostClass = "private-lan";
  else hostClass = "public-or-remote";
} catch {
  scheme = "unparseable";
}
console.log(`SEO_BOT_URL scheme: ${scheme}`);
console.log(`SEO_BOT_URL host class: ${hostClass}`);

try {
  const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`/health reachable: yes (status ${res.status})`);
  await res.arrayBuffer();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`/health reachable: no (${message.replaceAll(url, "<redacted>")})`);
}
