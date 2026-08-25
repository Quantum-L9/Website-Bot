// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Campaign 7 test matrix J (§16/§17): receipt emission requires every piece
// of runtime evidence; validation enforces the impossibility matrix (10
// donors, zero-LLM counters, 100% required visual slots, no unexplained
// asset loss, visual QA for end-to-end). Plus the redesign plan topology and
// the fail-closed credential gate.

import assert from "node:assert/strict";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  emitRedesignExecutionIntegrityReceipt,
  type RedesignExecutionIntegrityReceipt,
  validateRedesignExecutionIntegrityReceipt,
} from "../../src/pipeline/evidence/RedesignExecutionIntegrityReceipt.js";
import {
  buildFactoryExecutionPlan,
  mandatoryStagesFor,
} from "../../src/pipeline/FactoryExecutionPlan.js";
import { CompetitiveIntelligenceStage } from "../../src/stages/CompetitiveIntelligenceStage.js";
import {
  BUILD_ID,
  CLIENT_ID,
  makeDonorEvidence,
  makeLandscape,
  makeSeoBlueprint,
  makeWebsiteBlueprint,
} from "./redesign-fixtures.js";

function completeCtx(overrides?: Partial<BuildContext>): BuildContext {
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape);
  const seoBlueprint = makeSeoBlueprint(landscape);
  return {
    buildId: BUILD_ID,
    clientId: CLIENT_ID,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    competitiveLandscape: landscape,
    websiteBlueprint: blueprint,
    seoContentBlueprint: seoBlueprint,
    pageContentContract: {
      artifact_id: "page_content_contract:" + "1".repeat(64),
      integrity: { algorithm: "sha256", payload_digest: "1".repeat(64) },
    },
    structuredContentPackage: {
      artifact_id: "structured_content_package:" + "2".repeat(64),
      integrity: { algorithm: "sha256", payload_digest: "2".repeat(64) },
    },
    acceptedDonors: Array.from({ length: 10 }, (_, index) =>
      makeDonorEvidence(`donor-${index}.example.com`),
    ),
    redesignCounters: {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    },
    sourceAssetDecisions: [
      { assetPath: "/tmp/a.png", decision: "SELECTED", reason: "slot", slotId: "/:hero" },
    ],
    imageAssetPlan: {
      schema: "website-bot.image-asset-plan/v1",
      version: "1.0.0",
      assets: [
        {
          slotId: "/:hero",
          placement: "/:hero",
          required: true,
          resolution: { source: "source-site", candidateId: "a" },
        },
      ],
    },
    sourceSiteManifest: { images: [{ id: "a" }] },
    stageResults: new Map([
      ["seo-build-intelligence-preflight", { ok: true }],
      ["competitive-intelligence", { ok: true }],
    ]),
    seoBuildIntelligencePreflight: {
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
    },
    qualityEvidence: { seoBaseline: "pending", visualQa: "passed" },
    ...overrides,
  } as unknown as BuildContext;
}

void test("a complete redesign run emits a valid receipt", () => {
  const receipt = emitRedesignExecutionIntegrityReceipt(completeCtx());
  validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false });
  assert.equal(receipt.qualified_donor_count, 10);
  assert.equal(receipt.counters.page_content_contract_llm_calls, 0);
  assert.equal(receipt.visual.required_visual_slots_filled_pct, 100);
});

void test("end-to-end convergence requires passed visual QA (golden run #60)", () => {
  const receipt = emitRedesignExecutionIntegrityReceipt(completeCtx());
  // "passed" is the EvidenceGateStatus success value (ReleaseReceipt
  // SSOT); "verified" is not a valid status.
  assert.doesNotThrow(() => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: true }));
  const failed = { ...receipt, visual_qa: { status: "skipped" } };
  assert.throws(
    () => validateRedesignExecutionIntegrityReceipt(failed, { requireVisualQa: true }),
    /visual_qa must be passed/,
  );
});

void test("missing evidence is FAIL, not default (each field)", () => {
  const fields = [
    "competitiveLandscape",
    "acceptedDonors",
    "seoContentBlueprint",
    "pageContentContract",
    "structuredContentPackage",
    "redesignCounters",
    "sourceAssetDecisions",
    "imageAssetPlan",
  ] as const;
  for (const field of fields) {
    const ctx = completeCtx({ [field]: undefined } as never);
    assert.throws(
      () => emitRedesignExecutionIntegrityReceipt(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === "REDESIGN_PIPELINE_INCOMPLETE",
      `emitter must fail when ${field} is missing`,
    );
  }
});

function validReceipt(): RedesignExecutionIntegrityReceipt {
  return emitRedesignExecutionIntegrityReceipt(completeCtx());
}

void test("receipt validation rejects nine donors", () => {
  const receipt = validReceipt();
  receipt.qualified_donor_count = 9;
  receipt.donors = receipt.donors.slice(0, 9);
  assert.throws(() => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }));
});

