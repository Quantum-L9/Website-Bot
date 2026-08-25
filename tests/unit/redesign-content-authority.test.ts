// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Campaign 7 test matrices D/E/F/G: SEOContentBlueprint lineage accept +
// reject, deterministic PCC (zero LLM, repeat-identical digests), SCP
// lineage accept + reject, projection verbatim, deterministic schema
// serialization, and the legacy-authority bypass tripwires.

import assert from "node:assert/strict";
import test from "node:test";
import {
  refForArtifact,
  sealIntelligenceArtifact,
  type SEOContentBlueprintArtifact,
  type StructuredContentPackageArtifact,
  type StructuredContentPackageV1,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import { compilePageContentContract } from "../../src/intelligence/compile-page-content-contract.js";
import {
  type SeoBotPreflightResult,
  type SeoBuildIntelligencePort,
  type SEOContentBlueprintRequest,
  type StructuredContentRequest,
} from "../../src/intelligence/SeoBuildIntelligencePort.js";
import { verifiedBusinessFactsFromSpec } from "../../src/intelligence/verified-business-facts.js";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { ensureCanonicalSlotCoverage } from "../../src/stages/CompetitiveIntelligenceStage.js";
import { ContentGenerationStage } from "../../src/stages/ContentGenerationStage.js";
import { RedesignContentAuthorityStage } from "../../src/stages/RedesignContentAuthorityStage.js";
import { RedesignSchemaSerializerStage } from "../../src/stages/RedesignSchemaSerializerStage.js";
import { SchemaGeneratorStage } from "../../src/stages/SchemaGeneratorStage.js";
import { StructuredContentProjectionStage } from "../../src/stages/StructuredContentProjectionStage.js";
import {
  BUILD_ID,
  CLIENT_ID,
  makeLandscape,
  makeSeoBlueprint,
  makeSeoRoute,
  makeWebsiteBlueprint,
} from "./redesign-fixtures.js";

function makeScpPayload(
  contractRef: ReturnType<typeof refForArtifact>,
  overrides?: Partial<StructuredContentPackageV1>,
): StructuredContentPackageV1 {
  return {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
    page_content_contract_ref: contractRef,
    routes: [
      {
        route_id: "/",
        path: "/",
        metadata: { title: "Test Biz | Test Service", description: "Reliable local service." },
        sections: [
          {
            section_id: "hero",
            heading: "Reliable Test Service",
            blocks: [{ kind: "paragraph", text: "We show up on time, every time." }],
            cta: { label: "Request a quote", action: "request_quote" },
          },
          {
            section_id: "overview",
            heading: "What we do",
            blocks: [{ kind: "bullets", items: ["Inspections", "Repairs"] }],
          },
        ],
        faqs: [{ question: "Are you local?", answer: "Yes, based in Tennessee." }],
        internal_links: [],
        schema_content_inputs: { faq: true, local_business: true },
      },
    ],
    validation: {
      seo_blueprint_passed: true,
      contract_passed: true,
      unsupported_claims: [],
      failed_requirements: [],
    },
    route_evidence: [],
    ...overrides,
  };
}

class FakePort implements SeoBuildIntelligencePort {
  constructor(
    private readonly seoBlueprint: SEOContentBlueprintArtifact,
    private readonly scpMutator?: (
      payload: StructuredContentPackageV1,
    ) => StructuredContentPackageV1,
    private readonly preflightImpl?: () => Promise<SeoBotPreflightResult>,
  ) {}
  async createCompetitiveLandscape(): Promise<never> {
    throw new Error("not used in this test");
  }
  async preflight(): Promise<SeoBotPreflightResult> {
    if (this.preflightImpl) return this.preflightImpl();
    return makePreflightSnapshot();
  }
  async createSEOContentBlueprint(
    _request: SEOContentBlueprintRequest,
  ): Promise<SEOContentBlueprintArtifact> {
    return this.seoBlueprint;
  }
  async createStructuredContent(
    request: StructuredContentRequest,
  ): Promise<StructuredContentPackageArtifact> {
    const payload = makeScpPayload(refForArtifact(request.page_content_contract));
    return sealIntelligenceArtifact({
      artifact_type: "structured_content_package",
      client_id: CLIENT_ID,
      build_id: BUILD_ID,
      producer: { repo: "SEO-Bot", version: "1.0.0" },
      produced_at: "2026-08-17T00:00:00.000Z",
      input_refs: [refForArtifact(request.page_content_contract)],
      payload: this.scpMutator ? this.scpMutator(payload) : payload,
    });
  }
}

function makeCtx(overrides?: Partial<BuildContext>): BuildContext {
  return {
    buildId: BUILD_ID,
    clientId: CLIENT_ID,
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: {
      client_id: CLIENT_ID,
      business_name: "Test Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      design: { status: "resolved" },
      routes: [{ slug: "/", title: "Home", components: ["hero", "services-overview"] }],
      seo_contract: { site_url: "test.example.com", phone: "+1-555-0100" },
    },
    llm: {
      async generateContent() {
        throw new Error("llm must not be called");
      },
      async generateSchema() {
        throw new Error("llm must not be called");
      },
      async strategize() {
        throw new Error("llm must not be called");
      },
    },
    generatedContent: new Map<string, string>(),
    generatedSchemas: new Map<string, object>(),
    stageResults: new Map(),
    qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
    seoBuildIntelligencePreflight: makePreflightSnapshot(),
    ...overrides,
  } as unknown as BuildContext;
}

// ---- Matrix D: SEOContentBlueprint lineage -------------------------------

void test("matching lineage accepts the SEOContentBlueprint and seals a PCC + SCP", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(() => new FakePort(seoBlueprint));
  await stage.run(ctx);
  assert.equal(ctx.seoContentBlueprint?.artifact_id, seoBlueprint.artifact_id);
  assert.ok(ctx.pageContentContract);
  assert.ok(ctx.structuredContentPackage);
  assert.equal(ctx.redesignCounters?.pageContentContractLlmCalls, 0);
});

