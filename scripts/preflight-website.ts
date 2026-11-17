// L9_META: layer=cli, role=website_front_door, status=active, version=1.0.0
//
// `make website SPEC=<path> [MODE=local-proof|publish-proof|end-to-end]`
//
// Front door for a real build. Checks, in seconds and before any spend, every
// environmental precondition that past runs only discovered 5–40 minutes in
// (stale SEO-Bot seam key, missing provider keys, unwritable spend ledger,
// exhausted budget, retired model). Prints a PASS/FAIL table with a named fix
// per FAIL. Any FAIL exits non-zero and the pipeline is NOT started. All PASS
// execs scripts/run-pipeline.ts with the same spec and mode, unless
// --preflight-only is given.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { SeoBuildIntelligenceHttpClient } from "../src/intelligence/SeoBuildIntelligenceHttpClient.js";
import {
  formatPreflightTable,
  parseWebsiteArgs,
  runWebsitePreflight,
} from "../src/preflight/run.js";
import type { PreflightDeps } from "../src/preflight/types.js";
import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_PEAK_PRICING } from "../src/services/llm.js";
import { hydrateSecretsIfConfigured } from "./lib/hydrate-secrets.mjs";

let args: ReturnType<typeof parseWebsiteArgs>;
try {
  args = parseWebsiteArgs(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`website: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

// Same secret resolution as run-pipeline: .env.local, then Infisical (fail-soft;
// caller env wins). Only provenance metadata is returned, never values.
const hydrated = await hydrateSecretsIfConfigured();

const deps: PreflightDeps = {
  readText: (path) => readFileSync(path, "utf8"),
  exists: (path) => existsSync(path),
  writableError: (path) => {
    try {
      accessSync(path, constants.W_OK);
      return undefined;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code ?? String(error);
    }
  },
  resolvePath: (path) => (isAbsolute(path) ? path : resolve(process.cwd(), path)),
  seoBotPort: (baseUrl, apiKey, timeoutMs) =>
    new SeoBuildIntelligenceHttpClient(baseUrl, apiKey, (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
    ),
};

const report = await runWebsitePreflight(
  {
    mode: args.mode,
    specPath: args.specPath,
    env: process.env,
    buildCapUsd: args.buildCapUsd,
    timeoutMs: args.timeoutMs,
    knownDeepSeekModels: Object.keys(DEEPSEEK_PEAK_PRICING),
    defaultDeepSeekModel: DEEPSEEK_DEFAULT_MODEL,
    // Same settings SeoBuildIntelligencePreflightStage reads at run time.
    seoBot: {
      url: process.env.SEO_BOT_URL,
      apiKey: process.env.SEO_BOT_API_KEY,
      urlVar: "SEO_BOT_URL",
      keyVar: "SEO_BOT_API_KEY",
    },
    secretSource: {
      bootstrapPresent: hydrated.bootstrap_present,
      sourceMode: hydrated.source_mode,
    },
  },
  deps,
);
console.log(formatPreflightTable(report));
if (!report.ok) process.exit(1);
if (args.preflightOnly) process.exit(0);

console.log(`Starting pipeline: mode=${args.mode} spec=${args.specPath}`);
const child = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "scripts/run-pipeline.ts",
    `--mode=${args.mode}`,
    `--spec=${args.specPath}`,
    ...args.passthrough,
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(child.status ?? 1);
