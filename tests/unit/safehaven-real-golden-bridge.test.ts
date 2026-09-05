// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Safe Haven real-Golden bridge: the no-spend contract suite.
//
// Nothing here touches the network, a provider, a browser, or the paid Golden
// path. Every test drives the bridge's own decision logic with real artifacts
// and fakes, and asserts the fail-closed behaviour that keeps an unproven run
// from reaching the sealed verifier.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import {
  refForArtifact,
  type StructuredContentPackageArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import { parse } from "yaml";
import {
  assertSeoAudit,
  assertVisualEvidence,
  GoldenReceiptMergeError,
  mergeGoldenReceipt,
} from "../../scripts/build-safehaven-real-golden-receipt.js";
import {
  buildSafeHavenRuntimeEvidence,
  installedPackageVersion,
  SafeHavenRuntimeEvidenceError,
  validateSafeHavenRuntimeEvidence,
} from "../../scripts/lib/safehaven-golden-runtime-evidence.js";
import {
  GoldenVisualError,
  normalizeDelta,
  normalizePreference,
  orientationForTrial,
  parseJudgeResponse,
  type RenderedRouteObservation,
  resolveInternalPath,
  scanBusinessTruth,
  summarizeBusinessTruth,
  summarizeSite,
} from "../../scripts/run-safehaven-golden-visual.js";
import { compilePageContentContract } from "../../src/intelligence/compile-page-content-contract.js";
import { verifiedBusinessFactsFromSpec } from "../../src/intelligence/verified-business-facts.js";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { validateDomainSpec } from "../../src/pipeline/validateDomainSpec.js";
import {
  BUILD_ID,
  CLIENT_ID,
  makeDonorEvidence,
  makeLandscape,
  makeSeoBlueprint,
  makeWebsiteBlueprint,
} from "./redesign-fixtures.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CASE_PATH = resolve(REPO_ROOT, "tests/golden/safehaven/case.json");
const ORACLE_PATH = resolve(REPO_ROOT, "tests/golden/safehaven/oracle.json");
const SPEC_PATH = resolve(REPO_ROOT, "tests/golden/safehaven/domain_spec.normalized.yaml");

const testCase = JSON.parse(readFileSync(CASE_PATH, "utf-8")) as Record<string, never>;
const oracle = JSON.parse(readFileSync(ORACLE_PATH, "utf-8")) as Record<
  string,
  Record<string, never>
>;

const LOCAL_ROUTER_VERSION = installedPackageVersion("@quantum-l9", "llm-router", REPO_ROOT);
const LOCAL_INTEROP_VERSION = installedPackageVersion("@quantum-l9", "bot-interop", REPO_ROOT);

/**
 * Every scratch directory this suite creates lives under one root that is
 * removed when the file finishes. The fixtures below deliberately write real
 * bytes to disk — donor screenshots must be hashable for the donor-reuse gate
 * to mean anything — but a test run must not leave that litter behind.
 */
const TEMP_ROOT = mkdtempSync(join(tmpdir(), "safehaven-bridge-"));
let temporaryDirCounter = 0;

after(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

function temporaryDir(prefix: string): string {
  temporaryDirCounter += 1;
  const path = join(TEMP_ROOT, `${prefix}-${temporaryDirCounter}`);
  mkdirSync(path, { recursive: true });
  return path;
}

/* =========================================================
 * DOMAINSPEC
 * ======================================================= */

const goldenSpec = validateDomainSpec(parse(readFileSync(SPEC_PATH, "utf-8")), SPEC_PATH);

void test("Safe Haven DomainSpec validates and declares the redesign intent", () => {
  assert.equal(goldenSpec.client_id, "safehavenrr_com");
  assert.equal(goldenSpec.build_intent, "REDESIGN_IMPROVE");
});

void test("Safe Haven DomainSpec carries the exact frozen 29-route set in case order", () => {
  const caseRoutes = testCase.routes as unknown as string[];
  assert.equal(caseRoutes.length, 29);
  assert.deepEqual(
    goldenSpec.routes.map((route) => route.slug),
    caseRoutes,
  );
});

void test("Safe Haven DomainSpec enables source-site harvesting for asset reuse", () => {
  assert.equal(goldenSpec.assets?.sourceSite?.enabled, true);
  assert.equal(goldenSpec.assets?.sourceSite?.url, "https://www.safehavenrr.com");
  assert.equal(goldenSpec.assets?.sourceSite?.downloadImages, true);
});

void test("the sealed case still forbids donor asset reuse", () => {
  const sourceAssets = testCase.source_assets as unknown as Record<string, unknown>;
  assert.equal(sourceAssets.donor_asset_policy, "DONOR_REFERENCE_ONLY");
  assert.equal(sourceAssets.reuse_policy, "client_owned_authorized");
  assert.equal(sourceAssets.harvest, true);
});

void test("the Safe Haven DomainSpec declares no unverified deployment target", () => {
  // Deployment/provisioning is a material UNKNOWN. A placeholder repo or Vercel
  // project must never appear here just to unblock an end-to-end run.
  assert.equal(goldenSpec.deploy, undefined);
  assert.equal(goldenSpec.provision, undefined);
});

/* =========================================================
 * PCC DETERMINISM
 * ======================================================= */

function pccDigest(payload: unknown): string {
  return JSON.stringify(payload);
}

void test("two compiler passes over the same semantic input produce equal PCC digests", () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const facts = verifiedBusinessFactsFromSpec({
    ...goldenSpec,
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
  });
  const runOne = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const runTwo = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  assert.equal(pccDigest(runOne), pccDigest(runTwo));
});

void test("a changed semantic input produces a different PCC digest", () => {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  const baseFacts = verifiedBusinessFactsFromSpec({
    ...goldenSpec,
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
  });
  const changedFacts = verifiedBusinessFactsFromSpec({
    ...goldenSpec,
    business_name: "A Different Business",
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
  });
  const runOne = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: baseFacts,
    compilerVersion: "1.0.0",
  });
  const runTwo = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: changedFacts,
    compilerVersion: "1.0.0",
  });
  assert.notEqual(pccDigest(runOne), pccDigest(runTwo));
});

