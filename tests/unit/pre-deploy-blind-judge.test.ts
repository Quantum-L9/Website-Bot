// L9_META: layer=test, role=pre_deploy_blind_judge, status=active, version=1.0.0
//
// PreDeployBlindJudgeStage gates every mode that publishes or deploys. Its
// verdict becomes the blind_judge_vs_baseline readiness level:
//   PASS -> publication proceeds; FAIL -> refused, never waivable;
//   NOT_RUN / BLOCKED -> refused unless the operator records an explicit
//   waiver, and even then the level stays NOT_RUN / BLOCKED, never PASS.
// No paid API is called: absent credentials exercise the real judge, every
// other verdict comes from an injected judge runner.

import assert from "node:assert/strict";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { buildReadinessLadder } from "../../src/pipeline/evidence/ReadinessLadder.js";
import { buildFactoryExecutionPlan } from "../../src/pipeline/FactoryExecutionPlan.js";
import {
  BLIND_JUDGE_WAIVER_ENV,
  type JudgeRunner,
  judgedRoutes,
  PreDeployBlindJudgeStage,
} from "../../src/stages/PreDeployBlindJudgeStage.js";
import type { JudgeReport } from "../../src/validation/blind-judge.js";
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureBuildProof,
  fixtureContext,
} from "../helpers/siteFactoryFixture.js";

const BASELINE = "https://current-site.example.com";

async function contextWithBuild(baseline: string | null = BASELINE): Promise<BuildContext> {
  const ctx = fixtureContext(
    baseline ? { assets: { sourceSite: { url: baseline, enabled: false } } } : {},
  );
  const assembly = fixtureAssemblyManifest(ctx);
  const assemblyRecord = await ctx.evidenceStore.writeAssembly(assembly);
  await ctx.evidenceStore.writeBuild(
    fixtureBuildProof(ctx, assemblyRecord.sha256, assembly.sourceDigest),
  );
  return ctx;
}

function report(status: JudgeReport["status"], reasons: string[] = []): JudgeReport {
  return {
    schema: "website-bot.blind-judge-report/v1",
    run_id: "run",
    status,
    reasons,
    candidate: "dist",
    baseline: BASELINE,
    pairs: 2,
    trials: [],
    aggregate: {
      decisive: status === "PASS" ? 6 : 0,
      candidate_wins: status === "PASS" ? 6 : 0,
      win_rate: status === "PASS" ? 1 : null,
      wilson_lower_bound: status === "PASS" ? 0.61 : null,
      mean_delta: {},
    },
    instruction_sha256: null,
    errors: status === "BLOCKED" ? ["/::desktop_1440: navigation timeout"] : [],
  };
}

const runnerReturning =
  (status: JudgeReport["status"], reasons: string[] = []): JudgeRunner =>
  async () =>
    report(status, reasons);

const noCapture = { capture: async () => assert.fail("capture must not run") };

async function runStage(
  ctx: BuildContext,
  runner: JudgeRunner,
  env: NodeJS.ProcessEnv = {},
): Promise<BuildError | undefined> {
  try {
    await new PreDeployBlindJudgeStage(runner, env, noCapture).run(ctx);
    return undefined;
  } catch (error) {
    assert.ok(error instanceof BuildError, String(error));
    return error;
  }
}

const level = (ctx: BuildContext) => ctx.readiness?.blind_judge_vs_baseline;

test("absent judge credentials are NOT_RUN and block publication; never PASS", async () => {
  const ctx = await contextWithBuild();
  try {
    // The real judge: no DEEPSEEK_API_KEY, so nothing is captured or sent.
    const error = await runStage(
      ctx,
      (await import("../../src/validation/blind-judge.js")).runJudge,
    );
    assert.equal(error?.code, "PRE_DEPLOY_JUDGE_BLOCKED");
    assert.match(error?.message ?? "", /NOT_RUN .*MISSING_EVALUATOR_CREDENTIALS/);
    assert.equal(level(ctx)?.state, "NOT_RUN");
    assert.equal(level(ctx)?.evidence_ref, null);
    // The ladder carries it as NOT_RUN, never inferred upward.
    assert.equal(buildReadinessLadder(ctx.readiness).levels[4]?.state, "NOT_RUN");
  } finally {
    cleanupContext(ctx);
  }
});

