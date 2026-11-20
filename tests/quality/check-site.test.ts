// L9_META: layer=test, role=site_quality_checker_rendered, status=active, version=1.0.0
//
// The checker end to end over committed HTML fixtures, rendered in real
// headless Chromium (CI installs it; a missing browser fails, never skips):
//
//   tests/quality/fixtures/clean-site           -> PASS
//   tests/quality/fixtures/safehaven-like-site  -> FAIL, reproducing every
//     defect observed on the first production site.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  businessNameFromSpec,
  parseArgs,
  runSiteQuality,
} from "../../scripts/quality/check-site.js";
import { discoverRoutes, resolveStaticFile } from "../../scripts/quality/extract-page.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const work = mkdtempSync(join(tmpdir(), "wb-site-quality-"));
test.after(() => rmSync(work, { recursive: true, force: true }));

test("routes are discovered from the built dist", () => {
  assert.deepEqual(discoverRoutes(join(FIXTURES, "clean-site")), ["/", "/contact", "/services"]);
});

test("the static resolver serves index.html for directories and refuses traversal", () => {
  const root = join(FIXTURES, "clean-site");
  assert.equal(resolveStaticFile(root, "/services"), join(root, "services", "index.html"));
  assert.equal(resolveStaticFile(root, "/"), join(root, "index.html"));
  assert.equal(resolveStaticFile(root, "/../safehaven-like-site/index.html"), undefined);
  assert.equal(resolveStaticFile(root, "/nope"), undefined);
});

test("argument parsing requires one target and a business name", () => {
  assert.throws(() => parseArgs(["--business-name", "X"]), /exactly one of --dist or --url/);
  assert.throws(() => parseArgs(["--dist", "d"]), /business-name/);
  assert.throws(() => parseArgs(["--url", "https://x.test", "--business-name", "X"]), /--pages/);
  assert.equal(
    parseArgs(["--dist", "d", "--spec", "fixtures/replay/replay-spec.yaml"]).businessName,
    "Replay Plumbing Co",
  );
  assert.equal(businessNameFromSpec("fixtures/replay/replay-spec.yaml"), "Replay Plumbing Co");
});

test("a clean built site PASSES", { timeout: 120_000 }, async () => {
  const reportPath = join(work, "clean.json");
  const report = await runSiteQuality({
    dist: join(FIXTURES, "clean-site"),
    businessName: "Harbor Light Plumbing",
    reportPath,
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.findings, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.pages, 3);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf-8")).status, "PASS");
});

test("a SafeHaven-style site FAILS on every reproduced live defect", {
  timeout: 120_000,
}, async () => {
  const report = await runSiteQuality({
    dist: join(FIXTURES, "safehaven-like-site"),
    businessName: "Ridgeline Roofing",
    reportPath: join(work, "bad.json"),
  });
  assert.equal(report.status, "FAIL");
  const has = (check: string, page?: string, evidence?: RegExp) =>
    report.findings.some(
      (finding) =>
        finding.check === check &&
        (page === undefined || finding.page === page) &&
        (evidence === undefined || evidence.test(finding.evidence ?? finding.detail)),
    );
  // One filler sentence repeated 4x on home, and again on /services.
  assert.ok(has("duplicate-paragraph", "/", /highest quality roofing/));
  assert.ok(has("cross-page-duplicate-paragraph", "/,/services"));
  // The previous site's buttons pasted in as body copy.
  assert.ok(has("controls-as-body-copy", "/", /Get A Free Quote Call Now/));
  assert.ok(has("run-on-text", "/"));
  assert.ok(has("nav-label-run-on", "/"));
  // Internal labels: CSS-uppercased eyebrow and a literal heading.
  assert.ok(has("internal-label-visible", "/", /^TRUST SIGNALS$/));
  assert.ok(has("internal-label-visible", "/", /^SERVICE DETAIL$/));
  assert.ok(has("heading-equals-business-name", "/", /Ridgeline Roofing/));
  assert.ok(has("empty-faq-answer", "/", /roof replacement/));
  assert.ok(has("empty-control-label", "/"));
  assert.ok(has("empty-control-label", "/services", /\/contact/));
  assert.ok(has("cross-client-literal", "/", /safe haven/));
  assert.ok(has("cross-client-literal", "/", /free roof inspection within 24 hours/));
  assert.ok(has("image-broken", "/", /\/missing-hero\.jpg/));
  assert.ok(has("word-count-floor", "/"));
  assert.ok(has("word-count-floor", "/services"));
});

test("a missing dist is BLOCKED, not PASS", async () => {
  const report = await runSiteQuality({
    dist: join(work, "does-not-exist"),
    businessName: "X",
    reportPath: join(work, "blocked.json"),
  });
  assert.equal(report.status, "BLOCKED");
  assert.match(report.errors.join(" "), /no built site/);
});

test("a browser that cannot launch is BLOCKED", async () => {
  const report = await runSiteQuality(
    {
      dist: join(FIXTURES, "clean-site"),
      businessName: "Harbor Light Plumbing",
      reportPath: join(work, "nobrowser.json"),
    },
    async () => {
      throw new Error("Executable doesn't exist");
    },
  );
  assert.equal(report.status, "BLOCKED");
  assert.match(report.errors.join(" "), /Executable/);
});
