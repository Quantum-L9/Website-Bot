// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ReleaseReceipt } from "../../../src/pipeline/evidence/ReleaseReceipt.js";
import type { PEPack } from "../../../src/recursive/contracts/types.js";
import { compileEngineeringHarvest } from "../../../src/recursive/harvest/compiler.js";
import { compilePEPack } from "../../../src/recursive/pepack/compiler.js";
import { clusterSignals, selectEligibleCluster } from "../../../src/recursive/signals/registry.js";
import { computeBlastRadius } from "../../../src/recursive/verifier/blast-radius.js";
import { IndependentVerifier } from "../../../src/recursive/verifier/verifier.js";
import { sha256Text } from "../../../src/services/hashing.js";

function pack(): PEPack {
  const receipt: ReleaseReceipt = {
    schema: "website-bot.release-receipt/v2",
    receipt_id: "rr-vf",
    build_id: "build-vf",
    client_id: "vf-client",
    mode: "end-to-end",
    status: "failed",
    missing_gates: ["visual_qa"],
    evidence: {
      assembly: {
        kind: "assembly",
        schema: "website-bot.assembly-manifest/v2",
        logical_id: "assembly:vf",
        relative_path: "vf/assembly.json",
        sha256: sha256Text("vf-assembly"),
      },
    },
    correlation: { source_digest: sha256Text("vf-source"), all_required_identities_match: true },
    qa: { seo_baseline: "passed", visual_qa: "failed" },
    created_at: "2026-08-15T00:00:00.000Z",
  };
  const harvest = compileEngineeringHarvest({
    recursiveRunId: "vf-run",
    wave: 1,
    repository: "Quantum-L9/Website-Bot",
    fullCommitSha: "a".repeat(40),
    sourceUrl: "https://vf.example.com",
    releaseReceipt: receipt,
    chainStatus: "released",
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
  const cluster = selectEligibleCluster(clusterSignals(harvest.signals));
  assert.ok(cluster);
  return compilePEPack({
    recursiveRunId: "vf-run",
    wave: 1,
    harvest,
    cluster,
    sourceCodeFullSha: "a".repeat(40),
    artifactManifestDigest: sha256Text("manifest"),
    controlPlaneCommit: "c".repeat(40),
    planDigest: sha256Text("plan"),
    peSchemaDigest: sha256Text("pe-schema"),
    holdoutManifestDigest: sha256Text("holdout"),
    regressionSets: { originating: [], controls: [], disconfirm: [] },
    testContractDigest: sha256Text("test-contract"),
    requiredVerifier: "independent-verifier",
    environment: "preview",
    maxChangedFiles: 3,
    maxDiffLines: 30,
    maxDeploymentAttempts: 1,
  }).pack;
}

const VERIFIED = "b".repeat(40);
const BEFORE = "a".repeat(40);

function verifierInput(overrides: Partial<Parameters<IndependentVerifier["verify"]>[0]> = {}) {
  return {
    pack: pack(),
    verifierIdentity: "independent-verifier",
    beforeSha: BEFORE,
    patchedSha: VERIFIED,
    changedFiles: ["src/visual-qa-patch.ts"],
    diffLines: 1,
    repositoryRoot: "/tmp",
    patchWorkdir: "/tmp",
    originating: [
      {
        caseRef: {
          caseId: "REG-1",
          ref: { refKind: "regression", refId: "REG-1", digest: sha256Text("REG-1") },
        },
        beforeResult: "FAIL",
        afterResult: "PASS",
        expectedDirection: "IMPROVE" as const,
      },
    ],
    controls: [
      {
        caseRef: {
          caseId: "CTRL-1",
          ref: { refKind: "control", refId: "CTRL-1", digest: sha256Text("CTRL-1") },
        },
        beforeResult: "PASS",
        afterResult: "PASS",
        expectedDirection: "UNCHANGED" as const,
      },
    ],
    disconfirm: [],
    holdoutCases: [{ caseId: "HOLD-1", passed: true }],
    repositoryChecks: [
      { name: "typecheck", passed: true },
      { name: "unit", passed: true },
    ],
    expectedChangedArtifacts: ["src/visual-qa-patch.ts"],
    expectedUnchangedArtifacts: [],
    artifactRoot: "/tmp",
    beforeArtifacts: [],
    afterArtifacts: [],
    ...overrides,
  };
}

test("the coding executor cannot act as the verifier of its own work", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  // A pack whose required verifier is the coding executor can never be
  // verified by the independent verifier: identity binding fails closed.
  const selfCertifiedPack = pack();
  selfCertifiedPack.mergePolicy.requiredVerifier = "coding-executor";
  assert.throws(
    () => verifier.verify(verifierInput({ pack: selfCertifiedPack })),
    /identity mismatch/,
  );
});

test("a fully passing verification yields PASS with the verified patch SHA receipt", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(verifierInput());
  assert.equal(receipt.verdict, "PASS");
  assert.equal(receipt.verifiedPatchSha, VERIFIED);
  assert.equal(receipt.validation.protectedHoldout.verdict, "PASS");
});

