// L9_META: layer=test, role=redesign_intelligence_persistence, status=active, version=1.0.0
//
// GAP-3 regression suite (Quantum AI Partners run 2026-09-01): every redesign
// intelligence artifact is persisted through the canonical run-bound store,
// reloads verify digest + integrity + identity + lineage, and a resumed build
// reuses the persisted chain instead of re-spending against SEO-Bot.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  type CompetitiveLandscapeArtifact,
  type PageContentContractArtifact,
  refForArtifact,
  type StructuredContentPackageArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import { compilePageContentContract } from "../../src/intelligence/compile-page-content-contract.js";
import type { SeoBuildIntelligencePort } from "../../src/intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { clientAssetRoot } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  hydrateRedesignIntelligence,
  loadPersistedRedesignIntelligence,
  loadRedesignArtifact,
  persistRedesignArtifact,
  readRedesignIntelligenceIndex,
  redesignIntelligenceDir,
} from "../../src/pipeline/evidence/RedesignIntelligenceArtifacts.js";
import { CompetitiveIntelligenceStage } from "../../src/stages/CompetitiveIntelligenceStage.js";
import { RedesignContentAuthorityStage } from "../../src/stages/RedesignContentAuthorityStage.js";
import {
  BUILD_ID,
  CLIENT_ID,
  makeDonorEvidence,
  makeLandscape,
  makeSeoBlueprint,
  makeSeoRoute,
  makeWebsiteBlueprint,
} from "./redesign-fixtures.js";

function ctxFor(buildId: string, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    buildId,
    clientId: CLIENT_ID,
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    resume: false,
    domainSpec: {
      client_id: CLIENT_ID,
      business_name: "Redesign Test",
      vertical: "test",
      geography: { states: ["NC"], primary_state: "NC" },
      design: { status: "pending" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      seo_contract: { target_keywords: ["test query"] },
    },
    stageResults: new Map(),
    ...overrides,
  } as unknown as BuildContext;
}

/** A consistent sealed chain for BUILD_ID (the fixtures seal with BUILD_ID). */
function sealedChain() {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape, [makeSeoRoute("/", "/")]);
  const payload = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: [],
    compilerVersion: "1.0.0",
  });
  const contract: PageContentContractArtifact = sealIntelligenceArtifact({
    artifact_type: "page_content_contract",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "Website-Bot", version: "1.0.0" },
    input_refs: [refForArtifact(blueprint), refForArtifact(seoBlueprint)],
    payload,
  });
  const contentPackage: StructuredContentPackageArtifact = sealIntelligenceArtifact({
    artifact_type: "structured_content_package",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    input_refs: [refForArtifact(contract)],
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
      page_content_contract_ref: refForArtifact(contract),
      routes: [
        {
          route_id: "/",
          path: "/",
          metadata: { title: "Home", description: "d" },
          sections: [
            { section_id: "hero", heading: "H", blocks: [{ kind: "paragraph", text: "p" }] },
          ],
          faqs: [],
          internal_links: [],
          schema_content_inputs: {},
        },
      ],
      validation: {
        seo_blueprint_passed: true,
        contract_passed: true,
        unsupported_claims: [],
        failed_requirements: [],
      },
      route_evidence: [
        {
          route_id: "/",
          repair_attempts: 0,
          generation_calls: 1,
          validation_calls: 1,
          schema_errors: 0,
        },
      ],
    },
  });
  return { landscape, blueprint, seoBlueprint, contract, contentPackage };
}

void test("sealed artifacts round-trip through the store with digest + identity + integrity checks", () => {
  const ctx = ctxFor(BUILD_ID);
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
  const { landscape } = sealedChain();
  const record = persistRedesignArtifact(ctx, "competitive-landscape", landscape);
  assert.ok(record?.sealed?.artifact_id === landscape.artifact_id);
  assert.ok(existsSync(resolve(redesignIntelligenceDir(ctx), "competitive-landscape.json")));
  const index = readRedesignIntelligenceIndex(ctx);
  assert.equal(index?.build_id, BUILD_ID);
  assert.equal(index?.artifacts["competitive-landscape"]?.sha256, record?.sha256);

  const loaded = loadRedesignArtifact<CompetitiveLandscapeArtifact>(ctx, "competitive-landscape", {
    sealed: "competitive_landscape",
  });
  assert.deepEqual(loaded, landscape);
  assert.equal(loadRedesignArtifact(ctx, "seo-content-blueprint"), undefined);
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});

void test("a tampered artifact, a foreign build identity, and a broken lineage all fail closed", () => {
  const ctx = ctxFor(BUILD_ID);
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
  const { landscape, seoBlueprint } = sealedChain();
  persistRedesignArtifact(ctx, "competitive-landscape", landscape);

  // Tamper with the file after the index recorded its digest.
  const path = resolve(redesignIntelligenceDir(ctx), "competitive-landscape.json");
  writeFileSync(
    path,
    readFileSync(path, "utf-8").replace("evidence_complete", "evidence_complete_x"),
    "utf-8",
  );
  assert.throws(
    () => loadRedesignArtifact(ctx, "competitive-landscape", { sealed: "competitive_landscape" }),
    (error: unknown) => error instanceof BuildError && error.code === "REDESIGN_ARTIFACT_INVALID",
  );
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });

  // The index belongs to another build identity.
  persistRedesignArtifact(ctx, "competitive-landscape", landscape);
  const other = ctxFor("some-other-build");
  writeFileSync(
    resolve(redesignIntelligenceDir(other), "index.json").replace("some-other-build", BUILD_ID),
    readFileSync(resolve(redesignIntelligenceDir(ctx), "index.json"), "utf-8").replace(
      BUILD_ID,
      "some-other-build",
    ),
    "utf-8",
  );
  assert.throws(
    () => readRedesignIntelligenceIndex(ctx),
    (error: unknown) => error instanceof BuildError && error.code === "REDESIGN_ARTIFACT_INVALID",
  );
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });

  // Lineage: a persisted SEO blueprint that references a DIFFERENT landscape.
  const foreignLandscape = makeLandscape({
    donorDomains: Array.from({ length: 10 }, (_, i) => `other-${i}.example.com`),
  });
  persistRedesignArtifact(ctx, "competitive-landscape", foreignLandscape);
  persistRedesignArtifact(ctx, "seo-content-blueprint", seoBlueprint);
  assert.throws(
    () => loadPersistedRedesignIntelligence(ctx),
    /REDESIGN_ARTIFACT_INVALID|lineage broken/,
  );
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});

