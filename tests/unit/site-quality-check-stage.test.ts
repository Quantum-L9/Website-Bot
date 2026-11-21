// L9_META: layer=test, role=site_quality_check_stage, status=active, version=1.0.0
//
// SiteQualityCheckStage runs the rendered-site quality checker on the build's
// own dist, in a real browser, with the CLI's rules. Its verdict is the
// client_build_quality_check readiness level, read from its report:
//   PASS -> the build proceeds; FAIL -> SITE_QUALITY_CHECK_FAILED naming the
//   findings; a checker that could not judge -> BLOCKED and the build stops.
// No waiver exists.

import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  buildReadinessLadder,
  readinessState,
} from "../../src/pipeline/evidence/ReadinessLadder.js";
import {
  SITE_QUALITY_REPORT_FILE,
  SiteQualityCheckStage,
} from "../../src/stages/SiteQualityCheckStage.js";
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureBuildProof,
  fixtureContext,
} from "../helpers/siteFactoryFixture.js";

const CLEAN_SITE = resolve("tests/quality/fixtures/clean-site");
const BUSINESS = "Harbor Light Plumbing";
const REPEATED =
  "Most calls start with a slow drain or a dripping valve, and most of them end in under two hours. We carry common cartridges, supply lines and wax rings on every truck so a second trip is the exception rather than the rule.";

/** A context whose persisted build proof names a dist copied from the clean fixture site. */
async function contextWithDist(mutate?: (dist: string) => void): Promise<BuildContext> {
  const ctx = fixtureContext({ business_name: BUSINESS });
  const dist = join(ctx.outputDir, "dist");
  cpSync(CLEAN_SITE, dist, { recursive: true });
  mutate?.(dist);
  const assembly = fixtureAssemblyManifest(ctx);
  const assemblyRecord = await ctx.evidenceStore.writeAssembly(assembly);
  await ctx.evidenceStore.writeBuild(
    fixtureBuildProof(ctx, assemblyRecord.sha256, assembly.sourceDigest),
  );
  return ctx;
}

/** Repeats one body paragraph on the home page: the filler defect. */
function duplicateParagraph(dist: string): void {
  const index = join(dist, "index.html");
  const html = readFileSync(index, "utf-8");
  writeFileSync(
    index,
    html.replace(`<p>${REPEATED}</p>`, `<p>${REPEATED}</p>\n<p>${REPEATED}</p>`),
  );
}

const level = (ctx: BuildContext) => ctx.readiness?.client_build_quality_check;

test("a clean built site passes and records the report as PASS evidence", async () => {
  const ctx = await contextWithDist();
  try {
    await new SiteQualityCheckStage().run(ctx);
    assert.equal(level(ctx)?.state, "PASS");
    assert.match(level(ctx)?.evidence_ref ?? "", new RegExp(`${SITE_QUALITY_REPORT_FILE}$`));
    const reportPath = join(ctx.evidenceStore.rootDir, SITE_QUALITY_REPORT_FILE);
    assert.ok(existsSync(reportPath), "the quality report is written into the build evidence");
    assert.equal(JSON.parse(readFileSync(reportPath, "utf-8")).status, "PASS");
    assert.equal(
      readinessState(buildReadinessLadder(ctx.readiness), "client_build_quality_check"),
      "PASS",
    );
  } finally {
    cleanupContext(ctx);
  }
});

test("a duplicate paragraph fails the build, naming the finding, and the ladder records FAIL", async () => {
  const ctx = await contextWithDist(duplicateParagraph);
  try {
    await assert.rejects(
      () => new SiteQualityCheckStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "SITE_QUALITY_CHECK_FAILED" &&
        /(^|\W)duplicate-paragraph \//.test(error.message),
    );
    assert.equal(level(ctx)?.state, "FAIL");
    assert.match(level(ctx)?.evidence_ref ?? "", new RegExp(`${SITE_QUALITY_REPORT_FILE}$`));
    const report = JSON.parse(
      readFileSync(join(ctx.evidenceStore.rootDir, SITE_QUALITY_REPORT_FILE), "utf-8"),
    );
    assert.equal(report.status, "FAIL");
    assert.equal(
      readinessState(buildReadinessLadder(ctx.readiness), "client_build_quality_check"),
      "FAIL",
    );
  } finally {
    cleanupContext(ctx);
  }
});

test("a checker that cannot judge the site stops the build as BLOCKED, never PASS", async () => {
  const ctx = await contextWithDist();
  try {
    await assert.rejects(
      () =>
        new SiteQualityCheckStage(async () => {
          throw new Error("chromium could not be launched");
        }).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === "SITE_QUALITY_CHECK_FAILED",
    );
    assert.equal(level(ctx)?.state, "BLOCKED");
    assert.equal(level(ctx)?.evidence_ref, null);
    assert.match(level(ctx)?.reason ?? "", /chromium could not be launched/);
  } finally {
    cleanupContext(ctx);
  }
});

test("dry runs check nothing and record nothing", async () => {
  const ctx = await contextWithDist();
  ctx.dryRun = true;
  try {
    await new SiteQualityCheckStage(async () => assert.fail("must not run")).run(ctx);
    assert.equal(level(ctx), undefined);
  } finally {
    cleanupContext(ctx);
  }
});
