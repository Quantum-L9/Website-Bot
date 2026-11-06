// L9_META: layer=test, role=release_order_contract, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 3, release half (T14 / F14, INV-12): a
// failed rendered-site validation must stop the run before anything leaves
// the process. Real stages run through the real PipelineRunner on real
// persisted evidence; the only stand-ins are the Astro build commands, the
// browser report, and a fetch that records every outbound request and lets
// none reach GitHub, Vercel or SEO-Bot. A positive control proves the spy sees
// a publication attempt when validation passes, so "zero requests" on the
// failing paths is evidence, not an unwired spy.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BuildContext, ExecutionMode } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { buildFactoryExecutionPlan } from "../../src/pipeline/FactoryExecutionPlan.js";
import { PipelineRunner, type Stage } from "../../src/pipeline/PipelineRunner.js";
import { ClientSourcePublishStage } from "../../src/stages/ClientSourcePublishStage.js";
import { HandoffEmitterStage } from "../../src/stages/HandoffEmitterStage.js";
import { RenderedSiteValidationStage } from "../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../src/stages/SiteBuildStage.js";
import { VercelDeployStage } from "../../src/stages/VercelDeployStage.js";
import type { SiteRenderer } from "../../src/validation/rendered-site.js";
import { fakeAstroBuild, renderedReport } from "../helpers/fakeSiteBuild.js";
import { redesignContext } from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext, fixtureContext, withEnv } from "../helpers/siteFactoryFixture.js";

process.env.BUILD_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "wb-release-db-")), "build.db");

const COPY_ROUTES = ["/", "/services", "/contact"];
const DEPLOY = { github_repo: "example/disposable-site", source_branch: "main" };