test("originating failure blocks with FAIL_TARGET", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(
    verifierInput({
      originating: [
        {
          caseRef: {
            caseId: "REG-1",
            ref: { refKind: "regression", refId: "REG-1", digest: sha256Text("REG-1") },
          },
          beforeResult: "FAIL",
          afterResult: "FAIL",
          expectedDirection: "IMPROVE",
        },
      ],
    }),
  );
  assert.equal(receipt.verdict, "FAIL_TARGET");
});

test("control regression blocks with FAIL_CONTROL (origin fix breaking controls)", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(
    verifierInput({
      controls: [
        {
          caseRef: {
            caseId: "CTRL-1",
            ref: { refKind: "control", refId: "CTRL-1", digest: sha256Text("CTRL-1") },
          },
          beforeResult: "PASS",
          afterResult: "FAIL",
          expectedDirection: "UNCHANGED",
        },
      ],
    }),
  );
  assert.equal(receipt.verdict, "FAIL_CONTROL");
});

test("visible cases passing while holdout fails blocks with FAIL_HOLDOUT", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(
    verifierInput({ holdoutCases: [{ caseId: "HOLD-1", passed: false }] }),
  );
  assert.equal(receipt.verdict, "FAIL_HOLDOUT");
});

test("repository check failure blocks with FAIL_CI", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(
    verifierInput({
      repositoryChecks: [
        { name: "typecheck", passed: false },
        { name: "unit", passed: true },
      ],
    }),
  );
  assert.equal(receipt.verdict, "FAIL_CI");
});

test("envelope violation blocks with FAIL_SCOPE", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const receipt = verifier.verify(
    verifierInput({ changedFiles: ["src/recursive/state/constants.ts"] }),
  );
  assert.equal(receipt.verdict, "FAIL_SCOPE");
});

test("unexpected artifact blast radius fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "blast-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "expected.ts"), "x");
    writeFileSync(join(root, "untouched.json"), "y");
    const result = computeBlastRadius({
      expectedChangedArtifacts: ["expected.ts"],
      expectedUnchangedArtifacts: ["untouched.json"],
      before: [
        { artifactId: "expected.ts", relativePath: "expected.ts", sha256: sha256Text("x") },
        { artifactId: "untouched.json", relativePath: "untouched.json", sha256: sha256Text("y") },
      ],
      after: [
        { artifactId: "expected.ts", relativePath: "expected.ts", sha256: sha256Text("x2") },
        { artifactId: "untouched.json", relativePath: "untouched.json", sha256: sha256Text("y2") },
      ],
    });
    assert.equal(result.verdict, "FAIL");
    assert.deepEqual(result.unexpectedlyChangedArtifacts, ["untouched.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expected-change blast radius passes", () => {
  const result = computeBlastRadius({
    expectedChangedArtifacts: ["expected.ts"],
    expectedUnchangedArtifacts: ["untouched.json"],
    before: [
      { artifactId: "expected.ts", relativePath: "expected.ts", sha256: sha256Text("x") },
      { artifactId: "untouched.json", relativePath: "untouched.json", sha256: sha256Text("y") },
    ],
    after: [
      { artifactId: "expected.ts", relativePath: "expected.ts", sha256: sha256Text("x2") },
      { artifactId: "untouched.json", relativePath: "untouched.json", sha256: sha256Text("y") },
    ],
  });
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.unexpectedlyChangedArtifacts, []);
});

test("repository check refuses shell metacharacters instead of invoking bash -lc", () => {
  const verifier = new IndependentVerifier("independent-verifier");
  const injected = verifier.runRepositoryCheck("unit", process.cwd(), "true; echo injected");
  assert.equal(injected.passed, false);
  const ok = verifier.runRepositoryCheck("unit", process.cwd(), "true");
  assert.equal(ok.passed, true);
});