void test("a SEOContentBlueprint from a different landscape is rejected (COMPETITIVE_LANDSCAPE_MISMATCH)", async () => {
  const landscape = makeLandscape();
  const otherLandscape = makeLandscape({ donorDomains: ["other-0.example.com"] });
  const blueprint = makeWebsiteBlueprint(landscape);
  const foreignSeoBlueprint = makeSeoBlueprint(otherLandscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(() => new FakePort(foreignSeoBlueprint));
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "COMPETITIVE_LANDSCAPE_MISMATCH",
  );
});

void test("a tampered SEOContentBlueprint fails integrity (SEO_CONTENT_BLUEPRINT_INVALID)", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const tampered = structuredClone(seoBlueprint);
  tampered.payload.routes[0].targets.primary_query = "tampered query";
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(() => new FakePort(tampered));
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "SEO_CONTENT_BLUEPRINT_INVALID",
  );
});

void test("a SEOContentBlueprint with a different route set is rejected (ROUTE_SET_MISMATCH)", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape, [
    makeSeoRoute("/", "/"),
    makeSeoRoute("/extra", "/extra"),
  ]);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(() => new FakePort(seoBlueprint));
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "ROUTE_SET_MISMATCH",
  );
});

// ---- Matrix E: deterministic PCC ------------------------------------------

void test("PCC compilation is deterministic: identical inputs produce identical digests", () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const facts = verifiedBusinessFactsFromSpec({
    client_id: CLIENT_ID,
    business_name: "Test Biz",
    vertical: "test_service",
    geography: { states: ["TN"], primary_state: "TN" },
    design: { status: "resolved" },
    routes: [],
    seo_contract: { site_url: "test.example.com" },
  });
  const seal = () =>
    sealIntelligenceArtifact({
      artifact_type: "page_content_contract",
      client_id: CLIENT_ID,
      build_id: BUILD_ID,
      producer: { repo: "Website-Bot", version: "1.0.0" },
      produced_at: "2026-08-17T00:00:00.000Z",
      input_refs: [refForArtifact(blueprint), refForArtifact(seoBlueprint)],
      payload: compilePageContentContract({
        websiteBlueprint: blueprint,
        seoBlueprint,
        businessFacts: facts,
        compilerVersion: "1.0.0",
      }),
    });
  const first = seal();
  const second = seal();
  assert.equal(first.integrity.payload_digest, second.integrity.payload_digest);
  assert.equal(first.artifact_id, second.artifact_id);
});