void test("dry runs persist nothing", () => {
  const ctx = ctxFor("dry-run-build", { dryRun: true });
  assert.equal(persistRedesignArtifact(ctx, "client-vision", { declared: false }), undefined);
  assert.equal(existsSync(redesignIntelligenceDir(ctx)), false);
});

void test("resume: competitive intelligence reuses the persisted chain and never calls SEO-Bot", async () => {
  const ctx = ctxFor(BUILD_ID, {
    resume: true,
    seoBuildIntelligencePreflight: { status: "ready" } as never,
  });
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
  const { landscape, blueprint } = sealedChain();
  persistRedesignArtifact(ctx, "competitive-landscape", landscape);
  persistRedesignArtifact(
    ctx,
    "accepted-donors",
    Array.from({ length: 10 }, (_, i) => makeDonorEvidence(`donor-${i}.example.com`)),
  );
  persistRedesignArtifact(ctx, "website-build-blueprint", blueprint);
  persistRedesignArtifact(ctx, "seo-bot-ordering", {
    preflight_produced_at: "a",
    landscape_produced_at: "b",
  });

  const calls: string[] = [];
  const port: SeoBuildIntelligencePort = {
    async preflight() {
      calls.push("preflight");
      throw new Error("must not be called on resume");
    },
    async createCompetitiveLandscape() {
      calls.push("landscape");
      throw new Error("must not be called on resume");
    },
    async createSEOContentBlueprint() {
      throw new Error("unused");
    },
    async createStructuredContent() {
      throw new Error("unused");
    },
  };
  process.env.SEO_BOT_URL = "https://seo-bot.invalid";
  process.env.SEO_BOT_API_KEY = "resume-test-key";
  await new CompetitiveIntelligenceStage(
    () => port,
    () => ({
      async ingest() {
        throw new Error("must not crawl on resume");
      },
      async close() {},
    }),
  ).run(ctx);
  assert.deepEqual(calls, []);
  assert.equal(ctx.competitiveLandscape?.artifact_id, landscape.artifact_id);
  assert.equal(ctx.websiteBlueprint?.artifact_id, blueprint.artifact_id);
  assert.equal(ctx.acceptedDonors?.length, 10);
  assert.equal(ctx.seoBotOrdering?.preflight_produced_at, "a");
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});

void test("resume: content authority reuses the persisted, lineage-verified chain", async () => {
  const ctx = ctxFor(BUILD_ID, {
    resume: true,
    seoBuildIntelligencePreflight: { status: "ready" } as never,
  });
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
  const chain = sealedChain();
  ctx.competitiveLandscape = chain.landscape;
  ctx.websiteBlueprint = chain.blueprint;
  persistRedesignArtifact(ctx, "competitive-landscape", chain.landscape);
  persistRedesignArtifact(ctx, "website-build-blueprint", chain.blueprint);
  persistRedesignArtifact(ctx, "seo-content-blueprint", chain.seoBlueprint);
  persistRedesignArtifact(ctx, "page-content-contract", chain.contract);
  persistRedesignArtifact(ctx, "pcc-determinism", {
    digestRun1: "x",
    digestRun2: "x",
    sameSemanticInputSameDigest: true,
  });
  persistRedesignArtifact(ctx, "structured-content-package", chain.contentPackage);
  persistRedesignArtifact(ctx, "redesign-counters", {
    pageContentContractLlmCalls: 0,
    legacyContentGenerationCalls: 0,
    redesignSchemaLlmCalls: 0,
  });

  const port: SeoBuildIntelligencePort = {
    async preflight() {
      throw new Error("unused");
    },
    async createCompetitiveLandscape() {
      throw new Error("unused");
    },
    async createSEOContentBlueprint() {
      throw new Error("must not be called on resume");
    },
    async createStructuredContent() {
      throw new Error("must not be called on resume");
    },
  };
  await new RedesignContentAuthorityStage(() => port).run(ctx);
  assert.equal(ctx.seoContentBlueprint?.artifact_id, chain.seoBlueprint.artifact_id);
  assert.equal(ctx.structuredContentPackage?.artifact_id, chain.contentPackage.artifact_id);
  assert.equal(ctx.pccDeterminism?.sameSemanticInputSameDigest, true);

  // A fresh context hydrates the whole chain from disk with lineage intact.
  const fresh = ctxFor(BUILD_ID);
  const hydrated = hydrateRedesignIntelligence(fresh, [
    "competitive-landscape",
    "website-build-blueprint",
    "seo-content-blueprint",
    "page-content-contract",
    "structured-content-package",
  ]);
  assert.equal(hydrated.length, 5);
  assert.equal(
    fresh.pageContentContract?.payload.inputs.website_build_blueprint.artifact_id,
    chain.blueprint.artifact_id,
  );
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
});
