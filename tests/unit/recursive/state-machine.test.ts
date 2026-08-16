// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  createCampaignManifest,
  isLegalWave,
  validateCampaignManifest,
} from "../../../src/recursive/state/run-manifest.js";
import { applyTransition, isTerminal } from "../../../src/recursive/state/transitions.js";

function fixture() {
  return createCampaignManifest({
    campaignId: "sm-test-run",
    sourceUrl: "https://sm-test.example.com",
    websiteBotFullSha: "a".repeat(40),
    seoBotFullSha: "b".repeat(40),
    llmRouterVersion: "1.1.2",
    botInteropVersion: "1.1.0",
    controlPlaneFullSha: "c".repeat(40),
    now: "2026-08-15T00:00:00.000Z",
  });
}

function driveWave(manifest: ReturnType<typeof fixture>): void {
  const ok = (applied: boolean, reason?: string) =>
    assert.equal(applied, true, reason ?? "transition refused");
  ok(
    applyTransition(manifest, {
      kind: "E2E_COMPLETED",
      reviewable: false,
      e2eReceiptRef: "e2e-1",
      deployedSha: "a".repeat(40),
    }).applied,
  );
  ok(
    applyTransition(manifest, {
      kind: "HARVEST_COMPLETED",
      harvestRef: "harvest-1",
      materialActionableSignal: true,
    }).applied,
  );
  ok(
    applyTransition(manifest, { kind: "PE_PACK_COMPILED", pePackRef: "pack-1", clusterId: "EC-1" })
      .applied,
  );
  ok(applyTransition(manifest, { kind: "PATCH_APPLIED", codeChangeRef: "patch-1" }).applied);
  ok(applyTransition(manifest, { kind: "VERIFICATION_PASSED" }).applied);
  ok(applyTransition(manifest, { kind: "MERGED", promotionRef: "merge-1" }).applied);
  ok(applyTransition(manifest, { kind: "DEPLOYED", deployedSha: "d".repeat(40) }).applied);
  const completed = applyTransition(manifest, { kind: "WAVE_COMPLETED" });
  assert.equal(completed.applied, true);
}

test("wave four is unrepresentable: after wave three the run reaches WAVE_LIMIT_REACHED", () => {
  const manifest = fixture();
  driveWave(manifest);
  assert.equal(manifest.state.currentWave, 2);
  driveWave(manifest);
  assert.equal(manifest.state.currentWave, 3);
  driveWave(manifest);
  assert.equal(manifest.state.status, "WAVE_LIMIT_REACHED");
  assert.equal(isTerminal(manifest), true);
  assert.equal(isLegalWave(4), false);
  // Any further action on a terminal run is hard rejected.
  const rejected = applyTransition(manifest, { kind: "WAVE_COMPLETED" });
  assert.equal(rejected.applied, false);
  assert.match(rejected.reason ?? "", /terminal/);
});

test("illegal transitions are rejected without mutating state", () => {
  const manifest = fixture();
  const before = JSON.stringify(manifest.state);
  const rejected = applyTransition(manifest, { kind: "MERGED", promotionRef: "x" });
  assert.equal(rejected.applied, false);
  assert.equal(JSON.stringify(manifest.state), before);
});

test("reviewable E2E with no material signal stops the run early", () => {
  const manifest = fixture();
  assert.equal(
    applyTransition(manifest, {
      kind: "E2E_COMPLETED",
      reviewable: true,
      e2eReceiptRef: "e2e-1",
      deployedSha: "a".repeat(40),
    }).applied,
    true,
  );
  const result = applyTransition(manifest, {
    kind: "HARVEST_COMPLETED",
    harvestRef: "h",
    materialActionableSignal: false,
  });
  assert.equal(result.applied, true);
  assert.equal(result.status, "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL");
  assert.equal(isTerminal(manifest), true);
});

test("non-reviewable E2E with no material signal stops as NO_ACTIONABLE_SIGNAL", () => {
  const manifest = fixture();
  applyTransition(manifest, {
    kind: "E2E_COMPLETED",
    reviewable: false,
    e2eReceiptRef: "e2e-1",
    deployedSha: "a".repeat(40),
  });
  const result = applyTransition(manifest, {
    kind: "HARVEST_COMPLETED",
    harvestRef: "h",
    materialActionableSignal: false,
  });
  assert.equal(result.status, "NO_ACTIONABLE_SIGNAL");
});

