// L9_META: layer=test, role=visual_regression_mechanism, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 4, mechanism: the deterministic capture and
// the comparator catch real visual regressions, per viewport, with evidence.
// The known-good reference fixture is built for real and passed through the
// browser gate; a baseline is captured in-test on the same renderer (a test
// oracle for the mechanism, NOT an approved reference: approval is a human
// act, see wb-visual-approved-references.test.ts). A fresh capture of the
// unchanged build must match it exactly; each deliberately broken variant
// must fail on exactly the viewports it breaks. Requires the Playwright
// chromium binary; its absence fails this test, never skips it.
//
// The baseline oracle is proven reproducible before any test uses it: a
// second capture of the unchanged build must match it pixel for pixel, so
// renderer instability surfaces as one clear before() failure rather than as
// every later comparison failing against an outlier baseline.
//
// Evidence (captures, expected / actual / diff PNGs, reports) goes to
// WB_VISUAL_EVIDENCE_DIR when set, and is kept there for CI to upload;
// otherwise to a temporary directory removed after the run.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import type { RenderViewport } from "../../../src/validation/rendered-site.js";
import {
  type CaptureResult,
  CaptureUnstableError,
  captureScreenshots,
  compareScreenshots,
  DEFAULT_VISUAL_TOLERANCE,
  pngSize,
  type VisualRegressionReport,
} from "../../../src/validation/visual-regression.js";
import { cleanupContext } from "../../helpers/siteFactoryFixture.js";
import {
  type BuiltReferenceSite,
  buildReferenceSite,
  VISUAL_FONT_DIR,
  VISUAL_ROUTES,
} from "../../helpers/visualReferenceFixture.js";

const evidenceRoot = process.env.WB_VISUAL_EVIDENCE_DIR?.trim();
const keepEvidence = Boolean(evidenceRoot);
const scratch = evidenceRoot
  ? resolve(evidenceRoot, "wb-visual-regression")
  : mkdtempSync(join(tmpdir(), "wb-visual-"));
if (keepEvidence) {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
}
let site: BuiltReferenceSite;
let baseline: CaptureResult;
const baselineDir = join(scratch, "baseline");

before(
  async () => {
    site = await buildReferenceSite();
    assert.equal(site.renderedSiteValidation, "PASS", site.renderedSiteError ?? "");
    baseline = await captureScreenshots({
      distDir: site.distDir,
      routes: VISUAL_ROUTES,
      outDir: baselineDir,
      fontDir: VISUAL_FONT_DIR,
    });
    // Oracle self-check: the baseline must itself be reproducible.
    const recheck = await compareVariant("baseline-recheck");
    const unreproducible = recheck.comparisons.filter((comparison) => comparison.diff_pixels !== 0);
    assert.deepEqual(
      unreproducible,
      [],
      `baseline oracle is not reproducible on this renderer; evidence in ${join(scratch, "baseline-recheck", "evidence")}: ${JSON.stringify(unreproducible, null, 2)}`,
    );
    assert.equal(recheck.status, "PASS");
  },
  { timeout: 900_000 },
);

after(() => {
  if (!keepEvidence) rmSync(scratch, { recursive: true, force: true });
  if (site) cleanupContext(site.ctx);
});

async function compareVariant(
  name: string,
  injectCss?: (viewport: RenderViewport) => string | undefined,
): Promise<VisualRegressionReport> {
  const actualDir = join(scratch, name, "actual");
  const actual = await captureScreenshots({
    distDir: site.distDir,
    routes: VISUAL_ROUTES,
    outDir: actualDir,
    fontDir: VISUAL_FONT_DIR,
    injectCss,
  });
  return compareScreenshots({
    design_id: "mechanism-oracle",
    referenceDir: baselineDir,
    references: baseline.screenshots,
    actualDir,
    actual,
    evidenceDir: join(scratch, name, "evidence"),
  });
}

const failing = (report: VisualRegressionReport): string[] =>
  report.comparisons
    .filter((comparison) => comparison.status === "FAIL")
    .map((comparison) => `${comparison.route}@${comparison.viewport}`)
    .sort();

const every = (viewport: string): string[] =>
  VISUAL_ROUTES.map((route) => `${route}@${viewport}`).sort();

void test("baseline: every route is captured at desktop 1440px and mobile 390px", () => {
  assert.equal(baseline.screenshots.length, VISUAL_ROUTES.length * 2);
  for (const shot of baseline.screenshots) {
    assert.equal(shot.width, shot.viewport === "desktop" ? 1440 : 390, shot.file);
    assert.deepEqual(pngSize(readFileSync(join(baselineDir, shot.file))), {
      width: shot.width,
      height: shot.height,
    });
  }
});

void test("determinism: re-rendering the unchanged build reproduces the baseline pixel for pixel", async () => {
  const report = await compareVariant("unchanged");
  assert.equal(report.status, "PASS", JSON.stringify(report.comparisons, null, 2));
  assert.ok(report.comparisons.every((comparison) => comparison.diff_pixels === 0));
});

void test("stability: a view that repaints between screenshots fails closed as capture unstable", async () => {
  // Every animation frame writes a fresh timestamp into the page heading, so
  // no two screenshots can be byte-identical however long capture waits.
  const flicker = `(() => {
    const target = document.querySelector("h1") ?? document.body;
    const tick = () => { target.textContent = String(performance.now()); requestAnimationFrame(tick); };
    tick();
  })()`;
  await assert.rejects(
    captureScreenshots({
      distDir: site.distDir,
      routes: ["/contact"],
      outDir: join(scratch, "unstable", "actual"),
      fontDir: VISUAL_FONT_DIR,
      viewports: [{ name: "mobile", width: 390, height: 844 }],
      injectScript: () => flicker,
      maxStableAttempts: 3,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CaptureUnstableError, String(error));
      assert.match(error.message, /^capture unstable: \/contact@mobile /);
      assert.equal(error.attempts, 3);
      return true;
    },
  );
});