/** Records every outbound request and refuses it: nothing reaches a provider. */
function networkSpy() {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requests.push(String(input));
    throw new Error("network disabled in release-order tests");
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const failingRenderer = (): SiteRenderer & { calls: number } => {
  const renderer = {
    calls: 0,
    async render(options: Parameters<SiteRenderer["render"]>[0]) {
      renderer.calls++;
      return renderedReport(options, {
        check: "required_images_visible",
        detail: "/:hero: not visible",
      });
    },
  };
  return renderer;
};

const passingRenderer: SiteRenderer = {
  async render(options) {
    return renderedReport(options);
  },
};

const noBrowser: SiteRenderer = {
  async render() {
    throw new Error("browser unavailable: chromium could not be launched");
  },
};

/**
 * Validation, then every external publisher, in the real end-to-end order.
 * The order is asserted against the production plan, so this is the plan's
 * own sequence with stand-in network and browser, not an invented one.
 */
function releaseStages(renderer: SiteRenderer, fetchImpl: typeof fetch): Stage[] {
  return [
    new RenderedSiteValidationStage(renderer),
    new ClientSourcePublishStage(
      fetchImpl,
      () => new Date(),
      async () => undefined,
    ),
    new VercelDeployStage(fetchImpl, async () => undefined),
    new HandoffEmitterStage(fetchImpl),
  ];
}

async function run(ctx: BuildContext, stages: Stage[]): Promise<unknown> {
  const runner = new PipelineRunner();
  for (const stage of stages) runner.register(stage);
  try {
    await runner.run(ctx);
    return undefined;
  } catch (error) {
    return error;
  }
}

async function builtCopySite(): Promise<BuildContext> {
  const ctx = fixtureContext({ deploy: DEPLOY });
  ctx.mode = "end-to-end";
  const error = await run(ctx, [
    new SiteAssemblerStage(),
    new SiteBuildStage(fakeAstroBuild(COPY_ROUTES)),
  ]);
  assert.equal(error, undefined, "assembly and build succeed");
  return ctx;
}

async function assertNothingReleased(ctx: BuildContext, requests: string[]): Promise<void> {
  assert.deepEqual(requests, [], "no request left the process");
  assert.equal(await ctx.evidenceStore.readPublication(), undefined, "no publication evidence");
  assert.equal(await ctx.evidenceStore.readDeployment(), undefined, "no deployment evidence");
  assert.equal(await ctx.evidenceStore.readHandoff(), undefined, "no handoff evidence");
  assert.equal(ctx.stageResults.has("client-source-publish"), false, "the publisher never ran");
}

const isRenderedFailure = (error: unknown): boolean =>
  error instanceof BuildError && error.code === "RENDERED_SITE_VALIDATION_FAILED";

void test("T14 order: in every mode and intent, nothing external runs before rendered-site validation", () => {
  const modes: ExecutionMode[] = ["local-proof", "publish-proof", "end-to-end"];
  for (const buildIntent of ["COPY", "REDESIGN_IMPROVE"] as const) {
    for (const mode of modes) {
      const plan = buildFactoryExecutionPlan({
        mode,
        buildIntent,
        specPath: "fixtures/ci-test-spec.yaml",
      });
      const names = plan.stages.map((stage) => stage.name);
      const gate = names.indexOf("rendered-site-validation");
      assert.ok(
        gate > names.indexOf("site-build"),
        `${buildIntent}/${mode}: gate follows the build`,
      );
      for (const [index, stage] of plan.stages.entries()) {
        const leaves = stage.evidence?.externalMutation === true;
        const finalizes = ["release-receipt-finalizer", "handoff-emitter"].includes(stage.name);
        if (leaves || finalizes) {
          assert.ok(index > gate, `${buildIntent}/${mode}: ${stage.name} runs after the gate`);
        }
      }
      // The gate cannot be skipped where it guards a release.
      assert.ok(
        plan.mandatoryStages.includes("rendered-site-validation"),
        `${buildIntent}/${mode}`,
      );
      assert.throws(
        () =>
          buildFactoryExecutionPlan({
            mode,
            buildIntent,
            specPath: "fixtures/ci-test-spec.yaml",
            skipStages: ["rendered-site-validation"],
          }),
        /Cannot skip mandatory/,
      );
    }
  }
  // The stand-in sequence below is the production plan's own order.
  const endToEnd = buildFactoryExecutionPlan({
    mode: "end-to-end",
    specPath: "fixtures/ci-test-spec.yaml",
  }).stages.map((stage) => stage.name);
  const used = releaseStages(passingRenderer, fetch).map((stage) => stage.name);
  assert.deepEqual(
    used,
    endToEnd.filter((name) => used.includes(name)),
  );
});

void test("positive control: with a passing render the publisher does reach the network spy", async () => {
  const ctx = await builtCopySite();
  try {
    const spy = networkSpy();
    await withEnv({ GITHUB_SITE_TOKEN: "test-token-not-a-secret" }, async () => {
      await run(ctx, releaseStages(passingRenderer, spy.fetchImpl));
    });
    assert.ok(spy.requests.length > 0, "the spy observes publication attempts");
    assert.ok(spy.requests.every((url) => url.startsWith("https://api.github.com/")));
  } finally {
    cleanupContext(ctx);
  }
});

void test("F14 blocked-release: a failing rendered check stops the run with zero external requests", async () => {
  const ctx = await builtCopySite();
  try {
    const spy = networkSpy();
    const renderer = failingRenderer();
    let error: unknown;
    await withEnv({ GITHUB_SITE_TOKEN: "test-token-not-a-secret" }, async () => {
      error = await run(ctx, releaseStages(renderer, spy.fetchImpl));
    });
    assert.ok(isRenderedFailure(error), String(error));
    assert.match(String((error as Error).message), /required_images_visible/);
    assert.equal(renderer.calls, 1);
    await assertNothingReleased(ctx, spy.requests);
  } finally {
    cleanupContext(ctx);
  }
});

void test("F14 resumed: resuming after a failed render re-validates and still releases nothing", async () => {
  const ctx = await builtCopySite();
  try {
    const spy = networkSpy();
    const renderer = failingRenderer();
    await withEnv({ GITHUB_SITE_TOKEN: "test-token-not-a-secret" }, async () => {
      await run(ctx, releaseStages(renderer, spy.fetchImpl));
      ctx.resume = true;
      ctx.stageResults = new Map();
      const error = await run(ctx, releaseStages(renderer, spy.fetchImpl));
      assert.ok(isRenderedFailure(error), String(error));
    });
    // The failed checkpoint is never resumed as a pass: the gate ran again.
    assert.equal(renderer.calls, 2);
    await assertNothingReleased(ctx, spy.requests);
  } finally {
    cleanupContext(ctx);
  }
});

void test("F14 no-browser: an unavailable browser is a failed gate, not a skip, and releases nothing", async () => {
  const ctx = await builtCopySite();
  try {
    const spy = networkSpy();
    let error: unknown;
    await withEnv({ GITHUB_SITE_TOKEN: "test-token-not-a-secret" }, async () => {
      error = await run(ctx, releaseStages(noBrowser, spy.fetchImpl));
    });
    assert.ok(isRenderedFailure(error), String(error));
    assert.match(String((error as Error).message), /browser unavailable/);
    await assertNothingReleased(ctx, spy.requests);
  } finally {
    cleanupContext(ctx);
  }
});

void test("F14 lost-blueprint: a REDESIGN build whose blueprint is gone cannot be validated or released", async () => {
  const ctx = await redesignContext({});
  try {
    ctx.domainSpec.deploy = DEPLOY;
    ctx.mode = "end-to-end";
    const built = await run(ctx, [
      new SiteAssemblerStage(),
      new SiteBuildStage(fakeAstroBuild(["/", "/contact", "/services/drains"])),
    ]);
    assert.equal(built, undefined, "assembly and build succeed");
    ctx.websiteBlueprint = undefined;
    const spy = networkSpy();
    let error: unknown;
    await withEnv({ GITHUB_SITE_TOKEN: "test-token-not-a-secret" }, async () => {
      error = await run(ctx, releaseStages(passingRenderer, spy.fetchImpl));
    });
    assert.ok(isRenderedFailure(error), String(error));
    assert.match(String((error as Error).message), /requires the accepted website blueprint/);
    await assertNothingReleased(ctx, spy.requests);
  } finally {
    cleanupContext(ctx);
  }
});
