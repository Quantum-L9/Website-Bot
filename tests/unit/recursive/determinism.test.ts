// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { readdirSync, rmSync } from "node:fs";
import test from "node:test";
import type { ReleaseReceipt } from "../../../src/pipeline/evidence/ReleaseReceipt.js";
import { digestArtifact, refForArtifact } from "../../../src/recursive/contracts/digest.js";
import { compileEngineeringHarvest } from "../../../src/recursive/harvest/compiler.js";
import { clusterSignals } from "../../../src/recursive/signals/registry.js";
import { JsonStore } from "../../../src/recursive/storage/json-store.js";
import { canonicalJson, sha256Text } from "../../../src/services/hashing.js";

function receipt(): ReleaseReceipt {
  return {
    schema: "website-bot.release-receipt/v2",
    receipt_id: "rr-det",
    build_id: "build-det",
    client_id: "det-client",
    mode: "end-to-end",
    status: "failed",
    missing_gates: ["visual_qa"],
    evidence: {
      assembly: {
        kind: "assembly",
        schema: "website-bot.assembly-manifest/v2",
        logical_id: "assembly:det",
        relative_path: "det/assembly.json",
        sha256: sha256Text("det-assembly"),
      },
    },
    correlation: { source_digest: sha256Text("det-source"), all_required_identities_match: true },
    qa: { seo_baseline: "passed", visual_qa: "failed" },
    created_at: "2026-08-15T00:00:00.000Z",
  };
}

function harvestInput() {
  return {
    recursiveRunId: "det-run",
    wave: 1 as const,
    repository: "Quantum-L9/Website-Bot",
    fullCommitSha: "a".repeat(40),
    sourceUrl: "https://det.example.com",
    releaseReceipt: receipt(),
    chainStatus: "released",
    stageFailures: [{ stage: "visual-qa", errorCode: "VISUAL_FAIL" }],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  };
}

test("canonical digests are order-independent and deterministic", () => {
  const left = { b: 1, a: [2, 1], c: "x" };
  const right = { c: "x", a: [2, 1], b: 1 };
  assert.equal(sha256Text(canonicalJson(left)), sha256Text(canonicalJson(right)));
  assert.equal(digestArtifact("t", left), digestArtifact("t", right));
  const refA = refForArtifact("t", left);
  const refB = refForArtifact("t", right);
  assert.deepEqual(refA, refB);
});

test("engineering harvest is deterministic for identical evidence", () => {
  const first = compileEngineeringHarvest(harvestInput());
  const second = compileEngineeringHarvest(harvestInput());
  assert.equal(
    digestArtifact("engineering-harvest", first),
    digestArtifact("engineering-harvest", second),
  );
  assert.equal(first.signals.length, second.signals.length);
  assert.deepEqual(
    first.signals.map((signal) => signal.signalId),
    second.signals.map((signal) => signal.signalId),
  );
});

test("signal clustering is deterministic and idempotent", () => {
  const harvest = compileEngineeringHarvest(harvestInput());
  const first = clusterSignals(harvest.signals);
  const second = clusterSignals(harvest.signals);
  assert.deepEqual(
    first.map((cluster) => cluster.clusterId),
    second.map((cluster) => cluster.clusterId),
  );
  assert.deepEqual(
    first.map((cluster) => cluster.signals.map((signal) => signal.signalId)),
    second.map((cluster) => cluster.signals.map((signal) => signal.signalId)),
  );
});

test("json store writes are crash-safe (atomic tmp+rename leaves no partial files)", () => {
  const root = `/tmp/recursive-store-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const store = new JsonStore(root);
    store.write("dir/doc.json", { value: 42 });
    assert.deepEqual(store.read("dir/doc.json"), { value: 42 });
    assert.deepEqual(readdirSync(`${root}/dir`), ["doc.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