// ---- Matrix F: SCP lineage -------------------------------------------------

void test("an SCP referencing a different PCC is rejected (STRUCTURED_CONTENT_LINEAGE_MISMATCH)", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(
    () =>
      new FakePort(seoBlueprint, (payload) => ({
        ...payload,
        page_content_contract_ref: {
          artifact_type: "page_content_contract",
          artifact_id: "page_content_contract:" + "9".repeat(64),
          payload_digest: "9".repeat(64),
        },
      })),
  );
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
  );
});

void test("an SCP that failed its own validation is rejected", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const stage = new RedesignContentAuthorityStage(
    () =>
      new FakePort(seoBlueprint, (payload) => ({
        ...payload,
        validation: { ...payload.validation, unsupported_claims: ["fabricated award"] },
      })),
  );
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "VALIDATION_FAILED",
  );
});

// ---- Matrix G: projection + bypass + deterministic schemas ----------------

async function runFullChain(): Promise<BuildContext> {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  await new RedesignContentAuthorityStage(() => new FakePort(seoBlueprint)).run(ctx);
  await new StructuredContentProjectionStage().run(ctx);
  await new RedesignSchemaSerializerStage().run(ctx);
  return ctx;
}

void test("SCP prose is projected verbatim; no legacy generation, zero LLM schema calls", async () => {
  const ctx = await runFullChain();
  const hero = ctx.generatedContent.get("/:hero");
  assert.ok(hero);
  assert.match(hero, /Reliable Test Service/);
  assert.match(hero, /We show up on time, every time\./);
  assert.match(hero, /Request a quote/);
  const overview = ctx.generatedContent.get("/:services-overview");
  assert.ok(overview);
  assert.match(overview, /- Inspections/);
  assert.equal(ctx.redesignCounters?.legacyContentGenerationCalls, 0);
  assert.equal(ctx.redesignCounters?.redesignSchemaLlmCalls, 0);
  assert.equal(ctx.redesignCounters?.pageContentContractLlmCalls, 0);
});

void test("deterministic schema serialization: repeat runs produce identical JSON-LD", async () => {
  const first = await runFullChain();
  const second = await runFullChain();
  assert.deepEqual(
    Object.fromEntries(first.generatedSchemas),
    Object.fromEntries(second.generatedSchemas),
  );
  const faq = first.generatedSchemas.get("FAQPage") as { mainEntity: unknown[] };
  assert.ok(faq);
  assert.equal(faq.mainEntity.length, 1);
});

void test("legacy ContentGenerationStage trips LEGACY_CONTENT_AUTHORITY_USED under REDESIGN_IMPROVE", async () => {
  const ctx = makeCtx({
    redesignCounters: {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    },
  });
  await assert.rejects(
    () => new ContentGenerationStage().run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "LEGACY_CONTENT_AUTHORITY_USED",
  );
  assert.equal(ctx.redesignCounters?.legacyContentGenerationCalls, 1);
});

void test("legacy SchemaGeneratorStage trips FORBIDDEN_LLM_OPERATION under REDESIGN_IMPROVE", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => new SchemaGeneratorStage().run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "FORBIDDEN_LLM_OPERATION",
  );
});

void test("ensureCanonicalSlotCoverage covers every canonical slot even from an empty LLM section list", () => {
  const covered = ensureCanonicalSlotCoverage([], ["hero", "services-overview", "faq", "contact-form"]);
  const slots = new Set(covered.flatMap((section) => section.content_slots));
  for (const slot of [
    "primary_offer",
    "service_overview",
    "differentiation",
    "trust",
    "process",
    "project_proof",
    "local_relevance",
    "objection_handling",
    "faq",
    "conversion",
    "metadata",
  ] as const) {
    assert.ok(slots.has(slot), `missing slot ${slot}`);
  }
  const again = ensureCanonicalSlotCoverage([], ["hero", "services-overview", "faq", "contact-form"]);
  assert.deepEqual(covered, again);
});

