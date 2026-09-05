// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import type { ReleaseReceipt } from "../../../src/pipeline/evidence/ReleaseReceipt.js";
import { evaluateMutationEnvelope } from "../../../src/recursive/executor/envelope.js";
import { compileEngineeringHarvest } from "../../../src/recursive/harvest/compiler.js";
import { compilePEPack } from "../../../src/recursive/pepack/compiler.js";
import { clusterSignals, selectEligibleCluster } from "../../../src/recursive/signals/registry.js";
import { sha256Text } from "../../../src/services/hashing.js";

function packForSubsystem(_subsystem: string) {
  const receipt: ReleaseReceipt = {
    schema: "website-bot.release-receipt/v2",
    receipt_id: "rr-env",
    build_id: "build-env",
    client_id: "env-client",
    mode: "end-to-end",
    status: "failed",
    missing_gates: ["visual_qa"],
    evidence: {
      assembly: {
        kind: "assembly",
        schema: "website-bot.assembly-manifest/v2",
        logical_id: "assembly:env",
        relative_path: "env/assembly.json",
        sha256: sha256Text("env-assembly"),
      },
    },
    correlation: { source_digest: sha256Text("env-source"), all_required_identities_match: true },
    qa: { seo_baseline: "passed", visual_qa: "failed" },
    created_at: "2026-08-15T00:00:00.000Z",
  };
  const harvest = compileEngineeringHarvest({
    recursiveRunId: "env-run",
    wave: 1,
    repository: "Quantum-L9/Website-Bot",
    fullCommitSha: "a".repeat(40),
    sourceUrl: "https://env.example.com",
    releaseReceipt: receipt,
    chainStatus: "released",
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
  const clusters = clusterSignals(harvest.signals);
  const cluster = selectEligibleCluster(clusters);
  assert.ok(cluster);
  const compiled = compilePEPack({
    recursiveRunId: "env-run",
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
  });
  return compiled.pack;
}

test("control-plane path edits are rejected as immutable", () => {
  const pack = packForSubsystem("VisualQA");
  const verdict = evaluateMutationEnvelope(pack, {
    changedFiles: ["src/recursive/state/constants.ts"],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.violations.some((violation) => violation.includes("control-plane")));
});

test("schema edits and test edits by the coding agent are envelope violations", () => {
  const pack = packForSubsystem("VisualQA");
  for (const file of [
    "schemas/recursive/pe-pack.schema.json",
    "tests/unit/recursive/state-machine.test.ts",
  ]) {
    const verdict = evaluateMutationEnvelope(pack, { changedFiles: [file], diffLines: 1 });
    assert.equal(verdict.allowed, false, file);
  }
});

test("explicitly forbidden paths and subsystems are rejected", () => {
  const pack = packForSubsystem("VisualQA");
  pack.mutationEnvelope.forbiddenPaths = ["src/stages/ReleaseReceiptStage.ts"];
  const verdict = evaluateMutationEnvelope(pack, {
    changedFiles: ["src/stages/ReleaseReceiptStage.ts"],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
});

test("files outside the allowed envelope are rejected when allowedPaths is set", () => {
  const pack = packForSubsystem("VisualQA");
  pack.mutationEnvelope.allowedPaths = ["src/stages/VisualQAStage.ts"];
  const verdict = evaluateMutationEnvelope(pack, {
    changedFiles: ["src/stages/DesignIntelligenceStage.ts"],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.violations.some((violation) => violation.includes("outside allowed envelope")));
});

test("file and line budgets are hard ceilings", () => {
  const pack = packForSubsystem("VisualQA");
  assert.equal(
    evaluateMutationEnvelope(pack, { changedFiles: ["a.ts", "b.ts", "c.ts", "d.ts"], diffLines: 1 })
      .allowed,
    false,
  );
  assert.equal(
    evaluateMutationEnvelope(pack, { changedFiles: ["a.ts"], diffLines: 500 }).allowed,
    false,
  );
});

test("architecture expansion is structurally prohibited", () => {
  const pack = packForSubsystem("VisualQA");
  pack.mutationEnvelope.architectureExpansionAllowed = false;
  const verdict = evaluateMutationEnvelope(pack, {
    changedFiles: ["src/visual-q.ts"],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, true); // within budgets and paths; expansion flag stays false
  // A tampered pack that flips the flag fails the structural check.
  const tampered = JSON.parse(JSON.stringify(pack)) as typeof pack;
  tampered.mutationEnvelope.architectureExpansionAllowed = true as never;
  const tamperedVerdict = evaluateMutationEnvelope(tampered, {
    changedFiles: ["src/visual-q.ts"],
    diffLines: 1,
  });
  assert.equal(tamperedVerdict.allowed, false);
});