void test("stability: every accepted capture was confirmed by two identical screenshots", () => {
  for (const shot of baseline.screenshots) {
    assert.ok((shot.capture_attempts ?? 0) >= 2, `${shot.file}: ${shot.capture_attempts}`);
  }
});

void test("unapproved view: a rendered route/viewport with no approved reference fails, never passes silently", async () => {
  const actualDir = join(scratch, "unapproved", "actual");
  const actual = await captureScreenshots({
    distDir: site.distDir,
    routes: VISUAL_ROUTES,
    outDir: actualDir,
    fontDir: VISUAL_FONT_DIR,
  });
  const report = await compareScreenshots({
    design_id: "mechanism-oracle",
    referenceDir: baselineDir,
    // A protected route list that grew after approval: /contact@mobile was never approved.
    references: baseline.screenshots.filter(
      (shot) => !(shot.route === "/contact" && shot.viewport === "mobile"),
    ),
    actualDir,
    actual,
    evidenceDir: join(scratch, "unapproved", "evidence"),
  });
  assert.equal(report.status, "FAIL");
  assert.deepEqual(failing(report), ["/contact@mobile"]);
  assert.match(
    report.comparisons.find((entry) => entry.status === "FAIL")?.detail ?? "",
    /no approved reference/,
  );
});

const desktopOnly = (css: string) => (viewport: RenderViewport) =>
  viewport.name === "desktop" ? css : undefined;
const mobileOnly = (css: string) => (viewport: RenderViewport) =>
  viewport.name === "mobile" ? css : undefined;

const VARIANTS: Array<{
  name: string;
  injectCss: (viewport: RenderViewport) => string | undefined;
  expected: string[];
}> = [
  {
    name: "desktop-spacing: vertical spacing above the content changes at desktop only",
    injectCss: desktopOnly("main { margin-top: 24px !important; }"),
    expected: every("desktop"),
  },
  {
    name: "mobile-typography: the hero headline grows on phones only",
    injectCss: mobileOnly(".hero h1 { font-size: 3.4rem !important; }"),
    expected: ["/@mobile"],
  },
  {
    name: "typography: body text tracking changes everywhere",
    injectCss: () => "body { letter-spacing: 0.04em !important; }",
    expected: [...every("desktop"), ...every("mobile")].sort(),
  },
  {
    name: "cropping: the hero photo is cropped into a strip",
    injectCss: () => ".hero__image { object-fit: cover !important; height: 90px !important; }",
    expected: ["/@desktop", "/@mobile"],
  },
  {
    // The real defect found in the Wave 4 review: form fields overflowing
    // into the neighbouring column. Only the desktop capture may change.
    // width:auto no longer paints differently: a grid item with width auto
    // still stretches, so the fixture forces columns wider than the form.
    name: "form-overflow: the contact form's fields lose their column sizing again",
    injectCss: desktopOnly(
      ".lead-form__grid { grid-template-columns: 20rem 20rem !important; } .lead-form__grid > label { min-width: 20rem !important; }",
    ),
    expected: ["/contact@desktop"],
  },
  {
    name: "composition: the home page sections render in reverse order",
    injectCss: () =>
      "main { display: flex !important; flex-direction: column-reverse !important; }",
    expected: [...every("desktop"), ...every("mobile")].sort(),
  },
];

for (const variant of VARIANTS) {
  void test(`regression fixture ${variant.name}`, { timeout: 300_000 }, async () => {
    const report = await compareVariant(variant.name.split(":")[0], variant.injectCss);
    assert.equal(report.status, "FAIL");
    assert.deepEqual(
      failing(report),
      variant.expected,
      JSON.stringify(report.comparisons, null, 2),
    );
    // Every failure is inspectable: expected, actual and a diff that marks the
    // change, plus the changed region in the detail so a bare log locates it.
    for (const comparison of report.comparisons.filter((entry) => entry.status === "FAIL")) {
      assert.ok(comparison.evidence, `${comparison.route}@${comparison.viewport} has evidence`);
      const box = comparison.diff_bbox;
      assert.ok(box, `${comparison.route}@${comparison.viewport} names its differing region`);
      assert.ok(box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0, JSON.stringify(box));
      assert.match(
        comparison.detail,
        new RegExp(`differing region x=${box.x} y=${box.y} w=${box.width} h=${box.height}$`),
      );
      const dir = join(scratch, variant.name.split(":")[0], "evidence");
      for (const file of Object.values(comparison.evidence)) {
        assert.ok(existsSync(join(dir, file)), file);
        assert.ok(pngSize(readFileSync(join(dir, file))).width > 0, file);
      }
      assert.ok(
        comparison.diff_ratio > DEFAULT_VISUAL_TOLERANCE.maxDiffRatio ||
          comparison.detail.startsWith("size changed"),
      );
    }
    // The untouched viewports and routes still match exactly.
    for (const comparison of report.comparisons.filter((entry) => entry.status === "PASS")) {
      assert.equal(comparison.diff_pixels, 0, `${comparison.route}@${comparison.viewport}`);
      assert.equal(comparison.diff_bbox, undefined);
    }
  });
}
