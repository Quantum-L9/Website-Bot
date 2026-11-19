// A domain spec that does not request market research must seal a blueprint
// and reach content authority without a landscape purchase or a donor crawl.
import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_PARTY_AUTHORITY_SCHEMA,
  refForArtifact,
  type SEOContentBlueprintArtifact,
  type StructuredContentPackageArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import type {
  SEOContentBlueprintRequest,
  SeoBuildIntelligencePort,
} from "../../src/intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { CompetitiveIntelligenceStage } from "../../src/stages/CompetitiveIntelligenceStage.js";
import { RedesignContentAuthorityStage } from "../../src/stages/RedesignContentAuthorityStage.js";
import { makeLandscape, makeSeoRoute } from "./redesign-fixtures.js";

const CLIENT_ID = "spec-only-client";
const BUILD_ID = `spec-only-${process.pid}`;

function domainSpec(marketResearch?: DomainSpec["market_research"]): DomainSpec {
  return {
    client_id: CLIENT_ID,
    business_name: "Quantum AI Partners",
    vertical: "ai_revops_crm_transformation",
    geography: { states: ["US"], primary_state: "US" },
    design: { status: "pending" },
    routes: [
      { slug: "/", title: "Home", purpose: "Introduce the offer", components: ["hero"] },
      {
        slug: "/contact",
        title: "Contact",
        purpose: "Book a strategy call",
        components: ["cta"],
      },
    ],
    seo_contract: { target_keywords: ["crm transformation", "ai revops"] },
    ...(marketResearch ? { market_research: marketResearch } : {}),
  };
}

