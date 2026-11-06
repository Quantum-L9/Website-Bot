// L9_META: layer=test, role=visual_approved_reference_gate, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 4, protection: every design the registry
// lists as approved is rebuilt, re-rendered and compared with its
// human-approved references at desktop and mobile; any difference beyond
// tolerance fails with expected / actual / diff evidence. Trust is checked
// first and fails closed: an approval that names no human, a reference whose
// bytes are not the approved ones, or a renderer line other than the one the
// approval was made on is a failure, never a skip. A design still awaiting
// approval is not protected yet, and may hold no reference files at all, so
// a first design can never approve itself.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  approvalProblems,
  captureScreenshots,
  compareScreenshots,
  readApproval,
} from "../../../src/validation/visual-regression.js";
import { cleanupContext } from "../../helpers/siteFactoryFixture.js";
import {
  buildReferenceSite,
  referenceDir,
  VISUAL_DESIGN_ID,
  VISUAL_FONT_DIR,
  VISUAL_REFERENCE_ROOT,
} from "../../helpers/visualReferenceFixture.js";
import { readRegistry } from "../../visual/registry.js";

const registry = readRegistry(VISUAL_REFERENCE_ROOT);

void test("the registry lists the reference fixture design", () => {
  assert.ok(registry.designs.some((design) => design.design_id === VISUAL_DESIGN_ID));
});

for (const design of registry.designs.filter((entry) => entry.status === "awaiting-approval")) {
  void test(`${design.design_id}: awaiting human approval, so it holds no references that could approve themselves`, () => {
    const dir = referenceDir(design.design_id);
    const files = existsSync(dir) ? readdirSync(dir) : [];
    assert.deepEqual(files, [], "references appear only through tests/visual/approve-reference.ts");
  });
}

for (const design of registry.designs.filter((entry) => entry.status === "approved")) {
  void test(`${design.design_id}: matches its approved desktop and mobile references`, {
    timeout: 900_000,
  }, async () => {
    const dir = referenceDir(design.design_id);
    assert.deepEqual(approvalProblems(dir), [], "the references are exactly the approved ones");
    const approval = readApproval(dir);
    assert.equal(design.design_id, VISUAL_DESIGN_ID, "only the reference fixture can be rebuilt");
    const site = await buildReferenceSite();
    const scratch = mkdtempSync(join(tmpdir(), "wb-visual-approved-"));
    // Kept after the run (gitignored) so a failure can be inspected.
    const evidenceDir = resolve("build/visual-evidence", design.design_id);
    rmSync(evidenceDir, { recursive: true, force: true });
    try {
      assert.equal(site.renderedSiteValidation, "PASS", site.renderedSiteError ?? "");
      const actualDir = join(scratch, "actual");
      const actual = await captureScreenshots({
        distDir: site.distDir,
        routes: design.routes,
        outDir: actualDir,
        fontDir: VISUAL_FONT_DIR,
      });
      assert.equal(
        actual.renderer.major,
        approval.renderer.major,
        `references were approved on chromium ${approval.renderer.version}; this renderer is ${actual.renderer.version} — re-approve on this renderer line`,
      );
      const report = await compareScreenshots({
        design_id: design.design_id,
        referenceDir: dir,
        references: approval.references,
        actualDir,
        actual,
        evidenceDir,
        tolerance: approval.tolerance,
      });
      assert.equal(
        report.status,
        "PASS",
        `expected / actual / diff PNGs in ${evidenceDir}: ${JSON.stringify(report.comparisons, null, 2)}`,
      );
    } finally {
      cleanupContext(site.ctx);
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
