// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DeploymentVerifier,
  LocalDirectoryDeploymentAdapter,
} from "../../../src/recursive/deployment/verifier.js";
import { sha256Text } from "../../../src/services/hashing.js";

const MERGE_SHA = "a".repeat(40);
const PREVIOUS_SHA = "b".repeat(40);

test("successful deployment returns PASS with the exact deployed SHA", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  try {
    const verifier = new DeploymentVerifier(
      new LocalDirectoryDeploymentAdapter(join(root, "target"), join(root, "health.txt")),
    );
    const { receipt, rolledBack } = await verifier.deployAndVerify({
      mergeSha: MERGE_SHA,
      environment: "preview",
      previousVerifiedSha: PREVIOUS_SHA,
      maxAttempts: 1,
    });
    assert.equal(rolledBack, false);
    assert.equal(receipt.healthVerdict, "PASS");
    assert.equal(receipt.deployedSha, MERGE_SHA);
    assert.equal(receipt.mergeSha, MERGE_SHA);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deployment SHA provenance mismatch fails closed and rolls back", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  try {
    class MismatchingAdapter extends LocalDirectoryDeploymentAdapter {
      override async deploy(sha: string, environment: string) {
        const result = await super.deploy(sha, environment);
        return { ...result, deployedSha: "f".repeat(40) };
      }
    }
    const verifier = new DeploymentVerifier(
      new MismatchingAdapter(join(root, "target"), join(root, "health.txt")),
    );
    const { receipt, rolledBack } = await verifier.deployAndVerify({
      mergeSha: MERGE_SHA,
      environment: "preview",
      previousVerifiedSha: PREVIOUS_SHA,
      maxAttempts: 1,
    });
    assert.equal(rolledBack, true);
    assert.equal(receipt.healthVerdict, "FAIL");
    assert.equal(receipt.rollback?.restoredSha, PREVIOUS_SHA);
    assert.equal(receipt.rollback?.verified, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("health failure triggers automatic rollback to the previous verified SHA", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  try {
    class UnhealthyAdapter extends LocalDirectoryDeploymentAdapter {
      override async health(environment: string) {
        void environment;
        return false;
      }
    }
    const verifier = new DeploymentVerifier(
      new UnhealthyAdapter(join(root, "target"), join(root, "health.txt")),
    );
    const { receipt, rolledBack } = await verifier.deployAndVerify({
      mergeSha: MERGE_SHA,
      environment: "preview",
      previousVerifiedSha: PREVIOUS_SHA,
      maxAttempts: 1,
    });
    assert.equal(rolledBack, true);
    assert.equal(receipt.healthVerdict, "FAIL");
    assert.equal(receipt.rollback?.restoredSha, PREVIOUS_SHA);
    // The next E2E would test the restored revision, never the bad deploy.
    assert.equal(receipt.deployedSha, MERGE_SHA);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deployment attempts are budgeted: the final attempt rolls back and fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  try {
    let attempts = 0;
    class CountingFailingAdapter extends LocalDirectoryDeploymentAdapter {
      override async deploy(sha: string, environment: string) {
        attempts += 1;
        return super.deploy(sha, environment);
      }
      override async health(environment: string) {
        void environment;
        return false;
      }
    }
    const verifier = new DeploymentVerifier(
      new CountingFailingAdapter(join(root, "target"), join(root, "health.txt")),
    );
    const { receipt, rolledBack } = await verifier.deployAndVerify({
      mergeSha: MERGE_SHA,
      environment: "preview",
      previousVerifiedSha: PREVIOUS_SHA,
      maxAttempts: 2,
    });
    assert.equal(attempts, 2);
    assert.equal(rolledBack, true);
    assert.equal(receipt.healthVerdict, "FAIL");
    assert.equal(receipt.rollback?.restoredSha, PREVIOUS_SHA);
    assert.equal(receipt.rollback?.verified, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollback idempotency: rollback receipt carries a stable digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-"));
  try {
    const adapter = new LocalDirectoryDeploymentAdapter(
      join(root, "target"),
      join(root, "health.txt"),
    );
    const first = await adapter.rollback(PREVIOUS_SHA, "preview");
    const second = await adapter.rollback(PREVIOUS_SHA, "preview");
    assert.equal(first.rollbackId, second.rollbackId);
    assert.equal(first.rollbackId, `rollback-${sha256Text(PREVIOUS_SHA).slice(0, 12)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
