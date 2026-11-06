// L9_META: layer=test, role=resume_invalidation_contract, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 3, resume half (T15 / F15, INV-13): a
// resumed build whose accepted content, blueprint or client assets changed
// must rebuild and re-validate from the new inputs; it may never ship output
// assembled from the old ones. Each case builds fresh through the real
// PipelineRunner, changes exactly one accepted input, resumes the same build,
// and checks the published page, the published bytes and what the browser
// gate was asked to verify.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { PipelineRunner, type Stage } from "../../src/pipeline/PipelineRunner.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { RenderedSiteValidationStage } from "../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../src/stages/SiteBuildStage.js";
import { StructuredContentProjectionStage } from "../../src/stages/StructuredContentProjectionStage.js";
import type { RenderSiteOptions, SiteRenderer } from "../../src/validation/rendered-site.js";
import { fakeAstroBuild, renderedReport } from "../helpers/fakeSiteBuild.js";
import {
  BLUEPRINT,
  page,
  pngBytes,
  redesignContext,
  sections,
  sha256,
} from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

process.env.BUILD_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "wb-resume-db-")), "build.db");

const COPY_ROUTES = ["/", "/services", "/contact"];
const REDESIGN_ROUTES = ["/", "/contact", "/services/drains"];

/** A passing browser gate that records what it was asked to verify, per run. */
function capturingRenderer(): SiteRenderer & { seen: RenderSiteOptions[] } {
  const renderer = {
    seen: [] as RenderSiteOptions[],
    async render(options: RenderSiteOptions) {
      renderer.seen.push(options);
      return renderedReport(options);
    },
  };
  return renderer;
}

async function runPipeline(ctx: BuildContext, stages: Stage[]): Promise<void> {
  const runner = new PipelineRunner();
  for (const stage of stages) runner.register(stage);
  ctx.stageResults = new Map();
  await runner.run(ctx);
}

/** Run, change one accepted input, resume the same build, run again. */
async function buildThenResume(
  ctx: BuildContext,
  stages: () => Stage[],
  change: () => void | Promise<void>,
): Promise<void> {
  await runPipeline(ctx, stages());
  await change();
  ctx.resume = true;
  await runPipeline(ctx, stages());
  for (const stage of ["site-assembler", "site-build", "rendered-site-validation"]) {
    const result = ctx.stageResults.get(stage);
    assert.equal(result?.ok, true, `${stage} passed`);
    assert.notEqual(result?.skipped, true, `${stage} re-ran on the changed input`);
  }
}

const copyStages = (renderer: SiteRenderer) => (): Stage[] => [
  new ImageAssetPlanningStage(),
  new SiteAssemblerStage(),
  new SiteBuildStage(fakeAstroBuild(COPY_ROUTES)),
  new RenderedSiteValidationStage(renderer),
];

const redesignStages = (renderer: SiteRenderer) => (): Stage[] => [
  new StructuredContentProjectionStage(),
  new SiteAssemblerStage(),
  new SiteBuildStage(fakeAstroBuild(REDESIGN_ROUTES)),
  new RenderedSiteValidationStage(renderer),
];

/** Adopt the accepted redesign authorities of another fixture (a changed upstream). */
function adoptAuthorities(ctx: BuildContext, from: BuildContext): void {
  ctx.websiteBlueprint = from.websiteBlueprint;
  ctx.pageContentContract = from.pageContentContract;
  ctx.structuredContentPackage = from.structuredContentPackage;
}

void test("F15 COPY content: changed approved copy on resume is what ships", async () => {
  const ctx = fixtureContext();
  const renderer = capturingRenderer();
  try {
    await buildThenResume(ctx, copyStages(renderer), () => {
      const key = [...ctx.generatedContent.keys()][0];
      ctx.generatedContent.set(key, "Revised approved copy that replaced the earlier draft.");
    });
    assert.ok(page(ctx, "/").includes("Revised approved copy that replaced the earlier draft."));
    assert.equal(renderer.seen.length, 2, "the browser gate validated the rebuilt site");
  } finally {
    cleanupContext(ctx);
  }
});

void test("F15 COPY asset: a replaced client photo is republished with its new bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-resume-assets-"));
  const photo = join(dir, "storefront.png");
  writeFileSync(photo, pngBytes("storefront-v1"));
  const ctx = fixtureContext();
  ctx.domainSpec.assets = {
    providedImages: [{ id: "storefront", path: photo, intendedPlacement: "/:hero" }],
  };
  const published = (): string => {
    const asset = ctx.resolvedImages?.get("/:hero");
    assert.ok(asset, "the hero photo is published");
    return sha256(readFileSync(join(ctx.outputDir, "public/images", asset.outputFileName)));
  };
  try {
    await buildThenResume(ctx, copyStages(capturingRenderer()), () => {
      assert.equal(published(), sha256(pngBytes("storefront-v1")));
      writeFileSync(photo, pngBytes("storefront-v2"));
    });
    assert.equal(published(), sha256(pngBytes("storefront-v2")), "the new client bytes ship");
  } finally {
    cleanupContext(ctx);
  }
});

void test("F15 REDESIGN content: a revised structured content package is what ships", async () => {
  const ctx = await redesignContext({});
  const revised = await redesignContext({
    routes: (routes) =>
      routes.map((route) => ({
        ...route,
        sections: route.sections.map((section) =>
          section.section_id === "hero"
            ? { ...section, heading: "Revised Approved Headline" }
            : section,
        ),
      })),
  });
  try {
    await buildThenResume(ctx, redesignStages(capturingRenderer()), () => {
      assert.ok(!page(ctx, "/").includes("Revised Approved Headline"));
      adoptAuthorities(ctx, revised);
    });
    const hero = sections(page(ctx, "/")).find((section) => section.sectionId === "hero");
    assert.equal(hero?.structured.heading, "Revised Approved Headline");
  } finally {
    cleanupContext(ctx);
    cleanupContext(revised);
  }
});

void test("F15 REDESIGN blueprint: a reordered blueprint reorders the page and the browser gate's expectation", async () => {
  const ctx = await redesignContext({});
  const reorder = BLUEPRINT.map((route) =>
    route.route_id === "/" ? { ...route, sections: [...route.sections].reverse() } : route,
  );
  const revised = await redesignContext({ blueprint: reorder });
  const renderer = capturingRenderer();
  try {
    await buildThenResume(ctx, redesignStages(renderer), () => adoptAuthorities(ctx, revised));
    const want = [...(BLUEPRINT.find((route) => route.route_id === "/")?.sections ?? [])]
      .reverse()
      .map((section) => section.section_id);
    assert.deepEqual(
      sections(page(ctx, "/")).map((section) => section.sectionId),
      want,
    );
    const home = (run: number) =>
      renderer.seen[run].routes.find((route) => route.slug === "/")?.expect?.section_order;
    assert.deepEqual(home(1), want, "the gate checks the new order, not the old one");
    assert.notDeepEqual(home(0), home(1));
  } finally {
    cleanupContext(ctx);
    cleanupContext(revised);
  }
});