/* =========================================================
 * RUNTIME EVIDENCE
 * ======================================================= */

const IDENTITY_DIR = temporaryDir("identity");
const VALID_IDENTITY_PATH = join(IDENTITY_DIR, "identity.json");
writeFileSync(
  VALID_IDENTITY_PATH,
  JSON.stringify({
    schema: "l9.golden-external-identity/v1",
    seo_bot: { sha: "a".repeat(40), worktree_state: "CLEAN" },
    llm_router: { sha: "b".repeat(40), worktree_state: "CLEAN" },
  }),
);

function writeIdentityManifest(body: unknown): string {
  const path = join(temporaryDir("identity"), "identity.json");
  writeFileSync(path, JSON.stringify(body));
  return path;
}

function makePreflightSnapshot(overrides?: Record<string, unknown>) {
  return {
    status: "ok",
    service: "seo-bot",
    version: "5.2.0",
    bot_interop_version: LOCAL_INTEROP_VERSION,
    llm_router_version: LOCAL_ROUTER_VERSION,
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: true,
    },
    configuration: { dataforseo_configured: true, llm_provider_configured: true },
    ...overrides,
  };
}

const VISUAL_REQUIREMENTS = [
  {
    requirement_id: "vr-hero",
    route_id: "/",
    section_id: "hero",
    slot_id: "hero",
    role: "hero" as const,
    required: true,
    min_count: 1,
    preferred_provenance: ["source" as const, "generated" as const],
    device_suitability: ["desktop" as const, "mobile" as const],
  },
  {
    requirement_id: "vr-proof",
    route_id: "/",
    section_id: "overview",
    slot_id: "project_proof",
    role: "project_proof" as const,
    required: true,
    min_count: 1,
    preferred_provenance: ["source" as const],
    device_suitability: ["desktop" as const],
  },
  {
    requirement_id: "vr-gallery",
    route_id: "/",
    section_id: "overview",
    slot_id: "gallery",
    role: "gallery" as const,
    required: true,
    min_count: 1,
    preferred_provenance: ["source" as const],
    device_suitability: ["desktop" as const],
  },
];

