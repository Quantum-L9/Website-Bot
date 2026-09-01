// L9_META: layer=test, role=redesign_v2_seam_integration, status=active, version=1.0.0
//
// Phase 15 runtime question, answered by executed code:
//
//   Can REDESIGN run from first-party/client/reference/competitive inputs
//   through WebsiteBuildBlueprintV2 into downstream SEO/content/realization
//   without any V1 runtime dependency?
//
// This drives the REAL seam in-process: the real CompetitiveIntelligenceStage,
// the real WebsiteBuildBlueprintCompiler and its gate, the real
// DesignIntelligenceStage, and the real deterministic PageContentContract
// compiler. Only the two paid external services are substituted, through the
// stage's own constructor injection points (portFactory / ingestorFactory) —
// the seams the stage already exposes for exactly this. No Website-Bot logic
// under test is mocked.
//
// What this does NOT prove: a live SEO-Bot HTTP round trip, live DataForSEO
// SERP evidence, or a live LLM. Those need paid credentials this environment
// does not hold.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcceptedDonorEvidence, DonorIngestor } from "../../../src/intelligence/DonorIngestion.js";
import { compilePageContentContract } from "../../../src/intelligence/compile-page-content-contract.js";
import type { SeoBuildIntelligencePort } from "../../../src/intelligence/SeoBuildIntelligencePort.js";
import { assertWebsiteBlueprintLandscape } from "../../../src/intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext } from "../../../src/pipeline/BuildContext.js";
import { CompetitiveIntelligenceStage } from "../../../src/stages/CompetitiveIntelligenceStage.js";
import { DesignIntelligenceStage } from "../../../src/stages/DesignIntelligenceStage.js";
import { makeLandscape, makeSeoBlueprint, makeSeoRoute } from "../../unit/redesign-fixtures.js";

const SOURCE_PALETTE = {
  primary: "#0b5fff",
  secondary: "#334455",
  accent: "#0b5fff",
  background: "#0b0b0b",
  text: "#f5f5f5",
};

const landscape = makeLandscape();

