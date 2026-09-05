// L9_META: layer=test, role=seo_build_intelligence_port, status=active, version=1.0.0

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  type ArtifactRef,
  type CompetitiveLandscapeV1,
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBuildBlueprintV2,
} from "@quantum-l9/bot-interop";
import { assertWebsiteBlueprintLandscape } from "../../src/intelligence/SeoBuildIntelligencePort.js";

function landscapeArtifact() {
  const payload: CompetitiveLandscapeV1 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape,
    market: { niche: "scrap-metal", country: "US", language: "en", device: "desktop" },
    query_portfolio: [],
    observations: [],
    domains: [],
    selected_donors: [],
    exclusions: [],
    evidence_complete: true,
    ranking_llm_calls: 0,
  };
  return sealIntelligenceArtifact({
    artifact_type: "competitive_landscape",
    client_id: "client-1",
    build_id: "build-1",
    producer: { repo: "SEO-Bot", version: "2.1.0" },
    produced_at: "2026-08-14T00:00:00.000Z",
    input_refs: [],
    payload,
  });
}

function websiteBlueprint(landscapeRef: ArtifactRef) {
  const payload: WebsiteBuildBlueprintV2 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: "REDESIGN_IMPROVE",
    provenance: {
      competitive_landscape_ref: landscapeRef,
      baseline_digest: "b".repeat(64),
      client_vision_digest: "c".repeat(64),
      design_reference_intelligence_digest: "e".repeat(64),
      pattern_portfolio_digest: "d".repeat(64),
    },
    design_direction: {
      principles: [],
      desired_attributes: [],
      rejected_attributes: [],
      reference_pattern_refs: [],
      prohibited_transfers: [],
      palette_authority: { source: "none", tokens: {}, observed_characteristics: [] },
    },
    strategy: {
      experience_attributes: [],
      differentiation: [],
      preserve: [],
      evolve: [],
      forbid: [],
    },
    content_guardrails: { forbidden_claims: [] },
    conversion: { primary_action: "quote", secondary_actions: [], persistent_mobile_action: true },
    routes: [],
    visual_requirements: [],
    acceptance_tests: [],
  };
  return sealIntelligenceArtifact({
    artifact_type: "website_build_blueprint",
    client_id: "client-1",
    build_id: "build-1",
    producer: { repo: "Website-Bot", version: "3.1.0" },
    produced_at: "2026-08-14T00:00:00.000Z",
    input_refs: [landscapeRef],
    payload,
  });
}

test("assertWebsiteBlueprintLandscape passes when the blueprint cites the same landscape", () => {
  const landscape = landscapeArtifact();
  const blueprint = websiteBlueprint(refForArtifact(landscape));
  assert.doesNotThrow(() => assertWebsiteBlueprintLandscape(blueprint, landscape));
});

test("assertWebsiteBlueprintLandscape fails closed on a different landscape", () => {
  const landscape = landscapeArtifact();
  const otherRef: ArtifactRef = {
    artifact_type: "competitive_landscape",
    artifact_id: `competitive_landscape:${"f".repeat(64)}`,
    payload_digest: "f".repeat(64),
  };
  const blueprint = websiteBlueprint(otherRef);
  assert.throws(
    () => assertWebsiteBlueprintLandscape(blueprint, landscape),
    /INTEL_INPUT_HASH_MISMATCH/,
  );
});

/* ── Machine-auth client contract (SEO_BOT_API_KEY seam) ───────────────────── */

import { SeoBuildIntelligenceHttpClient } from "../../src/intelligence/SeoBuildIntelligenceHttpClient.js";

test("client sends the machine credential on build-intelligence routes only", async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const mock = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(landscapeArtifact()), { status: 200 });
  };
  const client = new SeoBuildIntelligenceHttpClient(
    "https://seo-bot.example",
    "machine-key-123",
    mock as typeof fetch,
    // landscape is a HEAVY call; inject the same mock for the heavy
    // transport so the assertion still observes the request.
    mock as typeof fetch,
  );

  await client.createCompetitiveLandscape({
    client_id: "client-1",
    build_id: "build-1",
    market: { niche: "scrap-metal", country: "US", language: "en", device: "desktop" },
    seed_queries: ["metal recycling"],
    desired_donor_count: 10,
  });

  assert.equal(seen.length, 1);
  assert.equal(
    seen[0]!.url,
    "https://seo-bot.example/api/build-intelligence/competitive-landscape",
  );
  assert.equal(seen[0]!.headers.Authorization, "Bearer machine-key-123");
  // The machine key is the ONLY credential this client ever consults — the
  // operator dashboard key has no code path into the request.
  assert.equal(Object.keys(seen[0]!.headers).filter((h) => /auth/i.test(h)).length, 1);
});

