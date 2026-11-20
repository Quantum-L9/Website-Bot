// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import { FileEvidenceStore } from "../../src/pipeline/evidence/FileEvidenceStore.js";
import { MemoryEvidenceStore } from "../../src/pipeline/evidence/MemoryEvidenceStore.js";
import { leadCaptureDigest } from "../../src/stages/LeadEndpointVerificationStage.js";
import { ReleaseReceiptFinalizerStage } from "../../src/stages/ReleaseReceiptFinalizerStage.js";
import { ReleaseReceiptStage } from "../../src/stages/ReleaseReceiptStage.js";
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureBuildProof,
  fixtureContext,
  fixtureDeploymentEvidence,
  fixturePublicationEvidence,
} from "../helpers/siteFactoryFixture.js";

async function persistLocalProof(ctx: ReturnType<typeof fixtureContext>) {
  const assembly = fixtureAssemblyManifest(ctx);
  const assemblyRecord = await ctx.evidenceStore.writeAssembly(assembly);
  const build = fixtureBuildProof(ctx, assemblyRecord.sha256, assembly.sourceDigest);
  const buildRecord = await ctx.evidenceStore.writeBuild(build);
  ctx.assemblyManifest = assembly;
  ctx.buildProof = build;
  return { assembly, assemblyRecord, build, buildRecord };
}

