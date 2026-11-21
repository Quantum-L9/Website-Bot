// L9_META: layer=test, role=execution_plan_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import {
  buildFactoryExecutionPlan,
  TerminalConvergenceStage,
} from "../../src/pipeline/FactoryExecutionPlan.js";

test("terminal convergence accepts a resume-skipped mandatory stage (valid checkpoint)", async () => {
  // Regression: resume marks checked stages {ok:true, skipped:true}; a resume
  // after a downstream failure (e.g. site-build) must converge, not dead-end.
  const ctx = {
    stageResults: new Map([["placeholder-scan", { ok: true, skipped: true }]]),
  } as unknown as BuildContext;
  await new TerminalConvergenceStage("plan", ["placeholder-scan"], []).run(ctx);
  assert.strictEqual(
    ctx.stageResults.get("placeholder-scan")?.ok,
    true,
    "resume-skipped mandatory stage with valid checkpoint must converge, not dead-end",
  );
});

test("terminal convergence rejects a failed mandatory stage", async () => {
  const ctx = {
    stageResults: new Map([["placeholder-scan", { ok: false, skipped: false }]]),
  } as unknown as BuildContext;
  await assert.rejects(
    new TerminalConvergenceStage("plan", ["placeholder-scan"], []).run(ctx),
    /Mandatory stage did not converge: placeholder-scan/,
  );
});

test("end-to-end plan owns the complete proof-gated topology", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
  });
  const names = plan.stages.map((stage) => stage.name);
  assert.deepEqual(names, [
    "domain-spec-loader",
    "unknown-resolver",
    "source-site-ingestion",
    "design-intelligence",
    "content-generation",
    "schema-generator",
    "image-asset-planning",
    "image-generation",
    "placeholder-scan",
    "lead-endpoint-verification",
    "site-assembler",
    "image-validation",
    "posthog-snippet",
    "site-build",
    "rendered-site-validation",
    "pre-deploy-blind-judge",
    "client-source-publish",
    "vercel-deploy",
    "release-receipt",
    "seo-baseline",
    "visual-qa",
    "release-receipt-finalizer",
    "handoff-emitter",
    "terminal-convergence",
  ]);
  assert.ok(plan.requiredEvidence.includes("handoff"));
});

test("mandatory evidence stages cannot be skipped", () => {
  assert.throws(
    () =>
      buildFactoryExecutionPlan({
        mode: "end-to-end",
        specPath: "fixtures/ci-test-spec.yaml",
        skipStages: ["site-build"],
      }),
    /Cannot skip mandatory end-to-end stages: site-build/,
  );
});

test("plan mode contains no provider mutation stages", () => {
  const plan = buildFactoryExecutionPlan({ mode: "plan", specPath: "fixtures/ci-test-spec.yaml" });
  const names = plan.stages.map((stage) => stage.name);
  assert.equal(names.includes("client-source-publish"), false);
  assert.equal(names.includes("vercel-deploy"), false);
  assert.equal(names.at(-1), "terminal-convergence");
});

test("REDESIGN_IMPROVE inserts competitive-intelligence before design generation", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "local-proof",
    specPath: "fixtures/ci-test-spec.yaml",
    buildIntent: "REDESIGN_IMPROVE",
  });
  const names = plan.stages.map((stage) => stage.name);
  const intelligenceIndex = names.indexOf("competitive-intelligence");
  const designIndex = names.indexOf("design-intelligence");
  assert.ok(intelligenceIndex > -1, "competitive-intelligence must be present in improve mode");
  assert.ok(
    intelligenceIndex < designIndex,
    "competitive-intelligence must run before design-intelligence",
  );
});

