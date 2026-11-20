// L9_META: layer=test, role=website_preflight_first_party, status=active, version=1.0.0
//
// The `make website` front door must judge SEO-Bot readiness the way the
// pipeline's SeoBuildIntelligencePreflightStage does: market research is
// required only when the spec asks for it (`market_research: requested`).
// A first-party REDESIGN_IMPROVE spec passes while SEO-Bot reports only its
// market-research checks (DataForSEO, competitive landscape) not ready.
//
// The real SeoBuildIntelligenceHttpClient runs against an in-memory fetch;
// nothing touches the network.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse, stringify } from "yaml";
import { SeoBuildIntelligenceHttpClient } from "../../src/intelligence/SeoBuildIntelligenceHttpClient.js";
import type { SeoBotPreflightResult } from "../../src/intelligence/SeoBuildIntelligencePort.js";
import { formatPreflightTable, runWebsitePreflight } from "../../src/preflight/run.js";
import type { PreflightDeps, PreflightOptions } from "../../src/preflight/types.js";

const SPEC_PATH = "specs/first-party.yaml";
const SEO_URL = "http://127.0.0.1:3100";

function redesignSpec(marketResearch?: "requested" | "not_requested"): string {
  const spec = parse(readFileSync("fixtures/ci-test-spec.yaml", "utf8")) as Record<string, unknown>;
  delete spec.deploy;
  delete spec.provision;
  delete spec.assets;
  spec.build_intent = "REDESIGN_IMPROVE";
  if (marketResearch) spec.market_research = marketResearch;
  else delete spec.market_research;
  return stringify(spec);
}

/** SEO-Bot with every check passing except the market-research ones. */
const MARKET_RESEARCH_UNAVAILABLE: SeoBotPreflightResult = {
  status: "not_ready",
  service: "seo-bot",
  version: "1.0.0",
  // The client admits only the bot-interop line Website-Bot itself ships.
  bot_interop_version: (
    JSON.parse(readFileSync("packages/bot-interop/package.json", "utf8")) as { version: string }
  ).version,
  llm_router_version: "2.0.0",
  capabilities: {
    competitive_landscape: false,
    seo_content_blueprint: true,
    structured_content: true,
  },
  configuration: { dataforseo_configured: false, llm_provider_configured: true },
  checks: [
    { name: "dataforseo_configured", status: "FAIL", detail: "DATAFORSEO_* not set" },
    { name: "competitive_landscape_capability", status: "FAIL", detail: "needs DataForSEO" },
    { name: "llm_provider_configured", status: "PASS", detail: "ok" },
    { name: "structured_content_capability", status: "PASS", detail: "ok" },
  ],
} as SeoBotPreflightResult;

function seoFetch(snapshot: SeoBotPreflightResult): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) return Response.json({ status: "ok" });
    if (url.endsWith("/api/build-intelligence/preflight")) return Response.json(snapshot);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function deps(specYaml: string, snapshot: SeoBotPreflightResult): PreflightDeps {
  return {
    readText: (path) => {
      if (path !== SPEC_PATH) throw new Error(`ENOENT ${path}`);
      return specYaml;
    },
    exists: (path) => path === SPEC_PATH,
    writableError: () => undefined,
    resolvePath: (path) => path,
    seoBotPort: (baseUrl, apiKey) =>
      new SeoBuildIntelligenceHttpClient(baseUrl, apiKey, seoFetch(snapshot)),
  };
}

function options(): PreflightOptions {
  return {
    mode: "local-proof",
    specPath: SPEC_PATH,
    buildCapUsd: 10,
    timeoutMs: 1_000,
    knownDeepSeekModels: ["deepseek-flash"],
    defaultDeepSeekModel: "deepseek-flash",
    visionDeepSeekModels: ["deepseek-flash"],
    defaultDeepSeekVisionModel: "deepseek-flash",
    secretSource: { bootstrapPresent: false, sourceMode: "process_env_only" },
    seoBot: { urlVar: "SEO_BOT_URL", keyVar: "SEO_BOT_API_KEY", url: SEO_URL, apiKey: "k" },
    env: { DEEPSEEK_API_KEY: "sk-test", GEMINI_API_KEY: "g-test" },
  };
}

async function seoCheck(specYaml: string) {
  const report = await runWebsitePreflight(options(), deps(specYaml, MARKET_RESEARCH_UNAVAILABLE));
  const check = report.checks.find((candidate) => candidate.name === "seo_bot.preflight");
  assert.ok(check, formatPreflightTable(report));
  return check;
}

test("a first-party REDESIGN spec passes when only market-research checks are not ready", async () => {
  const check = await seoCheck(redesignSpec());
  assert.equal(check.status, "PASS", check.detail);
});

test("market_research: not_requested is first-party too", async () => {
  const check = await seoCheck(redesignSpec("not_requested"));
  assert.equal(check.status, "PASS", check.detail);
});

test("market_research: requested still requires DataForSEO and the landscape capability", async () => {
  const check = await seoCheck(redesignSpec("requested"));
  assert.equal(check.status, "FAIL");
  assert.match(check.detail, /SEO_BOT_CAPABILITY_MISMATCH/);
  assert.match(check.detail, /dataforseo_configured=FAIL/);
});