void test("plan mode creates no runtime evidence", async () => {
  const ctx = fixtureContext();
  try {
    ctx.mode = "plan";
    ctx.dryRun = true;
    ctx.evidenceStore = new MemoryEvidenceStore(ctx.clientId, ctx.buildId, "plan");
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    await new ReleaseReceiptStage().run(ctx);
    assert.equal(await ctx.evidenceStore.readReleaseReceipt(), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("local-proof mode persists a partial receipt with explicit remote gaps", async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:02.000Z")).run(ctx);
    const stored = await ctx.evidenceStore.readReleaseReceipt();
    assert.equal(stored?.value.status, "partial");
    assert.deepEqual(stored?.value.missing_gates, ["github_publication", "vercel_deployment"]);
    assert.equal(
      stored?.value.evidence.build?.sha256,
      (await ctx.evidenceStore.readBuild())?.record.sha256,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("every persisted receipt carries the readiness ladder, unobserved levels NOT_RUN", async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    ctx.readiness = {
      client_build_quality_check: { state: "FAIL", evidence_ref: "quality/report.json" },
    };
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:02.000Z")).run(ctx);
    const ladder = (await ctx.evidenceStore.readReleaseReceipt())?.value.readiness;
    assert.ok(ladder, "the local-proof receipt records the ladder");
    assert.deepEqual(
      ladder.levels.map((entry) => [entry.level, entry.state]),
      [
        ["structural_ci", "NOT_RUN"],
        ["replay_quality_gate", "NOT_RUN"],
        ["live_provider_canary", "NOT_RUN"],
        ["client_build_quality_check", "FAIL"],
        ["blind_judge_vs_baseline", "NOT_RUN"],
        ["operator_deploy_approval", "NOT_RUN"],
      ],
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("end-to-end receipt finalizes only after passed visual QA", async () => {
  const ctx = fixtureContext();
  try {
    ctx.mode = "end-to-end";
    ctx.evidenceStore = new FileEvidenceStore({
      rootDir: ctx.evidenceStore.rootDir,
      clientId: ctx.clientId,
      buildId: ctx.buildId,
      mode: "end-to-end",
      now: () => new Date("2026-07-20T00:00:03.000Z"),
    });
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    const { build, buildRecord } = await persistLocalProof(ctx);
    const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
    const publicationRecord = await ctx.evidenceStore.writePublication(publication);
    const deployment = fixtureDeploymentEvidence(ctx, publication, publicationRecord.sha256);
    await ctx.evidenceStore.writeDeployment(deployment);
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:03.000Z")).run(ctx);
    assert.equal((await ctx.evidenceStore.readReleaseReceipt())?.value.status, "partial");
    ctx.qualityEvidence.visualQa = "passed";
    ctx.visualQaPassed = true;
    await new ReleaseReceiptFinalizerStage().run(ctx);
    const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({
      requireStatus: "succeeded",
      requireMode: "end-to-end",
    });
    assert.equal(bundle.releaseReceipt.status, "succeeded");
    assert.equal(bundle.validation.valid, true);
  } finally {
    cleanupContext(ctx);
  }
});

function publishProofContext() {
  const ctx = fixtureContext();
  ctx.mode = "publish-proof";
  ctx.evidenceStore = new FileEvidenceStore({
    rootDir: ctx.evidenceStore.rootDir,
    clientId: ctx.clientId,
    buildId: ctx.buildId,
    mode: "publish-proof",
    now: () => new Date("2026-07-20T00:00:04.000Z"),
  });
  return ctx;
}

void test("publish-proof with publication and a READY preview satisfies both remote gates", async () => {
  const ctx = publishProofContext();
  try {
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    const { build, buildRecord } = await persistLocalProof(ctx);
    const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
    const publicationRecord = await ctx.evidenceStore.writePublication(publication);
    const deployment = fixtureDeploymentEvidence(ctx, publication, publicationRecord.sha256);
    await ctx.evidenceStore.writeDeployment(deployment);
    ctx.deploymentEvidence = deployment;
    const stage = new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:04.000Z"));
    assert.deepEqual(stage.evidence.inputs(ctx), [
      "assembly",
      "build",
      "publication",
      "deployment",
    ]);
    await stage.run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.equal(receipt?.status, "partial");
    assert.ok(!receipt?.missing_gates.includes("github_publication"));
    assert.ok(!receipt?.missing_gates.includes("vercel_deployment"));
    assert.deepEqual(receipt?.missing_gates, ["visual_qa"]);
    assert.equal(receipt?.correlation.deployment_id, deployment.deploymentId);
    assert.equal(receipt?.correlation.all_required_identities_match, true);
    assert.equal(receipt?.lead_capture?.status, "not_configured");
    const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({
      requireMode: "publish-proof",
    });
    assert.equal(bundle.validation.valid, true);
  } finally {
    cleanupContext(ctx);
  }
});

void test("publish-proof without credentials-backed evidence still names the gaps", async () => {
  const ctx = publishProofContext();
  try {
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    const { build, buildRecord } = await persistLocalProof(ctx);
    const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
    await ctx.evidenceStore.writePublication(publication);
    const stage = new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:04.000Z"));
    assert.deepEqual(stage.evidence.inputs(ctx), ["assembly", "build", "publication"]);
    await stage.run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.deepEqual(receipt?.missing_gates, ["vercel_deployment", "visual_qa"]);
  } finally {
    cleanupContext(ctx);
  }
});

void test("receipt records verified lead capture and does not gate it", async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    ctx.domainSpec.conversion_authority = {
      primary_action: "Book a Strategy Call",
      secondary_actions: [],
      cta_library: [],
    };
    const body = {
      schema: "website-bot.lead-capture-verification/v1" as const,
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      status: "verified" as const,
      method: "test_submission" as const,
      endpoint: "https://forms.example.com/f/abc123",
      endpointOrigin: "https://forms.example.com",
      httpStatus: 200,
      reason: "endpoint accepted a test submission",
      testMarker: "website-bot-lead-verification",
      checkedAt: "2026-07-20T00:00:01.000Z",
    };
    ctx.leadCaptureVerification = { ...body, digest: leadCaptureDigest(body) };
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:02.000Z")).run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.equal(receipt?.lead_capture?.status, "verified");
    assert.equal(receipt?.lead_capture?.endpoint_origin, "https://forms.example.com");
    assert.equal(receipt?.lead_capture?.evidence_sha256, ctx.leadCaptureVerification.digest);
    assert.ok(!receipt?.missing_gates.includes("lead_capture"));
  } finally {
    cleanupContext(ctx);
  }
});

void test("a declared primary action without verified capture is a missing gate", async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    ctx.domainSpec.conversion_authority = {
      primary_action: "Book a Strategy Call",
      secondary_actions: [],
      cta_library: [],
    };
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:02.000Z")).run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.equal(receipt?.lead_capture?.status, "not_configured");
    assert.equal(receipt?.lead_capture?.cta_rendered, false);
    assert.deepEqual(receipt?.missing_gates, [
      "github_publication",
      "vercel_deployment",
      "lead_capture",
    ]);
  } finally {
    cleanupContext(ctx);
  }
});

void test("an unverified live form is gated and blocks finalization", async () => {
  const ctx = fixtureContext();
  try {
    ctx.mode = "end-to-end";
    ctx.evidenceStore = new FileEvidenceStore({
      rootDir: ctx.evidenceStore.rootDir,
      clientId: ctx.clientId,
      buildId: ctx.buildId,
      mode: "end-to-end",
      now: () => new Date("2026-07-20T00:00:03.000Z"),
    });
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    ctx.domainSpec.seo_contract = {
      ...(ctx.domainSpec.seo_contract ?? {}),
      lead_form_action: "https://forms.example.com/f/abc123",
    };
    const { build, buildRecord } = await persistLocalProof(ctx);
    const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
    const publicationRecord = await ctx.evidenceStore.writePublication(publication);
    const deployment = fixtureDeploymentEvidence(ctx, publication, publicationRecord.sha256);
    await ctx.evidenceStore.writeDeployment(deployment);
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:03.000Z")).run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.equal(receipt?.lead_capture?.status, "unverified");
    assert.equal(receipt?.lead_capture?.cta_rendered, true);
    assert.ok(receipt?.missing_gates.includes("lead_capture"));
    ctx.qualityEvidence.visualQa = "passed";
    ctx.visualQaPassed = true;
    await assert.rejects(
      new ReleaseReceiptFinalizerStage().run(ctx),
      /live lead form whose endpoint is unverified/,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("a rejected non-HTTPS action yields a schema-valid receipt", async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    const body = {
      schema: "website-bot.lead-capture-verification/v1" as const,
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      status: "failed" as const,
      method: "none" as const,
      endpoint: "http://forms.example.com/f/abc123",
      endpointOrigin: "http://forms.example.com",
      reason: "lead form action must use HTTPS",
      testMarker: "website-bot-lead-verification",
      checkedAt: "2026-07-20T00:00:01.000Z",
    };
    ctx.leadCaptureVerification = { ...body, digest: leadCaptureDigest(body) };
    await new ReleaseReceiptStage(() => new Date("2026-07-20T00:00:02.000Z")).run(ctx);
    const receipt = (await ctx.evidenceStore.readReleaseReceipt())?.value;
    assert.equal(receipt?.lead_capture?.status, "failed");
    assert.equal(receipt?.lead_capture?.endpoint_origin, undefined);
  } finally {
    cleanupContext(ctx);
  }
});
