// L9_META: layer=test, role=visual_reference_approval_contract, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 4, approval contract (V4-01, V4-04, V4-06):
// references are trusted only when a named human approved exactly these
// bytes, from output that passed the browser gate; approving needs an
// explicit, reviewed, non-CI request, and replacing needs --replace.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type ApprovalRequest,
  approvalProblems,
  approvalRecord,
  approvalRefusals,
  approverIsHuman,
  type CandidateManifest,
  candidateSetDigest,
  pngSize,
  screenshotName,
  sha256,
} from "../../src/validation/visual-regression.js";
import { pngBytes } from "../helpers/redesignAssemblyFixture.js";

const RENDERER = {
  engine: "chromium" as const,
  major: 156,
  version: "156.0.8078.4",
  platform: "linux" as const,
};

function candidate(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  const shot = (viewport: string, seed: string) => {
    const bytes = pngBytes(seed);
    return {
      route: "/",
      viewport,
      file: screenshotName("/", viewport),
      sha256: sha256(bytes),
      ...pngSize(bytes),
    };
  };
  return {
    design_id: "wb-fixture-redesign",
    fixture: "tests/helpers/visualReferenceFixture.ts",
    git_commit: "0".repeat(40),
    rendered_site_validation: "PASS",
    renderer: RENDERER,
    screenshots: [shot("desktop", "desktop-home"), shot("mobile", "mobile-home")],
    ...overrides,
  };
}

/** A reference directory holding an approved candidate, for tampering with. */
function approvedDir(edit?: (record: ReturnType<typeof approvalRecord>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "wb-visual-ref-"));
  const manifest = candidate();
  writeFileSync(join(dir, "desktop-home.png"), pngBytes("desktop-home"));
  writeFileSync(join(dir, "mobile-home.png"), pngBytes("mobile-home"));
  const record = approvalRecord(manifest, "Igor Example", "Approved fixture design", new Date());
  edit?.(record);
  writeFileSync(join(dir, "approval.json"), JSON.stringify(record));
  return dir;
}

function withDir(dir: string, body: (dir: string) => void): void {
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test("an approval naming a human over exactly the approved bytes is trusted", () => {
  withDir(approvedDir(), (dir) => assert.deepEqual(approvalProblems(dir), []));
});

void test("V4-01: references with no approval record are not trusted", () => {
  withDir(approvedDir(), (dir) => {
    rmSync(join(dir, "approval.json"));
    assert.match(approvalProblems(dir).join(), /no approval record/);
  });
});

void test("V4-04: a reference overwritten after approval is an unapproved update", () => {
  withDir(approvedDir(), (dir) => {
    writeFileSync(join(dir, "mobile-home.png"), pngBytes("regenerated-mobile"));
    assert.match(
      approvalProblems(dir).join(),
      /mobile-home\.png: bytes differ from the approved sha256/,
    );
  });
});

void test("V4-04: a reference file the approval does not cover is not trusted", () => {
  withDir(approvedDir(), (dir) => {
    writeFileSync(join(dir, "desktop-contact.png"), pngBytes("sneaked-in"));
    assert.match(approvalProblems(dir).join(), /desktop-contact\.png: reference file not covered/);
  });
});

void test("V4-03: an approval must protect desktop and mobile independently", () => {
  withDir(
    approvedDir((record) => {
      record.references = record.references.filter((reference) => reference.viewport === "desktop");
    }),
    (dir) => assert.match(approvalProblems(dir).join(), /no approved mobile reference/),
  );
});

void test("V4-06: an agent, bot or CI identity can never be the approver", () => {
  for (const approver of [
    "claude-code",
    "Claude",
    "github-actions[bot]",
    "codex",
    "CI",
    "website-bot",
    "",
    " ",
  ]) {
    assert.equal(approverIsHuman(approver), false, JSON.stringify(approver));
    withDir(
      approvedDir((record) => {
        record.approved_by = approver;
      }),
      (dir) => assert.match(approvalProblems(dir).join(), /is not a named human/, approver),
    );
  }
  for (const approver of ["Igor Example", "A. Reviewer", "Dana Cicero"]) {
    assert.equal(approverIsHuman(approver), true, approver);
  }
});

void test("no baseline is trusted from output that failed rendered-site validation", () => {
  withDir(
    approvedDir((record) => {
      (record.source as { rendered_site_validation: string }).rendered_site_validation = "FAIL";
    }),
    (dir) => assert.match(approvalProblems(dir).join(), /did not pass rendered-site validation/),
  );
});

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => {
  const manifest = overrides.candidate ?? candidate();
  return {
    approver: "Igor Example",
    reason: "Approved fixture design after review",
    confirm: candidateSetDigest(manifest),
    replace: false,
    env: {},
    candidate: manifest,
    referencesExist: false,
    ...overrides,
  };
};

void test("an explicit, reviewed, human approval outside CI is accepted", () => {
  assert.deepEqual(approvalRefusals(request()), []);
});

void test("approval refusals: CI, a non-human approver, no reason, an unquoted digest, an unreviewed set", () => {
  const refused = (overrides: Partial<ApprovalRequest>, pattern: RegExp) =>
    assert.match(approvalRefusals(request(overrides)).join(" | "), pattern);
  refused({ env: { CI: "true" } }, /never approved in CI/);
  refused({ env: { GITHUB_ACTIONS: "true" } }, /never approved in CI/);
  refused({ approver: "claude-code" }, /must name the person approving/);
  refused({ approver: undefined }, /must name the person approving/);
  refused({ reason: "" }, /--reason is required/);
  refused({ confirm: undefined }, /--confirm must quote the reviewed candidate digest/);
  refused({ confirm: "0000000000000000" }, /--confirm must quote the reviewed candidate digest/);
  refused({ candidate: undefined }, /no candidate capture to approve/);
  refused(
    { candidate: candidate({ rendered_site_validation: "FAIL" }) },
    /failed rendered-site validation/,
  );
});

void test("V4-04: replacing approved references needs an explicit --replace", () => {
  assert.match(
    approvalRefusals(request({ referencesExist: true })).join(),
    /replacing them needs --replace/,
  );
  assert.deepEqual(approvalRefusals(request({ referencesExist: true, replace: true })), []);
});

void test("the confirmation digest changes when any candidate file changes", () => {
  const original = candidate();
  const changed = structuredClone(original);
  changed.screenshots[1].sha256 = sha256(Buffer.from("different"));
  assert.notEqual(candidateSetDigest(original), candidateSetDigest(changed));
});
