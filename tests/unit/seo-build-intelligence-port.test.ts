// L9_META: layer=test, role=seo_build_intelligence_port, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  type ArtifactRef,
  type CompetitiveLandscapeV1,
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBuildBlueprintV1,
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
  const payload: WebsiteBuildBlueprintV1 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: "REDESIGN_IMPROVE",
    competitive_landscape_ref: landscapeRef,
    baseline_digest: "b".repeat(64),
    pattern_portfolio_digest: "d".repeat(64),
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
    artifact_id: "competitive_landscape:" + "f".repeat(64),
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
  const client = new SeoBuildIntelligenceHttpClient(
    "https://seo-bot.example",
    "machine-key-123",
    async (url, init) => {
      seen.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify(landscapeArtifact()), { status: 200 });
    },
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
