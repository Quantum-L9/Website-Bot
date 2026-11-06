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

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { RenderViewport } from "../../../src/validation/rendered-site.js";
import {
  type CaptureResult,
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

const scratch = mkdtempSync(join(tmpdir(), "wb-visual-"));
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
  },
  { timeout: 900_000 },
);

after(() => {
  rmSync(scratch, { recursive: true, force: true });
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
    // into the neighbouring column. Only the two-column desktop form
    // overflows; the single-column mobile form is wide enough (0 px change).
    name: "form-overflow: the contact form's fields lose their column sizing again",
    injectCss: () =>
      ".lead-form__grid > label { min-width: auto !important; } .lead-form__grid :is(input, select) { width: auto !important; }",
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
    // Every failure is inspectable: expected, actual and a diff that marks the change.
    for (const comparison of report.comparisons.filter((entry) => entry.status === "FAIL")) {
      assert.ok(comparison.evidence, `${comparison.route}@${comparison.viewport} has evidence`);
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
    }
  });
}