function ctxFor(spec: DomainSpec): BuildContext {
  return {
    buildId: BUILD_ID,
    clientId: CLIENT_ID,
    dryRun: true,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: spec,
    resume: false,
    stageResults: new Map(),
    seoBuildIntelligencePreflight: {
      status: "ready",
      service: "SEO-Bot",
      version: "2.1.0",
      bot_interop_version: "1.3.0",
      llm_router_version: "1.3.0",
      produced_at: "2026-11-19T00:00:00.000Z",
      capabilities: {
        competitive_landscape: false,
        seo_content_blueprint: true,
        structured_content: true,
      },
      configuration: { dataforseo_configured: false, llm_provider_configured: true },
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
  } as unknown as BuildContext;
}

function throwingPort(calls: string[]): SeoBuildIntelligencePort {
  return {
    async preflight() {
      calls.push("preflight");
      throw new Error("preflight must not run for a spec that did not request research");
    },
    async createCompetitiveLandscape() {
      calls.push("landscape");
      throw new Error("createCompetitiveLandscape must not be called");
    },
    async createSEOContentBlueprint() {
      calls.push("seo-blueprint");
      throw new Error("content blueprint is not this stage");
    },
    async createStructuredContent() {
      calls.push("structured-content");
      throw new Error("structured content is not this stage");
    },
  };
}

void test("a spec with no research request never buys a landscape or crawls donors", async () => {
  const calls: string[] = [];
  let crawled = false;
  const ctx = ctxFor(domainSpec());
  await new CompetitiveIntelligenceStage(
    () => throwingPort(calls),
    () => ({
      async ingest() {
        crawled = true;
        throw new Error("donor crawl must not be called");
      },
      async close() {},
    }),
  ).run(ctx);

  assert.deepEqual(calls, []);
  assert.equal(crawled, false);
  assert.equal(ctx.competitiveLandscape, undefined);
  assert.equal(ctx.firstPartyAuthority?.market_research, "not_requested");
  assert.equal(ctx.firstPartyAuthority?.donor_count, 0);
  assert.equal(ctx.firstPartyAuthority?.schema, FIRST_PARTY_AUTHORITY_SCHEMA);
  assert.equal(ctx.acceptedDonors?.length, 0);
  const provenance = ctx.websiteBlueprint?.payload.provenance;
  assert.ok(provenance);
  assert.equal(provenance.competitive_landscape_ref, undefined);
  assert.equal(
    provenance.first_party_authority?.domain_spec_digest,
    ctx.firstPartyAuthority?.domain_spec_digest,
  );
  assert.equal(ctx.websiteBlueprint?.input_refs.length, 0);
});

void test("an explicit research request still rejects a cohort other than 10", async () => {
  const previousUrl = process.env.SEO_BOT_URL;
  const previousKey = process.env.SEO_BOT_API_KEY;
  process.env.SEO_BOT_URL = "https://seo-bot.invalid";
  process.env.SEO_BOT_API_KEY = "spec-only-test";
  let crawled = false;
  try {
    const ctx = ctxFor(domainSpec("requested"));
    await assert.rejects(
      () =>
        new CompetitiveIntelligenceStage(
          () => ({
            async preflight() {
              return {
                status: "ready",
                service: "SEO-Bot",
                version: "2.1.0",
                bot_interop_version: "1.3.0",
                llm_router_version: "1.3.0",
                produced_at: "2026-11-19T00:00:00.000Z",
                capabilities: {
                  competitive_landscape: true,
                  seo_content_blueprint: true,
                  structured_content: true,
                },
                configuration: { dataforseo_configured: true, llm_provider_configured: true },
              };
            },
            async createCompetitiveLandscape() {
              return makeLandscape({ donorDomains: [] });
            },
            async createSEOContentBlueprint() {
              throw new Error("seo blueprint must not run before a cohort is sealed");
            },
            async createStructuredContent() {
              throw new Error("unused");
            },
          }),
          () => ({
            async ingest() {
              crawled = true;
              throw new Error("crawl");
            },
            async close() {},
          }),
        ).run(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === "COMPETITIVE_EVIDENCE_INCOMPLETE",
    );
    assert.equal(crawled, false);
  } finally {
    if (previousUrl === undefined) delete process.env.SEO_BOT_URL;
    else process.env.SEO_BOT_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SEO_BOT_API_KEY;
    else process.env.SEO_BOT_API_KEY = previousKey;
  }
});

void test("content authority sends the first-party record and no landscape", async () => {
  const ctx = ctxFor(domainSpec());
  await new CompetitiveIntelligenceStage(
    () => throwingPort([]),
    () => ({
      async ingest() {
        throw new Error("donor crawl must not be called");
      },
      async close() {},
    }),
  ).run(ctx);
  const authority = ctx.firstPartyAuthority;
  const blueprint = ctx.websiteBlueprint;
  assert.ok(authority);
  assert.ok(blueprint);

  let seen: SEOContentBlueprintRequest | undefined;
  const seoBlueprint: SEOContentBlueprintArtifact = sealIntelligenceArtifact({
    artifact_type: "seo_content_blueprint",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-11-19T00:00:00.000Z",
    input_refs: [],
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.seoContentBlueprint,
      first_party_authority: authority,
      batch_size: 4,
      batch_count: 1,
      routes: blueprint.payload.routes.map((route) => makeSeoRoute(route.route_id, route.path)),
    },
  });
  const port: SeoBuildIntelligencePort = {
    async preflight() {
      throw new Error("content authority must use the recorded preflight");
    },
    async createCompetitiveLandscape() {
      throw new Error("createCompetitiveLandscape must not be called");
    },
    async createSEOContentBlueprint(request) {
      seen = request;
      return seoBlueprint;
    },
    async createStructuredContent(request): Promise<StructuredContentPackageArtifact> {
      return sealIntelligenceArtifact({
        artifact_type: "structured_content_package",
        client_id: CLIENT_ID,
        build_id: BUILD_ID,
        producer: { repo: "SEO-Bot", version: "1.0.0" },
        produced_at: "2026-11-19T00:00:00.000Z",
        input_refs: [refForArtifact(request.page_content_contract)],
        payload: {
          schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
          page_content_contract_ref: refForArtifact(request.page_content_contract),
          routes: blueprint.payload.routes.map((route) => ({
            route_id: route.route_id,
            path: route.path,
            metadata: { title: route.purpose, description: route.purpose },
            sections: [
              {
                section_id: route.sections[0]?.section_id ?? "hero",
                heading: route.purpose,
                blocks: [{ kind: "paragraph" as const, text: route.purpose }],
              },
            ],
            faqs: [],
            internal_links: [],
            schema_content_inputs: { faq: false, local_business: false },
          })),
          validation: {
            seo_blueprint_passed: true,
            contract_passed: true,
            unsupported_claims: [],
            failed_requirements: [],
          },
          route_evidence: [],
        },
      });
    },
  };

  ctx.domainSpec.seo_contract = {
    ...ctx.domainSpec.seo_contract,
    route_targets: [
      {
        cluster_name: "home",
        target_page: "/",
        intent: "commercial",
        keywords: ["crm transformation"],
      },
    ],
  };
  await new RedesignContentAuthorityStage(() => port).run(ctx);
  assert.ok(seen);
  assert.deepEqual(seen.routes.find((route) => route.path === "/")?.keywords, [
    "crm transformation",
  ]);
  assert.equal(seen.routes.find((route) => route.path === "/contact")?.keywords, undefined);
  assert.equal(seen.competitive_landscape, undefined);
  assert.equal(seen.first_party_authority?.domain_spec_digest, authority.domain_spec_digest);
  assert.equal(seen.first_party_authority?.donor_count, 0);
  assert.equal(
    ctx.seoContentBlueprint?.payload.first_party_authority?.market_research,
    "not_requested",
  );
  assert.equal(ctx.seoContentBlueprint?.payload.competitive_landscape_ref, undefined);
});