void test("receipt validation rejects a donor without screenshots", () => {
  const receipt = validReceipt();
  receipt.donors[3].screenshots = 0;
  assert.throws(() => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }));
});

void test("receipt validation rejects nonzero LLM counters", () => {
  for (const key of [
    "page_content_contract_llm_calls",
    "legacy_content_generation_calls",
    "redesign_schema_llm_calls",
  ] as const) {
    const receipt = validReceipt();
    receipt.counters[key] = 1;
    assert.throws(
      () => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }),
      (error: unknown) =>
        error instanceof BuildError && error.code === "REDESIGN_PIPELINE_INCOMPLETE",
      `nonzero ${key} must fail`,
    );
  }
});

void test("receipt validation rejects required visual slots below 100%", () => {
  const receipt = validReceipt();
  receipt.visual.required_visual_slots_filled_pct = 50;
  assert.throws(() => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }));
});

void test("receipt validation requires passed visual QA for end-to-end", () => {
  const receipt = validReceipt();
  receipt.visual_qa.status = "pending";
  validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false });
  assert.throws(() => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: true }));
});

// ---- Redesign plan topology (matrix B) -------------------------------------

void test("REDESIGN_IMPROVE plans replace legacy content/schema stages and add the redesign chain", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
    buildIntent: "REDESIGN_IMPROVE",
  });
  const names = plan.stages.map((stage) => stage.name);
  assert.ok(names.includes("competitive-intelligence"));
  assert.ok(names.includes("redesign-content-authority"));
  assert.ok(names.includes("structured-content-projection"));
  assert.ok(names.includes("redesign-schema-serializer"));
  assert.ok(names.includes("redesign-integrity-receipt"));
  assert.ok(!names.includes("content-generation"), "legacy content authority must be ABSENT");
  assert.ok(!names.includes("schema-generator"), "legacy schema authority must be ABSENT");
  for (const stage of [
    "competitive-intelligence",
    "redesign-content-authority",
    "structured-content-projection",
    "redesign-schema-serializer",
    "redesign-integrity-receipt",
  ]) {
    assert.ok(plan.mandatoryStages.includes(stage), `${stage} must be mandatory`);
  }
});

void test("COPY plans are unchanged: legacy stages present, redesign stages absent", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
    buildIntent: "COPY",
  });
  const names = plan.stages.map((stage) => stage.name);
  assert.ok(names.includes("content-generation"));
  assert.ok(names.includes("schema-generator"));
  assert.ok(!names.includes("competitive-intelligence"));
  assert.ok(!names.includes("redesign-content-authority"));
});

void test("mandatory redesign stages cannot be skipped", () => {
  for (const stage of ["competitive-intelligence", "redesign-content-authority"]) {
    assert.throws(
      () =>
        buildFactoryExecutionPlan({
          mode: "end-to-end",
          specPath: "fixtures/ci-test-spec.yaml",
          buildIntent: "REDESIGN_IMPROVE",
          skipStages: [stage],
        }),
      (error: unknown) => error instanceof BuildError && error.code === "VALIDATION_FAILED",
    );
  }
});

void test("mandatoryStagesFor keeps COPY semantics byte-identical to the legacy list", () => {
  assert.deepEqual(mandatoryStagesFor("end-to-end", "COPY"), mandatoryStagesFor("end-to-end"));
  assert.ok(mandatoryStagesFor("end-to-end", "COPY").includes("content-generation"));
});

// ---- Credential gate (matrix B) ---------------------------------------------

// The preflight-evidence gate is checked first (see the preflight suite); this
// ctx carries that evidence so the credential gate itself is what is asserted.
void test("missing SEO-Bot credentials fail closed with COMPETITIVE_INTELLIGENCE_REQUIRED", async () => {
  const savedUrl = process.env.SEO_BOT_URL;
  const savedKey = process.env.SEO_BOT_API_KEY;
  delete process.env.SEO_BOT_URL;
  delete process.env.SEO_BOT_API_KEY;
  try {
    const ctx = completeCtx();
    await assert.rejects(
      () => new CompetitiveIntelligenceStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === "COMPETITIVE_INTELLIGENCE_REQUIRED",
    );
  } finally {
    if (savedUrl !== undefined) process.env.SEO_BOT_URL = savedUrl;
    if (savedKey !== undefined) process.env.SEO_BOT_API_KEY = savedKey;
  }
});