test("REDESIGN preflight precedes competitive intelligence", () => {
  // Regression: the readiness proof used to live INSIDE
  // redesign-content-authority, which runs after competitive-intelligence —
  // so the first paid build-intelligence call happened before any preflight.
  const plan = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
    buildIntent: "REDESIGN_IMPROVE",
  });
  const names = plan.stages.map((stage) => stage.name);
  assert.ok(names.includes("seo-build-intelligence-preflight"));
  assert.ok(
    names.indexOf("seo-build-intelligence-preflight") < names.indexOf("competitive-intelligence"),
    "preflight must precede the first paid SEO-Bot call",
  );
  assert.ok(
    names.indexOf("competitive-intelligence") < names.indexOf("redesign-content-authority"),
  );
  assert.ok(names.indexOf("unknown-resolver") < names.indexOf("seo-build-intelligence-preflight"));
  assert.ok(
    plan.mandatoryStages.includes("seo-build-intelligence-preflight"),
    "seo-build-intelligence-preflight must be mandatory under REDESIGN_IMPROVE",
  );
  assert.throws(() =>
    buildFactoryExecutionPlan({
      mode: "end-to-end",
      specPath: "fixtures/ci-test-spec.yaml",
      buildIntent: "REDESIGN_IMPROVE",
      skipStages: ["seo-build-intelligence-preflight"],
    }),
  );
});

test("redesign integrity gate runs before success finalization and handoff", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
    buildIntent: "REDESIGN_IMPROVE",
  });
  const names = plan.stages.map((stage) => stage.name);
  const at = (name: string) => {
    const index = names.indexOf(name);
    assert.ok(index > -1, `${name} must be present in an end-to-end redesign plan`);
    return index;
  };
  // ReleaseReceiptFinalizerStage records status "succeeded" and
  // HandoffEmitterStage performs the external POST. A gate after either can
  // only reject a run that has already been published, so ordering here IS
  // the guarantee — nothing else enforces it.
  assert.ok(
    at("visual-qa") < at("redesign-integrity-receipt"),
    "redesign-integrity-receipt reads ctx.qualityEvidence.visualQa and must follow visual-qa",
  );
  assert.ok(
    at("redesign-integrity-receipt") < at("release-receipt-finalizer"),
    "an invalid redesign must be rejected before the release is recorded as succeeded",
  );
  assert.ok(
    at("release-receipt-finalizer") < at("handoff-emitter"),
    "handoff follows finalization",
  );
  assert.ok(at("handoff-emitter") < at("terminal-convergence"), "terminal-convergence stays last");
});

test("COPY intent (legacy default) keeps the original stage topology", () => {
  const plan = buildFactoryExecutionPlan({
    mode: "local-proof",
    specPath: "fixtures/ci-test-spec.yaml",
  });
  const names = plan.stages.map((stage) => stage.name);
  assert.equal(names.includes("competitive-intelligence"), false);
  assert.equal(names.includes("seo-build-intelligence-preflight"), false);
});

test("lead capture is verified after inputs exist and before assembly and the receipt", () => {
  for (const mode of ["plan", "local-proof", "publish-proof", "end-to-end"] as const) {
    const names = buildFactoryExecutionPlan({
      mode,
      specPath: "fixtures/ci-test-spec.yaml",
    }).stages.map((stage) => stage.name);
    const at = (name: string) => names.indexOf(name);
    assert.ok(at("lead-endpoint-verification") > at("placeholder-scan"), mode);
    assert.equal(at("lead-endpoint-verification"), at("site-assembler") - 1, mode);
    assert.ok(at("lead-endpoint-verification") < at("release-receipt"), mode);
  }
});

test("publish-proof deploys a preview only when a Vercel token is present", () => {
  const previous = process.env.VERCEL_TOKEN;
  const namesFor = () =>
    buildFactoryExecutionPlan({
      mode: "publish-proof",
      specPath: "fixtures/ci-test-spec.yaml",
    }).stages.map((stage) => stage.name);
  try {
    delete process.env.VERCEL_TOKEN;
    assert.equal(namesFor().includes("vercel-deploy"), false);
    process.env.VERCEL_TOKEN = "fake-token-for-plan-shape";
    const names = namesFor();
    assert.ok(names.indexOf("client-source-publish") < names.indexOf("vercel-deploy"));
    assert.ok(names.indexOf("vercel-deploy") < names.indexOf("release-receipt"));
    // Never a mandatory stage: a credential-less publish-proof still converges.
    const plan = buildFactoryExecutionPlan({
      mode: "publish-proof",
      specPath: "fixtures/ci-test-spec.yaml",
    });
    assert.equal(plan.mandatoryStages.includes("vercel-deploy"), false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = previous;
  }
});