function makeGoldenContext(): BuildContext {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, { visual_requirements: VISUAL_REQUIREMENTS });
  const seoBlueprint = makeSeoBlueprint(landscape);
  const facts = verifiedBusinessFactsFromSpec({
    ...goldenSpec,
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
  });
  const payload = compilePageContentContract({
    websiteBlueprint: blueprint,
    seoBlueprint,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const contract = sealIntelligenceArtifact({
    artifact_type: "page_content_contract",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "Website-Bot", version: "1.0.0" },
    produced_at: "2026-08-17T00:00:00.000Z",
    input_refs: [refForArtifact(blueprint), refForArtifact(seoBlueprint)],
    payload,
  });
  const contentPackage: StructuredContentPackageArtifact = sealIntelligenceArtifact({
    artifact_type: "structured_content_package",
    client_id: CLIENT_ID,
    build_id: BUILD_ID,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-08-17T00:00:00.000Z",
    input_refs: [refForArtifact(contract)],
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
      page_content_contract_ref: refForArtifact(contract),
      routes: [
        {
          route_id: "/",
          path: "/",
          metadata: { title: "Safe Haven | Charlotte Roofing", description: "Local roofing." },
          sections: [
            {
              section_id: "hero",
              heading: "Charlotte roofing done right",
              blocks: [{ kind: "paragraph", text: "Free inspections across Charlotte." }],
            },
            {
              section_id: "overview",
              heading: "What we do",
              blocks: [{ kind: "bullets", items: ["Roof replacement", "Storm damage"] }],
            },
          ],
          faqs: [],
          internal_links: [],
          schema_content_inputs: { local_business: true },
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

  // Real donor screenshot bytes on disk: donor-byte reuse must be disprovable.
  const donorDir = temporaryDir("donors");
  const donors = landscape.payload.selected_donors.map((donor) => {
    const evidence = makeDonorEvidence(donor.domain);
    const screenshotPath = join(donorDir, `${donor.domain}.png`);
    writeFileSync(screenshotPath, `donor-screenshot-${donor.domain}`);
    return { ...evidence, screenshot_paths: [screenshotPath] };
  });

  const stageResults = new Map<string, { ok: boolean; skipped?: boolean }>([
    ["domain-spec-loader", { ok: true }],
    ["unknown-resolver", { ok: true }],
    ["seo-build-intelligence-preflight", { ok: true }],
    ["competitive-intelligence", { ok: true }],
    ["source-site-ingestion", { ok: true }],
    ["design-intelligence", { ok: true }],
    ["redesign-content-authority", { ok: true }],
    ["structured-content-projection", { ok: true }],
    ["redesign-schema-serializer", { ok: true }],
    ["image-asset-planning", { ok: true }],
    ["placeholder-scan", { ok: true }],
    ["site-assembler", { ok: true }],
    ["site-build", { ok: true }],
    ["visual-qa", { ok: true }],
    ["redesign-integrity-receipt", { ok: true }],
    ["terminal-convergence", { ok: true }],
  ]);

  return {
    buildId: BUILD_ID,
    clientId: CLIENT_ID,
    dryRun: false,
    mode: "end-to-end",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: goldenSpec,
    stageResults,
    qualityEvidence: { seoBaseline: "passed", visualQa: "passed" },
    seoBuildIntelligencePreflight: makePreflightSnapshot(),
    competitiveLandscape: landscape,
    acceptedDonors: donors,
    websiteBlueprint: blueprint,
    seoContentBlueprint: seoBlueprint,
    pageContentContract: contract,
    structuredContentPackage: contentPackage,
    redesignCounters: {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    },
    pccDeterminism: {
      digestRun1: `sha256:${"1".repeat(64)}`,
      digestRun2: `sha256:${"1".repeat(64)}`,
      sameSemanticInputSameDigest: true,
    },
    sourceSiteManifest: {
      schema: "website-bot.source-site-manifest/v1",
      sourceUrl: "https://www.safehavenrr.com",
      crawledAt: "2026-08-17T00:00:00.000Z",
      crawlerVersion: "1.0.0",
      pages: [{ url: "https://www.safehavenrr.com/", headings: [], depth: 0 }],
      images: [
        {
          id: "img-1",
          sourceUrl: "https://www.safehavenrr.com/a.jpg",
          referringPageUrl: "https://www.safehavenrr.com/",
          localPath: "/tmp/a.jpg",
          mimeType: "image/jpeg",
          width: 1200,
          height: 800,
          byteLength: 100,
          sha256: "c".repeat(64),
          provenance: "source-site",
        },
      ],
      rejected: [],
      warnings: [],
    },
    sourceAssetDecisions: [
      {
        assetPath: "/tmp/a.jpg",
        decision: "SELECTED",
        reason: "selected for blueprint visual slot hero",
        slotId: "hero",
      },
    ],
    imageAssetPlan: {
      schema: "website-bot.image-asset-plan/v1",
      version: "1.0.0",
      assets: [
        {
          slotId: "hero",
          placement: "/:hero",
          required: true,
          resolution: { source: "source-site", candidateId: "img-1", score: 1 },
        },
        {
          slotId: "project_proof",
          placement: "/:proof",
          required: true,
          resolution: { source: "source-site", candidateId: "img-1", score: 1 },
        },
        {
          slotId: "gallery",
          placement: "/:gallery",
          required: true,
          resolution: { source: "source-site", candidateId: "img-1", score: 1 },
        },
      ],
    },
    imageAssetManifest: {
      schema: "website-bot.image-asset-manifest/v1",
      buildId: BUILD_ID,
      clientId: CLIENT_ID,
      generatedAt: "2026-08-17T00:00:00.000Z",
      assets: [
        {
          slotId: "hero",
          placement: "/:hero",
          source: "source-site",
          outputPath: "public/images/hero.jpg",
          mimeType: "image/jpeg",
          width: 1200,
          height: 800,
          byteLength: 100,
          sha256: "c".repeat(64),
          disposition: "approved-client-owned",
          provenanceWarnings: [],
        },
      ],
      digest: "d".repeat(64),
    },
    assemblyManifest: {
      schema: "website-bot.assembly-manifest/v2",
      buildId: BUILD_ID,
      clientId: CLIENT_ID,
      generatorVersion: "1.0.0",
      templateVersion: "1.0.0",
      templateDigest: "e".repeat(64),
      routes: (testCase.routes as unknown as string[]).slice(),
      files: [],
      sourceDigest: "f".repeat(64),
    },
  } as unknown as BuildContext;
}

const RUNTIME_OPTIONS = {
  casePath: CASE_PATH,
  oraclePath: ORACLE_PATH,
  identityManifestPath: VALID_IDENTITY_PATH,
  outputPath: join(temporaryDir("out"), "runtime.json"),
};

async function expectRuntimeHalt(
  ctx: BuildContext,
  code: string,
  options = RUNTIME_OPTIONS,
): Promise<void> {
  await assert.rejects(
    () => buildSafeHavenRuntimeEvidence(ctx, options),
    (error: unknown) => {
      assert.ok(error instanceof SafeHavenRuntimeEvidenceError, String(error));
      assert.equal(error.code, code);
      return true;
    },
  );
}

void test("a complete redesign run produces valid Safe Haven runtime evidence", async () => {
  const evidence = await buildSafeHavenRuntimeEvidence(makeGoldenContext(), RUNTIME_OPTIONS);
  validateSafeHavenRuntimeEvidence(evidence);
  assert.equal(evidence.run.build_intent, "REDESIGN_IMPROVE");
  assert.equal(evidence.preflight.checks.length, 9);
  assert.equal(evidence.competitive_landscape.selected_donors.length, 10);
  assert.equal(evidence.donor_evidence.length, 10);
  assert.equal(evidence.legacy.page_content_contract_llm_calls, 0);
  assert.equal(evidence.assets.donor_asset_hash_matches, 0);
  assert.equal(evidence.assets.required_visual_slots_filled_fraction, 1);
});

void test("SEO-owned execution counters are reported as unresolved, never invented", async () => {
  const evidence = await buildSafeHavenRuntimeEvidence(makeGoldenContext(), RUNTIME_OPTIONS);
  assert.equal(evidence.seo_content_blueprint.batch_size, null);
  assert.equal(evidence.seo_content_blueprint.batch_count, null);
  assert.equal(evidence.competitive_landscape.ranking_llm_calls, null);
  for (const row of evidence.structured_content.route_results) {
    assert.equal(row.repair_attempts, null);
    assert.equal(row.generation_calls, null);
  }
  const fields = evidence.unresolved_external_dependencies.map((entry) => entry.field);
  assert.equal(fields.length, 3);
  for (const entry of evidence.unresolved_external_dependencies) {
    assert.equal(entry.owner, "SEO-Bot");
  }
});

void test("runtime evidence rejects a missing external identity manifest", async () => {
  await expectRuntimeHalt(makeGoldenContext(), "IDENTITY_EVIDENCE_MISSING", {
    ...RUNTIME_OPTIONS,
    identityManifestPath: join(IDENTITY_DIR, "does-not-exist.json"),
  });
});

void test("runtime evidence rejects a short/invalid external SHA", async () => {
  const path = writeIdentityManifest({
    schema: "l9.golden-external-identity/v1",
    seo_bot: { sha: "abc123", worktree_state: "CLEAN" },
    llm_router: { sha: "b".repeat(40), worktree_state: "CLEAN" },
  });
  await expectRuntimeHalt(makeGoldenContext(), "IDENTITY_SHA_INVALID", {
    ...RUNTIME_OPTIONS,
    identityManifestPath: path,
  });
});

void test("runtime evidence rejects a dirty external worktree that was not explicitly recorded", async () => {
  const path = writeIdentityManifest({
    schema: "l9.golden-external-identity/v1",
    seo_bot: { sha: "a".repeat(40), worktree_state: { clean: false } },
    llm_router: { sha: "b".repeat(40), worktree_state: "CLEAN" },
  });
  await expectRuntimeHalt(makeGoldenContext(), "WORKTREE_STATE_UNRECORDED_DIRTY", {
    ...RUNTIME_OPTIONS,
    identityManifestPath: path,
  });
});

void test("runtime evidence accepts a dirty external worktree recorded with a diff identity", async () => {
  const path = writeIdentityManifest({
    schema: "l9.golden-external-identity/v1",
    seo_bot: {
      sha: "a".repeat(40),
      worktree_state: { clean: false, explicitly_recorded: true, diff_identity: "sha256:abc" },
    },
    llm_router: { sha: "b".repeat(40), worktree_state: "CLEAN" },
  });
  const evidence = await buildSafeHavenRuntimeEvidence(makeGoldenContext(), {
    ...RUNTIME_OPTIONS,
    identityManifestPath: path,
  });
  assert.deepEqual(evidence.identity.seo_bot.worktree_state, {
    clean: false,
    explicitly_recorded: true,
    diff_identity: "sha256:abc",
  });
});

void test("runtime evidence rejects a run without preflight evidence", async () => {
  const ctx = makeGoldenContext();
  ctx.seoBuildIntelligencePreflight = undefined;
  await expectRuntimeHalt(ctx, "PREFLIGHT_EVIDENCE_MISSING");
});

void test("runtime evidence rejects a preflight whose capability is not proven", async () => {
  const ctx = makeGoldenContext();
  ctx.seoBuildIntelligencePreflight = makePreflightSnapshot({
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: false,
      structured_content: true,
    },
  }) as BuildContext["seoBuildIntelligencePreflight"];
  await expectRuntimeHalt(ctx, "PREFLIGHT_EVIDENCE_MISSING");
});

void test("runtime evidence rejects a run with no donor evidence", async () => {
  const ctx = makeGoldenContext();
  ctx.acceptedDonors = undefined;
  await expectRuntimeHalt(ctx, "REDESIGN_EVIDENCE_MISSING");
});

void test("runtime evidence rejects a donor evidence/landscape domain mismatch", async () => {
  const ctx = makeGoldenContext();
  const donors = ctx.acceptedDonors ?? [];
  ctx.acceptedDonors = donors.map((donor, index) =>
    index === 0 ? { ...donor, domain: "not-a-selected-donor.example.com" } : donor,
  );
  await expectRuntimeHalt(ctx, "DONOR_EVIDENCE_INCOMPLETE");
});

void test("runtime evidence rejects a run with no WebsiteBuildBlueprint", async () => {
  const ctx = makeGoldenContext();
  ctx.websiteBlueprint = undefined;
  await expectRuntimeHalt(ctx, "REDESIGN_EVIDENCE_MISSING");
});

void test("runtime evidence rejects a missing PCC determinism proof", async () => {
  const ctx = makeGoldenContext();
  ctx.pccDeterminism = undefined;
  await expectRuntimeHalt(ctx, "PCC_DETERMINISM_EVIDENCE_MISSING");
});

void test("runtime evidence rejects two unequal PCC digests", async () => {
  const ctx = makeGoldenContext();
  ctx.pccDeterminism = {
    digestRun1: `sha256:${"1".repeat(64)}`,
    digestRun2: `sha256:${"2".repeat(64)}`,
    sameSemanticInputSameDigest: true,
  };
  await expectRuntimeHalt(ctx, "PCC_DETERMINISM_EVIDENCE_MISSING");
});

void test("runtime evidence rejects an SCP that is missing a contract route", async () => {
  const ctx = makeGoldenContext();
  ctx.structuredContentPackage = undefined;
  await expectRuntimeHalt(ctx, "REDESIGN_EVIDENCE_MISSING");
});

void test("runtime evidence refuses a run that did not reach terminal convergence", async () => {
  const ctx = makeGoldenContext();
  ctx.stageResults.set("terminal-convergence", { ok: false });
  await expectRuntimeHalt(ctx, "GOLDEN_RUN_NOT_ELIGIBLE");
});

void test("runtime evidence refuses a non-redesign or non-end-to-end run", async () => {
  const copyCtx = makeGoldenContext();
  copyCtx.buildIntent = "COPY";
  await expectRuntimeHalt(copyCtx, "GOLDEN_RUN_NOT_ELIGIBLE");
  const planCtx = makeGoldenContext();
  planCtx.mode = "plan";
  await expectRuntimeHalt(planCtx, "GOLDEN_RUN_NOT_ELIGIBLE");
});

void test("runtime evidence refuses to emit when a legacy authority stage executed", async () => {
  const ctx = makeGoldenContext();
  ctx.stageResults.set("content-generation", { ok: true });
  await expectRuntimeHalt(ctx, "LEGACY_AUTHORITY_EVIDENCE_MISSING");
});

void test("runtime evidence refuses to emit when the placeholder scan did not run", async () => {
  const ctx = makeGoldenContext();
  ctx.stageResults.set("placeholder-scan", { ok: false });
  await expectRuntimeHalt(ctx, "SITE_BUILD_EVIDENCE_MISSING");
});

void test("semantic events are emitted only when the runtime fact behind them exists", async () => {
  const evidence = await buildSafeHavenRuntimeEvidence(makeGoldenContext(), RUNTIME_OPTIONS);
  const names = evidence.events.map((event) => event.name);
  assert.ok(
    names.indexOf("seo-build-intelligence-preflight:PASS") <
      names.indexOf("seo:createCompetitiveLandscape"),
  );
  const requiredStages = oracle.execution_graph.required_ordered_subsequence as unknown as string[];
  for (const required of requiredStages) {
    assert.ok(names.includes(required), `missing stage event ${required}`);
  }
});

/* =========================================================
 * VISUAL EVIDENCE
 * ======================================================= */

const DIMENSION_NAMES = Object.keys(oracle.visual_oracle.dimensions as unknown as object);
const SCORE_SCALE = oracle.visual_oracle.score_scale as unknown as {
  minimum: number;
  maximum: number;
};

function judgeJson(preference: string, score: number): string {
  return JSON.stringify({
    preference,
    confidence: 0.8,
    dimensions: Object.fromEntries(DIMENSION_NAMES.map((name) => [name, score])),
    critical_defects_a: ["NONE"],
    critical_defects_b: ["NONE"],
    short_reason: "Observable evidence only.",
  });
}

void test("orientation follows the anti-bias schedule: randomized, reversed, independent", () => {
  const first = orientationForTrial(0, null, () => true);
  assert.deepEqual(first, { A: "CANDIDATE", B: "BASELINE", randomized: true });
  const second = orientationForTrial(1, { A: first.A, B: first.B }, () => true);
  assert.deepEqual(second, { A: "BASELINE", B: "CANDIDATE", reversed_from_trial_1: true });
  const third = orientationForTrial(2, { A: first.A, B: first.B }, () => false);
  assert.equal(third.randomized, true);
  assert.equal(third.independent, true);
});

void test("normalization maps raw A/B judgements back to candidate orientation", () => {
  assert.equal(normalizePreference("B", { A: "BASELINE", B: "CANDIDATE" }), "CANDIDATE");
  assert.equal(normalizePreference("B", { A: "CANDIDATE", B: "BASELINE" }), "BASELINE");
  assert.equal(normalizePreference("TIE", { A: "CANDIDATE", B: "BASELINE" }), "TIE");
  assert.equal(normalizeDelta(2, { A: "BASELINE", B: "CANDIDATE" }), 2);
  assert.equal(normalizeDelta(2, { A: "CANDIDATE", B: "BASELINE" }), -2);
});

void test("a judge score outside the oracle scale is rejected, never clamped", () => {
  assert.throws(
    () => parseJudgeResponse(judgeJson("B", 999), DIMENSION_NAMES, SCORE_SCALE),
    (error: unknown) => {
      assert.ok(error instanceof GoldenVisualError);
      assert.equal(error.code, "VISUAL_RAW_DIMENSION_SCORE_OUT_OF_RANGE");
      return true;
    },
  );
});

void test("a judge response missing a dimension is rejected, never defaulted", () => {
  const partial = JSON.parse(judgeJson("B", 1)) as { dimensions: Record<string, number> };
  delete partial.dimensions[DIMENSION_NAMES[0] as string];
  assert.throws(
    () => parseJudgeResponse(JSON.stringify(partial), DIMENSION_NAMES, SCORE_SCALE),
    (error: unknown) => {
      assert.ok(error instanceof GoldenVisualError);
      assert.equal(error.code, "VISUAL_RAW_DIMENSION_MISSING");
      return true;
    },
  );
});

void test("an unusable judge preference is rejected", () => {
  assert.throws(
    () => parseJudgeResponse(judgeJson("MAYBE", 1), DIMENSION_NAMES, SCORE_SCALE),
    (error: unknown) => {
      assert.ok(error instanceof GoldenVisualError);
      assert.equal(error.code, "VISUAL_RAW_PREFERENCE_INVALID");
      return true;
    },
  );
});

/* =========================================================
 * SITE INTEGRITY
 * ======================================================= */

const CASE_ROUTES = testCase.routes as unknown as string[];

function makeObservation(
  route: string,
  overrides?: Partial<RenderedRouteObservation>,
): RenderedRouteObservation {
  return {
    route,
    http_status: 200,
    final_pathname: route === "/" ? "/" : route.replace(/\/+$/, ""),
    path_drift: false,
    h1_count: 1,
    title: `Safe Haven ${route}`,
    meta_description: `Description for ${route}`,
    canonical: `https://candidate.example.com${route}`,
    lang: "en",
    internal_links: [],
    text_length: 4_000,
    ...overrides,
  };
}

function makeObservations(
  overrides?: Partial<RenderedRouteObservation>,
  index = 0,
): RenderedRouteObservation[] {
  return CASE_ROUTES.map((route, position) =>
    position === index && overrides ? makeObservation(route, overrides) : makeObservation(route),
  );
}

void test("29 healthy routes are all reachable with unique titles and canonicals", () => {
  const site = summarizeSite(makeObservations(), CASE_ROUTES);
  assert.equal(site.reachable_routes, 29);
  assert.equal(site.unique_titles, 29);
  assert.equal(site.unique_canonical_urls, 29);
  assert.equal(site.broken_internal_links, 0);
});

void test("a 404 route is not counted as reachable", () => {
  const site = summarizeSite(makeObservations({ http_status: 404 }), CASE_ROUTES);
  assert.equal(site.reachable_routes, 28);
});

void test("a redirected route is not counted as reachable", () => {
  const site = summarizeSite(makeObservations({ path_drift: true }), CASE_ROUTES);
  assert.equal(site.reachable_routes, 28);
});

void test("a route with zero or two H1s is not counted as reachable", () => {
  assert.equal(summarizeSite(makeObservations({ h1_count: 0 }), CASE_ROUTES).reachable_routes, 28);
  assert.equal(summarizeSite(makeObservations({ h1_count: 2 }), CASE_ROUTES).reachable_routes, 28);
});

void test("duplicate titles and duplicate canonicals are visible in the summary", () => {
  const duplicateTitle = summarizeSite(makeObservations({ title: "Safe Haven /" }, 1), CASE_ROUTES);
  assert.equal(duplicateTitle.unique_titles, 28);
  const duplicateCanonical = summarizeSite(
    makeObservations({ canonical: "https://candidate.example.com/" }, 1),
    CASE_ROUTES,
  );
  assert.equal(duplicateCanonical.unique_canonical_urls, 28);
});

void test("a link to a route outside the frozen set counts as a broken internal link", () => {
  const site = summarizeSite(
    makeObservations({ internal_links: ["/does-not-exist"] }),
    CASE_ROUTES,
  );
  assert.equal(site.broken_internal_links, 1);
});

void test("mailto, tel, javascript and fragment links are never treated as internal targets", () => {
  const page = "https://candidate.example.com/contact/";
  const origin = "https://candidate.example.com";
  for (const href of ["mailto:info@x.com", "tel:+17046487252", "javascript:void(0)", "#main"]) {
    assert.equal(resolveInternalPath(href, page, origin), null);
  }
  assert.equal(resolveInternalPath("https://other.example.com/x", page, origin), null);
  assert.equal(resolveInternalPath("/about/", page, origin), "/about");
});

/* =========================================================
 * BUSINESS TRUTH
 * ======================================================= */

const FACTS = testCase.verified_business_facts as unknown as {
  phone_display: string;
  phone_e164: string;
  email: string;
};
const FORBIDDEN = (testCase.fact_guardrails as unknown as { forbidden_patterns: string[] })
  .forbidden_patterns;

void test("a clean rendered page produces zero business-truth violations", () => {
  const html = `<a href="tel:+17046487252">${FACTS.phone_display}</a><a href="mailto:${FACTS.email}">${FACTS.email}</a>`;
  const text = "Locally owned roofing in Charlotte with free inspections.";
  const summary = summarizeBusinessTruth(scanBusinessTruth("/", text, html, FACTS, FORBIDDEN));
  assert.equal(summary.phone_mismatch_count, 0);
  assert.equal(summary.email_mismatch_count, 0);
  assert.equal(summary.prohibition_violations, 0);
});

void test("a wrong phone number increments the phone mismatch count", () => {
  const html = `<a href="tel:+18005551234">(800) 555-1234</a>`;
  const summary = summarizeBusinessTruth(scanBusinessTruth("/", "", html, FACTS, FORBIDDEN));
  assert.ok(summary.phone_mismatch_count > 0);
});

void test("a wrong email increments the email mismatch count", () => {
  const html = `<a href="mailto:sales@notsafehaven.com">sales@notsafehaven.com</a>`;
  const summary = summarizeBusinessTruth(scanBusinessTruth("/", "", html, FACTS, FORBIDDEN));
  assert.ok(summary.email_mismatch_count > 0);
});

void test("a forbidden claim pattern is recorded as a prohibition violation", () => {
  const text = "With decades of combined experience and the guaranteed lowest price.";
  const summary = summarizeBusinessTruth(scanBusinessTruth("/", text, "", FACTS, FORBIDDEN));
  assert.equal(summary.prohibition_violations, 2);
});

/* =========================================================
 * RECEIPT MERGER
 * ======================================================= */

const SENTINELS = testCase.visual_sentinels as unknown as Array<{ route: string }>;
const VIEWPORTS = testCase.viewports as unknown as Array<{ id: string }>;
const TRIALS_PER_PAIR = (oracle.visual_oracle as unknown as { trials_per_pair: number })
  .trials_per_pair;

function normalizeRouteKey(route: string): string {
  return route === "/" ? "/" : route.replace(/\/+$/, "");
}

function makeSeoAuditFile(runId: string): { path: string; body: Record<string, unknown> } {
  const call = (id: string) => ({
    audit_id: id,
    searchRequired: false,
    searchPolicySource: "EXPLICIT",
    provider: "openrouter",
    model: "test-model",
    request_id: `req-${id}`,
  });
  const body = {
    schema: "l9.seo-bot-run-llm-audit/v1",
    run_id: runId,
    case_id: testCase.case_id,
    direct_provider_bypass_count: 0,
    unsupported_capability_combination_count: 0,
    operations: {
      SEO_CONTENT_BLUEPRINT: [call("scb-1")],
      STRUCTURED_CONTENT_GENERATION: [call("scg-1")],
      CONTENT_VALIDATION: [call("cv-1")],
    },
    execution: {
      competitive_landscape: { ranking_llm_calls: 0 },
      seo_content_blueprint: { batch_size: 4, batch_count: 8 },
      structured_content: {
        route_results: [{ route_id: "/", path: "/", repair_attempts: 0, generation_calls: 1 }],
      },
    },
  };
  const path = join(temporaryDir("seo-audit"), "seo-llm-audit.json");
  writeFileSync(path, JSON.stringify(body));
  return { path, body };
}

function makeRenderedEvidence(runId: string): Record<string, unknown> {
  const observations = makeObservations();
  const auditRecords: Array<Record<string, unknown>> = [];
  const pairs = SENTINELS.flatMap((sentinel) =>
    VIEWPORTS.map((viewport) => {
      const trials = Array.from({ length: TRIALS_PER_PAIR }, (_, index) => {
        const orientation =
          index === 1
            ? { A: "BASELINE", B: "CANDIDATE", reversed_from_trial_1: true }
            : {
                A: "CANDIDATE",
                B: "BASELINE",
                randomized: true,
                ...(index === 2 ? { independent: true } : {}),
              };
        const auditId = `visual-${normalizeRouteKey(sentinel.route)}-${viewport.id}-${index + 1}`;
        auditRecords.push({
          audit_id: auditId,
          task_type: "VISUAL_QA",
          searchRequired: false,
          searchPolicySource: "EXPLICIT",
          provider: "openrouter",
          model: "test-vision-model",
          request_id: `req-${auditId}`,
          input_tokens: 100,
          output_tokens: 200,
          cost_usd: 0.01,
          latency_ms: 900,
        });
        return {
          trial_id: `${normalizeRouteKey(sentinel.route)}::${viewport.id}::trial-${index + 1}`,
          blind: true,
          judge_input_manifest: {
            candidate_identity_exposed: false,
            baseline_identity_exposed: false,
            repository_identity_exposed: false,
            quality_delta_exposed: false,
            previous_verdict_exposed: false,
          },
          orientation,
          raw_judge: JSON.parse(judgeJson(orientation.B === "CANDIDATE" ? "B" : "A", 1)),
          normalized_preference: "CANDIDATE",
          normalized_candidate_delta: Object.fromEntries(DIMENSION_NAMES.map((name) => [name, 1])),
          audit_id: auditId,
        };
      });
      return {
        route: sentinel.route,
        viewport: viewport.id,
        candidate_blank: false,
        baseline_blank: false,
        route_match: true,
        viewport_match: true,
        candidate_run_id: runId,
        captured_run_id: runId,
        candidate_screenshot_digest: "a".repeat(64),
        baseline_screenshot_digest: "b".repeat(64),
        trials,
      };
    }),
  );
  return {
    schema: "l9.safehaven-golden-visual-evidence/v1",
    case_id: testCase.case_id,
    candidate_run_id: runId,
    candidate_url: "https://candidate.example.com",
    baseline_url: "https://www.safehavenrr.com",
    captured_at: "2026-08-19T00:00:00.000Z",
    rendered_visual_qa_executed: true,
    site: summarizeSite(observations, CASE_ROUTES),
    business_truth: {
      phone_mismatch_count: 0,
      email_mismatch_count: 0,
      prohibition_violations: 0,
      findings: [],
    },
    visual: { pairs },
    llm_audit: { operations: { VISUAL_QA: auditRecords } },
  };
}

async function makeMergeInputs(): Promise<{
  testCase: Record<string, unknown>;
  oracle: Record<string, unknown>;
  runtime: Record<string, unknown>;
  rendered: Record<string, unknown>;
  seoAudit: Record<string, unknown>;
}> {
  const audit = makeSeoAuditFile(BUILD_ID);
  const runtime = await buildSafeHavenRuntimeEvidence(makeGoldenContext(), {
    ...RUNTIME_OPTIONS,
    seoLlmAuditPath: audit.path,
  });
  return {
    testCase: testCase as unknown as Record<string, unknown>,
    oracle: oracle as unknown as Record<string, unknown>,
    runtime: JSON.parse(JSON.stringify(runtime)) as Record<string, unknown>,
    rendered: makeRenderedEvidence(BUILD_ID),
    seoAudit: audit.body,
  };
}

function expectMergeHalt(inputs: Parameters<typeof mergeGoldenReceipt>[0], code: string): void {
  assert.throws(
    () => mergeGoldenReceipt(inputs),
    (error: unknown) => {
      assert.ok(error instanceof GoldenReceiptMergeError, String(error));
      assert.equal(error.code, code);
      return true;
    },
  );
}

void test("supplying real SEO execution metadata resolves every external dependency", async () => {
  const inputs = await makeMergeInputs();
  assert.deepEqual(inputs.runtime.unresolved_external_dependencies, []);
  const seoBlueprint = inputs.runtime.seo_content_blueprint as Record<string, unknown>;
  assert.equal(seoBlueprint.batch_size, 4);
  assert.equal(seoBlueprint.batch_count, 8);
});

void test("matching runtime, rendered and SEO audit records assemble a Golden receipt", async () => {
  const receipt = mergeGoldenReceipt(await makeMergeInputs());
  assert.equal(receipt.schema, "l9.golden-run-receipt/v1");
  assert.equal(receipt.case_id, testCase.case_id);
  assert.equal((receipt.calibration as unknown) ?? undefined, undefined);
  const site = receipt.site as Record<string, unknown>;
  assert.equal((site.per_route as unknown[]).length, 29);
  assert.equal(site.reachable_routes, 29);
  const visual = receipt.visual as { pairs: unknown[] };
  assert.equal(visual.pairs.length, 10);
  const audit = receipt.llm_audit as { operations: Record<string, unknown[]> };
  assert.equal(audit.operations.VISUAL_QA?.length, 30);
  assert.equal(audit.operations.SEO_CONTENT_BLUEPRINT?.length, 1);
});

void test("a run id mismatch between runtime and rendered evidence is rejected", async () => {
  const inputs = await makeMergeInputs();
  inputs.rendered = makeRenderedEvidence("some-other-build");
  expectMergeHalt(inputs, "CANDIDATE_RUN_ID_MISMATCH");
});

void test("a case id mismatch is rejected", async () => {
  const inputs = await makeMergeInputs();
  inputs.runtime.case_id = "a-different-case";
  expectMergeHalt(inputs, "CASE_ID_MISMATCH");
});

void test("a missing SEO audit operation is rejected", async () => {
  const inputs = await makeMergeInputs();
  delete (inputs.seoAudit.operations as Record<string, unknown>).CONTENT_VALIDATION;
  expectMergeHalt(inputs, "LLM_AUDIT_OPERATION_MISSING");
});

void test("an SEO call that allowed search is rejected", async () => {
  const inputs = await makeMergeInputs();
  const calls = (inputs.seoAudit.operations as Record<string, Array<Record<string, unknown>>>)
    .STRUCTURED_CONTENT_GENERATION as Array<Record<string, unknown>>;
  (calls[0] as Record<string, unknown>).searchRequired = true;
  expectMergeHalt(inputs, "STRUCTURED_CONTENT_GENERATION_SEARCH_POLICY_VIOLATION");
});

void test("missing VISUAL_QA audit records are rejected", async () => {
  const inputs = await makeMergeInputs();
  (inputs.rendered.llm_audit as { operations: Record<string, unknown> }).operations = {};
  expectMergeHalt(inputs, "LLM_AUDIT_OPERATION_MISSING");
});

void test("a synthetic calibration artefact can never be merged into a real receipt", async () => {
  const inputs = await makeMergeInputs();
  inputs.runtime.calibration = { synthetic: true };
  expectMergeHalt(inputs, "SYNTHETIC_CALIBRATION_INPUT");
});

void test("an unresolved external dependency blocks receipt assembly", async () => {
  const inputs = await makeMergeInputs();
  inputs.runtime.unresolved_external_dependencies = [
    { field: "seo_content_blueprint.batch_size", owner: "SEO-Bot", reason: "not supplied" },
  ];
  expectMergeHalt(inputs, "EXTERNAL_DEPENDENCY_UNRESOLVED");
});

void test("rendered evidence without an executed visual QA pass is rejected", async () => {
  const inputs = await makeMergeInputs();
  inputs.rendered.rendered_visual_qa_executed = false;
  expectMergeHalt(inputs, "RENDERED_VISUAL_QA_NOT_EXECUTED");
});

void test("a duplicated visual pair is rejected", async () => {
  const inputs = await makeMergeInputs();
  const pairs = (inputs.rendered.visual as { pairs: unknown[] }).pairs;
  pairs[1] = JSON.parse(JSON.stringify(pairs[0])) as unknown;
  expectMergeHalt(inputs, "VISUAL_PAIR_DUPLICATE");
});

void test("a missing visual pair is rejected", async () => {
  const inputs = await makeMergeInputs();
  const visual = inputs.rendered.visual as { pairs: unknown[] };
  visual.pairs = visual.pairs.slice(0, 9);
  expectMergeHalt(inputs, "VISUAL_PAIR_SET_MISMATCH");
});

void test("a pair captured at an unknown viewport is rejected", async () => {
  const inputs = await makeMergeInputs();
  const pairs = (inputs.rendered.visual as { pairs: Array<Record<string, unknown>> }).pairs;
  (pairs[0] as Record<string, unknown>).viewport = "tablet";
  expectMergeHalt(inputs, "VISUAL_PAIR_SET_MISMATCH");
});

void test("a wrong trial count is rejected", async () => {
  const inputs = await makeMergeInputs();
  const pairs = (inputs.rendered.visual as { pairs: Array<Record<string, unknown>> }).pairs;
  (pairs[0] as { trials: unknown[] }).trials = (pairs[0] as { trials: unknown[] }).trials.slice(
    0,
    2,
  );
  expectMergeHalt(inputs, "VISUAL_ORACLE_MISSING_TRIAL");
});

void test("a trial without orientation or raw judge evidence is rejected", async () => {
  const withoutOrientation = await makeMergeInputs();
  const pairsA = (
    withoutOrientation.rendered.visual as {
      pairs: Array<{ trials: Array<Record<string, unknown>> }>;
    }
  ).pairs;
  delete pairsA[0]?.trials[0]?.orientation;
  expectMergeHalt(withoutOrientation, "VISUAL_ORIENTATION_MISSING");

  const withoutRawJudge = await makeMergeInputs();
  const pairsB = (
    withoutRawJudge.rendered.visual as { pairs: Array<{ trials: Array<Record<string, unknown>> }> }
  ).pairs;
  delete pairsB[0]?.trials[0]?.raw_judge;
  expectMergeHalt(withoutRawJudge, "VISUAL_RAW_JUDGE_EVIDENCE_MISSING");
});

void test("a stale visual capture from another run is rejected", async () => {
  const inputs = await makeMergeInputs();
  const pairs = (inputs.rendered.visual as { pairs: Array<Record<string, unknown>> }).pairs;
  (pairs[0] as Record<string, unknown>).candidate_run_id = "older-build";
  expectMergeHalt(inputs, "STALE_VISUAL_CAPTURE");
});

void test("a missing rendered site route is rejected", async () => {
  const inputs = await makeMergeInputs();
  const site = inputs.rendered.site as { per_route: unknown[] };
  site.per_route = site.per_route.slice(0, 28);
  expectMergeHalt(inputs, "SITE_ROUTE_MISSING");
});

void test("unequal PCC digests block receipt assembly", async () => {
  const inputs = await makeMergeInputs();
  const pcc = inputs.runtime.page_content_contract as { determinism: Record<string, unknown> };
  pcc.determinism.digest_run_2 = `sha256:${"9".repeat(64)}`;
  expectMergeHalt(inputs, "PCC_DIGEST_MISMATCH");
});

void test("a malformed identity SHA blocks receipt assembly", async () => {
  const inputs = await makeMergeInputs();
  const identity = inputs.runtime.identity as Record<string, Record<string, unknown>>;
  (identity.seo_bot as Record<string, unknown>).sha = "not-a-sha";
  expectMergeHalt(inputs, "IDENTITY_SHA_INVALID");
});

void test("business truth is composed from its producers and cannot be overridden by a caller", async () => {
  const inputs = await makeMergeInputs();
  // A caller-planted business_truth block on the runtime record must be ignored.
  inputs.runtime.business_truth = {
    unsupported_claim_count: 99,
    phone_mismatch_count: 99,
    email_mismatch_count: 99,
    prohibition_violations: 99,
  };
  const receipt = mergeGoldenReceipt(inputs);
  assert.deepEqual(receipt.business_truth, {
    unsupported_claim_count: 0,
    phone_mismatch_count: 0,
    email_mismatch_count: 0,
    prohibition_violations: 0,
  });
});

void test("the standalone SEO audit gate rejects an audit produced for another run", () => {
  const audit = makeSeoAuditFile("run-a");
  assert.throws(
    () => assertSeoAudit(audit.body, "run-b", testCase.case_id as unknown as string),
    (error: unknown) => {
      assert.ok(error instanceof GoldenReceiptMergeError);
      assert.equal(error.code, "SEO_AUDIT_RUN_ID_MISMATCH");
      return true;
    },
  );
});

void test("the standalone visual gate accepts the exact sentinel x viewport set", async () => {
  const inputs = await makeMergeInputs();
  assert.doesNotThrow(() =>
    assertVisualEvidence(inputs.rendered, inputs.testCase, inputs.oracle, BUILD_ID),
  );
});