test("an operator waiver lets a NOT_RUN judge publish, and the level stays NOT_RUN", async () => {
  const ctx = await contextWithBuild();
  try {
    const error = await runStage(
      ctx,
      runnerReturning("NOT_RUN", ["MISSING_EVALUATOR_CREDENTIALS"]),
      {
        [BLIND_JUDGE_WAIVER_ENV]: "pilot client approved launch without the judge",
      },
    );
    assert.equal(error, undefined);
    assert.equal(level(ctx)?.state, "NOT_RUN");
    assert.match(
      level(ctx)?.reason ?? "",
      /waived by operator: pilot client approved launch without the judge/,
    );
  } finally {
    cleanupContext(ctx);
  }
});

test("a BLOCKED judge refuses publication unless waived", async () => {
  const ctx = await contextWithBuild();
  try {
    const error = await runStage(ctx, runnerReturning("BLOCKED", ["CAPTURE_FAILED"]));
    assert.equal(error?.code, "PRE_DEPLOY_JUDGE_BLOCKED");
    assert.equal(level(ctx)?.state, "BLOCKED");
    assert.match(level(ctx)?.reason ?? "", /CAPTURE_FAILED: \/::desktop_1440: navigation timeout/);
  } finally {
    cleanupContext(ctx);
  }
});

test("a FAIL verdict refuses publication even with a waiver", async () => {
  const ctx = await contextWithBuild();
  try {
    const error = await runStage(ctx, runnerReturning("FAIL", ["CANDIDATE_NOT_PREFERRED"]), {
      [BLIND_JUDGE_WAIVER_ENV]: "ship it",
    });
    assert.equal(error?.code, "PRE_DEPLOY_JUDGE_BLOCKED");
    assert.match(error?.message ?? "", /preferred the client's current site/);
    assert.equal(level(ctx)?.state, "FAIL");
    assert.match(level(ctx)?.evidence_ref ?? "", /blind-judge\/report\.json$/);
    assert.doesNotMatch(level(ctx)?.reason ?? "", /waived/);
  } finally {
    cleanupContext(ctx);
  }
});

test("a PASS verdict publishes and records its report as evidence", async () => {
  const ctx = await contextWithBuild();
  let invocation: Parameters<JudgeRunner>[0] | undefined;
  try {
    const error = await runStage(ctx, async (received) => {
      invocation = received;
      return report("PASS");
    });
    assert.equal(error, undefined);
    assert.equal(level(ctx)?.state, "PASS");
    assert.match(level(ctx)?.evidence_ref ?? "", /blind-judge\/report\.json$/);
    assert.deepEqual(invocation?.baseline, { url: BASELINE });
    assert.deepEqual(invocation?.viewports, ["desktop_1440", "iphone_14"]);
    assert.ok(invocation?.candidate.dist, "the persisted build's dist is the candidate");
  } finally {
    cleanupContext(ctx);
  }
});

test("a spec with no baseline site is NOT_RUN and blocks unless waived", async () => {
  const ctx = await contextWithBuild(null);
  try {
    const error = await runStage(ctx, async () => assert.fail("the judge must not run"));
    assert.equal(error?.code, "PRE_DEPLOY_JUDGE_BLOCKED");
    assert.equal(level(ctx)?.state, "NOT_RUN");
    assert.match(level(ctx)?.reason ?? "", /no baseline/);
  } finally {
    cleanupContext(ctx);
  }
});

test("the judge sees home first and at most three routes", () => {
  const routes = [
    { slug: "/services", title: "S", components: [] },
    { slug: "/", title: "H", components: [] },
    { slug: "/about", title: "A", components: [] },
    { slug: "/contact", title: "C", components: [] },
  ];
  assert.deepEqual(
    judgedRoutes({ domainSpec: { routes } as unknown as BuildContext["domainSpec"] }),
    ["/", "/services", "/about"],
  );
});

test("publish and deploy modes judge before client-source-publish and vercel-deploy; local-proof does not", () => {
  for (const mode of ["publish-proof", "end-to-end"] as const) {
    const plan = buildFactoryExecutionPlan({ mode, specPath: "fixtures/ci-test-spec.yaml" });
    const names = plan.stages.map((stage) => stage.name);
    const judge = names.indexOf("pre-deploy-blind-judge");
    assert.ok(judge > names.indexOf("rendered-site-validation"), mode);
    assert.ok(judge < names.indexOf("client-source-publish"), mode);
    if (names.includes("vercel-deploy")) assert.ok(judge < names.indexOf("vercel-deploy"), mode);
    assert.ok(plan.mandatoryStages.includes("pre-deploy-blind-judge"), `${mode} cannot skip it`);
  }
  const local = buildFactoryExecutionPlan({
    mode: "local-proof",
    specPath: "fixtures/ci-test-spec.yaml",
  });
  assert.equal(
    local.stages.some((stage) => stage.name === "pre-deploy-blind-judge"),
    false,
  );
});