test("client fails closed when the machine key is absent", () => {
  assert.throws(
    () => new SeoBuildIntelligenceHttpClient("https://seo-bot.example", ""),
    /SEO_BOT_API_KEY is required.*fail-closed/,
  );
});

test("client fails closed when the SEO-Bot URL is absent", () => {
  assert.throws(
    () => new SeoBuildIntelligenceHttpClient("", "machine-key-123"),
    /SEO_BOT_URL is required.*fail-closed/,
  );
});

/* ── Authenticated REDESIGN preflight (health + build-intelligence readiness) ── */

import {
  SeoBotPreflightError,
  type SeoBotPreflightResult,
} from "../../src/intelligence/SeoBuildIntelligencePort.js";

/** Local pinned versions the client parity-checks against. Resolved from the
 * installed packages so a dependency bump never silently stales the fixture. */
function readPkgVersion(name: string): string {
  return JSON.parse(fs.readFileSync(`node_modules/@quantum-l9/${name}/package.json`, "utf8"))
    .version;
}
const LOCAL_BOT_INTEROP_VERSION = readPkgVersion("bot-interop");
const LOCAL_ROUTER_VERSION = readPkgVersion("llm-router");

function preflightSnapshot(overrides?: Partial<SeoBotPreflightResult>): SeoBotPreflightResult {
  return {
    status: "ready",
    service: "SEO-Bot",
    version: "2.1.0",
    bot_interop_version: LOCAL_BOT_INTEROP_VERSION,
    llm_router_version: LOCAL_ROUTER_VERSION,
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: true,
    },
    configuration: { dataforseo_configured: true, llm_provider_configured: true },
    ...overrides,
  } as SeoBotPreflightResult;
}

function preflightClient(behavior: (url: string) => Response | Promise<Response>) {
  return new SeoBuildIntelligenceHttpClient(
    "https://seo-bot.example",
    "machine-key-123",
    async (url) => behavior(String(url)),
  );
}

const healthOk = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

test("preflight passes when health and the readiness snapshot are clean", async () => {
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    if (url.endsWith("/api/build-intelligence/preflight")) {
      return new Response(JSON.stringify(preflightSnapshot()), { status: 200 });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const snapshot = await client.preflight();
  assert.equal(snapshot.llm_router_version, LOCAL_ROUTER_VERSION);
  assert.deepEqual(snapshot.capabilities, {
    competitive_landscape: true,
    seo_content_blueprint: true,
    structured_content: true,
  });
});

test("preflight maps a network failure to SEO_BOT_UNREACHABLE", async () => {
  const client = preflightClient(() => {
    throw new Error("connection refused");
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_UNREACHABLE",
  );
});

test("preflight maps an unhealthy service to SEO_BOT_UNREACHABLE", async () => {
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return new Response("down", { status: 503 });
    throw new Error(`unexpected url ${url}`);
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_UNREACHABLE",
  );
});

test("preflight maps 401 to SEO_BOT_AUTH_FAILED", async () => {
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    return new Response("unauthorized", { status: 401 });
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_AUTH_FAILED",
  );
});

test("preflight maps a missing capability to SEO_BOT_CAPABILITY_MISMATCH", async () => {
  const snapshot = preflightSnapshot({
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: false,
    },
  });
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    return new Response(JSON.stringify(snapshot), { status: 200 });
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError &&
      error.code === "SEO_BOT_CAPABILITY_MISMATCH" &&
      /structured_content/.test(error.message),
  );
});

test("preflight maps incomplete provider configuration to SEO_BOT_CAPABILITY_MISMATCH", async () => {
  const snapshot = preflightSnapshot({
    configuration: { dataforseo_configured: false, llm_provider_configured: true },
  });
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    return new Response(JSON.stringify(snapshot), { status: 200 });
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_CAPABILITY_MISMATCH",
  );
});

test("preflight maps a bot-interop mismatch to SEO_BOT_CAPABILITY_MISMATCH", async () => {
  const snapshot = preflightSnapshot({ bot_interop_version: "0.9.0" });
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    return new Response(JSON.stringify(snapshot), { status: 200 });
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_CAPABILITY_MISMATCH",
  );
});

test("preflight maps a Router patch mismatch to SEO_BOT_ROUTER_VERSION_MISMATCH", async () => {
  const snapshot = preflightSnapshot({ llm_router_version: "9.9.9" });
  const client = preflightClient((url) => {
    if (url.endsWith("/health")) return healthOk();
    return new Response(JSON.stringify(snapshot), { status: 200 });
  });
  await assert.rejects(
    () => client.preflight(),
    (error: unknown) =>
      error instanceof SeoBotPreflightError && error.code === "SEO_BOT_ROUTER_VERSION_MISMATCH",
  );
});