test("control-plane signal stops and escalates from any active phase", () => {
  const manifest = fixture();
  applyTransition(manifest, {
    kind: "E2E_COMPLETED",
    reviewable: false,
    e2eReceiptRef: "e2e-1",
    deployedSha: "a".repeat(40),
  });
  const result = applyTransition(manifest, { kind: "CONTROL_PLANE_CHANGE_REQUIRED" });
  assert.equal(result.applied, true);
  assert.equal(result.status, "CONTROL_PLANE_CHANGE_REQUIRED");
});

test("patch validation failure and deployment failure are terminal", () => {
  const patchFail = fixture();
  applyTransition(patchFail, {
    kind: "E2E_COMPLETED",
    reviewable: false,
    e2eReceiptRef: "e",
    deployedSha: "a".repeat(40),
  });
  applyTransition(patchFail, {
    kind: "HARVEST_COMPLETED",
    harvestRef: "h",
    materialActionableSignal: true,
  });
  applyTransition(patchFail, { kind: "PE_PACK_COMPILED", pePackRef: "p", clusterId: "EC-1" });
  applyTransition(patchFail, { kind: "PATCH_APPLIED", codeChangeRef: "c" });
  const failed = applyTransition(patchFail, { kind: "VERIFICATION_FAILED" });
  assert.equal(failed.status, "PATCH_VALIDATION_FAILED");

  const deployFail = fixture();
  applyTransition(deployFail, {
    kind: "E2E_COMPLETED",
    reviewable: false,
    e2eReceiptRef: "e",
    deployedSha: "a".repeat(40),
  });
  applyTransition(deployFail, {
    kind: "HARVEST_COMPLETED",
    harvestRef: "h",
    materialActionableSignal: true,
  });
  applyTransition(deployFail, { kind: "PE_PACK_COMPILED", pePackRef: "p", clusterId: "EC-1" });
  applyTransition(deployFail, { kind: "PATCH_APPLIED", codeChangeRef: "c" });
  applyTransition(deployFail, { kind: "VERIFICATION_PASSED" });
  applyTransition(deployFail, { kind: "MERGED", promotionRef: "m" });
  applyTransition(deployFail, { kind: "DEPLOYED", deployedSha: "d".repeat(40) });
  const deploymentFailed = applyTransition(deployFail, { kind: "DEPLOYMENT_VERIFICATION_FAILED" });
  assert.equal(deploymentFailed.status, "DEPLOYMENT_FAILED");
});

test("scope-insufficient verdict is terminal without broadening", () => {
  const manifest = fixture();
  applyTransition(manifest, {
    kind: "E2E_COMPLETED",
    reviewable: false,
    e2eReceiptRef: "e",
    deployedSha: "a".repeat(40),
  });
  applyTransition(manifest, {
    kind: "HARVEST_COMPLETED",
    harvestRef: "h",
    materialActionableSignal: true,
  });
  applyTransition(manifest, { kind: "PE_PACK_COMPILED", pePackRef: "p", clusterId: "EC-1" });
  applyTransition(manifest, { kind: "PATCH_APPLIED", codeChangeRef: "c" });
  const result = applyTransition(manifest, { kind: "SCOPE_INSUFFICIENT" });
  assert.equal(result.status, "PATCH_VALIDATION_FAILED");
  // No transition can resurrect the run.
  const again = applyTransition(manifest, { kind: "WAVE_COMPLETED" });
  assert.equal(again.applied, false);
});

test("manifest validation rejects manifests with a fourth wave or wrong limits", () => {
  const valid = fixture();
  // Wave limits are constants; tampering is caught by the validator.
  const tampered = JSON.parse(JSON.stringify(valid)) as ReturnType<typeof fixture>;
  tampered.limits.hardMaxWaves = 4 as never;
  assert.throws(() => validateCampaignManifest(tampered), /three/);
});