void test("ensureCanonicalSlotCoverage pads sections to spec-component parity (golden run #51)", () => {
  const sparse = [
    {
      section_id: "everything",
      component_class: "prose",
      objective: "all content",
      content_slots: [],
      pattern_refs: [],
      proof_requirements: [],
    },
  ];
  const covered = ensureCanonicalSlotCoverage(sparse, [
    "hero",
    "service-detail",
    "trust-bar",
    "contact-form",
  ]);
  // The projection stage maps spec component i onto generated section i —
  // one LLM section against four frozen components must pad to four.
  assert.equal(covered.length, 4);
  assert.equal(covered[3]?.section_id, "spec-component-4");
  assert.ok((covered[3]?.content_slots ?? []).includes("conversion"));
});

void test("projection fails closed when the SCP is missing a spec route", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  await new RedesignContentAuthorityStage(() => new FakePort(seoBlueprint)).run(ctx);
  ctx.domainSpec.routes.push({ slug: "/missing", title: "Missing", components: ["hero"] });
  await assert.rejects(
    () => new StructuredContentProjectionStage().run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "ROUTE_SET_MISMATCH",
  );
});

/* ── Authenticated REDESIGN preflight: ordering + failure-code mapping ──────── */

function makePreflightSnapshot(): SeoBotPreflightResult {
  return {
    status: "ready",
    service: "SEO-Bot",
    version: "2.1.0",
    bot_interop_version: "1.1.0",
    llm_router_version: "1.3.0",
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: true,
    },
    configuration: { dataforseo_configured: true, llm_provider_configured: true },
  };
}

class RecordingPort implements SeoBuildIntelligencePort {
  calls: string[] = [];
  constructor(private readonly inner: FakePort) {}
  async createCompetitiveLandscape(): Promise<never> {
    throw new Error("not used in this test");
  }
  async createSEOContentBlueprint(
    request: SEOContentBlueprintRequest,
  ): Promise<import("@quantum-l9/bot-interop").SEOContentBlueprintArtifact> {
    this.calls.push("createSEOContentBlueprint");
    return this.inner.createSEOContentBlueprint(request);
  }
  async createStructuredContent(
    request: StructuredContentRequest,
  ): Promise<import("@quantum-l9/bot-interop").StructuredContentPackageArtifact> {
    this.calls.push("createStructuredContent");
    return this.inner.createStructuredContent(request);
  }
  async preflight(): Promise<SeoBotPreflightResult> {
    this.calls.push("preflight");
    return makePreflightSnapshot();
  }
}

// Preflight EXECUTION (probe + SEO_BOT_* failure-code mapping) belongs to the
// seo-build-intelligence-preflight stage and is covered by its own suite; this
// stage only consumes the resulting evidence.
void test("this stage consumes preflight evidence instead of re-probing SEO-Bot", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const ctx = makeCtx({ websiteBlueprint: blueprint, competitiveLandscape: landscape });
  const recording = new RecordingPort(new FakePort(makeSeoBlueprint(landscape)));
  const stage = new RedesignContentAuthorityStage(() => recording);
  await stage.run(ctx);
  assert.ok(
    !recording.calls.includes("preflight"),
    `preflight must not be repeated here, got ${recording.calls.join(", ")}`,
  );
  assert.ok(recording.calls.includes("createSEOContentBlueprint"));
});

void test("missing preflight evidence fails closed before any SEO-Bot call", async () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const ctx = makeCtx({
    websiteBlueprint: blueprint,
    competitiveLandscape: landscape,
    seoBuildIntelligencePreflight: undefined,
  });
  const recording = new RecordingPort(new FakePort(makeSeoBlueprint(landscape)));
  const stage = new RedesignContentAuthorityStage(() => recording);
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "REDESIGN_PIPELINE_INCOMPLETE",
  );
  assert.deepEqual(recording.calls, []);
});