function donorEvidence(domain: string): AcceptedDonorEvidence {
  return {
    domain,
    serp_observation_ids: [`obs-${domain}`],
    pages: [
      {
        url: `https://${domain}/`,
        content_digest: "a".repeat(64),
        status: 200,
        content_bytes: 1024,
        fetched_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    screenshot_paths: [`/tmp/${domain}.png`],
    crawl_manifest_path: `/tmp/${domain}.json`,
    evidence_digest: "b".repeat(64),
    crawled_at: "2026-09-01T00:00:00.000Z",
    disposition: "DONOR_REFERENCE_ONLY",
  } as AcceptedDonorEvidence;
}

/** Stands in for the paid SEO-Bot service; returns a real sealed landscape. */
const port: SeoBuildIntelligencePort = {
  async preflight() {
    return {
      status: "ok",
      service: "seo-bot",
      version: "2.1.0",
      bot_interop_version: "1.2.0",
      llm_router_version: "1.1.2",
      produced_at: "2026-09-01T00:00:00.000Z",
      capabilities: {
        competitive_landscape: true,
        seo_content_blueprint: true,
        structured_content: true,
      },
      configuration: { dataforseo_configured: true, llm_provider_configured: true },
    };
  },
  async createCompetitiveLandscape() {
    return landscape;
  },
  async createSEOContentBlueprint() {
    throw new Error("not used by this seam test");
  },
  async createStructuredContent() {
    throw new Error("not used by this seam test");
  },
};

const ingestor: DonorIngestor = {
  async ingest(request) {
    return donorEvidence(request.domain);
  },
  async close() {},
};

/** Stands in for the LLM; returns the shapes the real parsers require. */
function llm() {
  return {
    async strategize(_task: unknown, _system: string, user: string) {
      if (user.includes("nuggets")) {
        return JSON.stringify({
          nuggets: [
            {
              evidence: "donors lead with one action",
              invariant: "single primary call to action above the fold",
              disposition: "PORT",
              beneficiary_destination: "home hero",
              risk: "low",
              acceptance_test: "home exposes exactly one primary CTA",
            },
          ],
        });
      }
      if (user.includes("Nuggets across")) {
        return JSON.stringify({
          patterns: [
            {
              pattern_id: "p-1",
              evidence: "consistent across donors",
              invariant: "single primary call to action above the fold",
              disposition: "PORT",
              beneficiary_destination: "home hero",
              risk: "low",
              acceptance_test: "home exposes exactly one primary CTA",
              donor_frequency: 7,
            },
          ],
        });
      }
      // The blueprint op. Note it proposes a concrete color, which the contract
      // must refuse to treat as authority.
      return JSON.stringify({
        strategy: {
          experience_attributes: ["fast"],
          differentiation: ["same-day response"],
          preserve: [],
          evolve: ["hero"],
          forbid: [],
        },
        content_guardrails: { forbidden_claims: ["licensed"] },
        conversion: { primary_action: "Request an inspection", secondary_actions: ["Call"] },
        design_principles: ["generous whitespace"],
        routes: [
          {
            route_id: "/",
            sections: [
              {
                section_id: "hero",
                component_class: "hero",
                objective: "convert local searchers",
                content_slots: ["primary_offer"],
                pattern_refs: ["p-1"],
                proof_requirements: [],
              },
            ],
          },
        ],
        acceptance_tests: ["home converts"],
      });
    },
    async designReasoning() {
      return JSON.stringify({
        primary: "#7a2f1d",
        secondary: "#2b2b2b",
        accent: "#c96f4a",
        background: "#faf7f2",
        text: "#1a1a1a",
        font_heading: "Inter",
        font_body: "Inter",
      });
    },
  };
}

function makeCtx(clientVision?: Record<string, unknown>): BuildContext {
  return {
    buildId: "seam-build",
    clientId: "seam-client",
    dryRun: true,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    outputDir: mkdtempSync(join(tmpdir(), "seam-")),
    seoBuildIntelligencePreflight: { status: "ok" },
    sourceSiteManifest: { palette: { ...SOURCE_PALETTE } },
    domainSpec: {
      client_id: "seam-client",
      business_name: "Seam Roofing",
      vertical: "roofing",
      geography: { states: ["NC"], primary_state: "NC" },
      design: { status: "pending" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      seo_contract: { target_keywords: ["roof repair charlotte"] },
      ...(clientVision ? { client_vision: clientVision } : {}),
      design_references: [
        {
          reference_id: "ref-1",
          selection_reason: "clear proof hierarchy",
          principles: { layout: ["proof above the fold"], negative: ["carousel heroes"] },
          evidence_refs: ["screenshot-ref-1"],
        },
      ],
    },
    llm: llm(),
  } as unknown as BuildContext;
}

async function runSeam(ctx: BuildContext) {
  process.env.SEO_BOT_URL = "https://seo-bot.invalid";
  process.env.SEO_BOT_API_KEY = "seam-test-key";
  await new CompetitiveIntelligenceStage(
    () => port,
    () => ingestor,
  ).run(ctx);
  await new DesignIntelligenceStage().run(ctx);
}

void test("REDESIGN runs end-to-end through V2 with no V1 dependency", async () => {
  const ctx = makeCtx();
  await runSeam(ctx);

  const blueprint = ctx.websiteBlueprint;
  assert.ok(blueprint, "the seam must seal a blueprint");
  assert.equal(blueprint.payload.schema, "l9://website-intelligence/website-build-blueprint/v2");
  assert.equal(blueprint.producer.repo, "Website-Bot");

  // Every authoritative input is represented in provenance (WBV2-009).
  const provenance = blueprint.payload.provenance;
  assert.equal(provenance.competitive_landscape_ref.artifact_id, landscape.artifact_id);
  for (const digest of [
    provenance.baseline_digest,
    provenance.client_vision_digest,
    provenance.design_reference_intelligence_digest,
    provenance.pattern_portfolio_digest,
  ]) {
    assert.match(digest, /^[0-9a-f]{64}$/);
  }

  // The first-party authorities were live in the run, not decorative.
  assert.equal(ctx.clientVision?.declared, false);
  assert.equal(ctx.designReferenceSet?.accepted_references.length, 1);
  assert.deepEqual(ctx.designReferenceIntelligence?.layout_principles, [
    "proof above the fold",
  ]);
  assert.ok(
    blueprint.payload.design_direction.principles.includes("proof above the fold"),
    "accepted reference principles must reach the sealed design direction",
  );

  // Lineage holds through the downstream boundary helper.
  assert.doesNotThrow(() => assertWebsiteBlueprintLandscape(blueprint, landscape));
});

void test("the observed source palette never becomes the redesign theme", async () => {
  const ctx = makeCtx();
  await runSeam(ctx);

  const authority = ctx.websiteBlueprint!.payload.design_direction.palette_authority;
  assert.equal(authority.source, "none");
  assert.deepEqual(authority.tokens, {});
  // The observation survives only in abstract form.
  assert.ok(authority.observed_characteristics.includes("dark-dominant"));
  assert.ok(authority.observed_characteristics.includes("high-contrast"));
  for (const characteristic of authority.observed_characteristics) {
    assert.ok(!/#[0-9a-fA-F]{3,8}/.test(characteristic));
  }

  // And the realized theme carries none of the observed values.
  const resolved = Object.values(ctx.designTokens ?? {}).map((value) => value.toLowerCase());
  for (const [key, observed] of Object.entries(SOURCE_PALETTE)) {
    assert.ok(
      !resolved.includes(observed.toLowerCase()),
      `source ${key} ${observed} leaked into the redesign theme`,
    );
  }
});

void test("explicit client color intent flows through the seam and wins", async () => {
  const ctx = makeCtx({ palette: { primary: "#264653", secondary: "#2a9d8f", accent: "#e9c46a" } });
  await runSeam(ctx);

  const authority = ctx.websiteBlueprint!.payload.design_direction.palette_authority;
  assert.equal(authority.source, "client_vision");
  assert.equal(authority.tokens.primary, "#264653");
  assert.equal(ctx.designTokens?.primary, "#264653");
  assert.notEqual(ctx.designTokens?.primary, SOURCE_PALETTE.primary);
});

void test("the sealed V2 blueprint compiles a deterministic PageContentContract", async () => {
  const ctx = makeCtx();
  await runSeam(ctx);
  const blueprint = ctx.websiteBlueprint!;

  const seoBlueprint = makeSeoBlueprint(landscape, [makeSeoRoute("/", "/")]);
  const contract = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: [],
    compilerVersion: "1.0.0",
  });

  assert.equal(contract.inputs.website_build_blueprint.artifact_id, blueprint.artifact_id);
  assert.deepEqual(
    contract.routes.map((route) => route.route_id),
    ["/"],
  );

  // Determinism (WBV2-012): same inputs, byte-identical contract, no LLM.
  const again = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: [],
    compilerVersion: "1.0.0",
  });
  assert.deepEqual(contract, again);
});
