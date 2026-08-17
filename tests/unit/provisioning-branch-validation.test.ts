// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import { buildProvisioningRequest } from "../../src/provisioning/request.js";

function specWithBranch(sourceBranch: string) {
  return {
    client_id: "acme",
    business_name: "Acme",
    provision: {
      enabled: true,
      github: { owner: "Quantum-L9", source_branch: sourceBranch },
      vercel: { project: "acme-site" },
    },
  };
}

const options = { planOnly: true };

function branchError(sourceBranch: string): string | null {
  try {
    buildProvisioningRequest(specWithBranch(sourceBranch), "input.yaml", options);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

void test("accepts valid source branches", () => {
  for (const branch of ["main", "release/v1.0", "feature-1", "dev.2"]) {
    assert.equal(
      branchError(branch),
      null,
      `valid branch ${branch} should be accepted`,
    );
  }
});

void test("rejects invalid source branches with the same conditions as the old regex", () => {
  // Old: /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,255}$/
  // (empty string is not listed: the wrapper's `|| "main"` fallback
  // normalizes it before validation — unchanged pre-existing behavior)
  for (const branch of [
    "/leading-slash",
    "trailing..dots",
    "double//slash",
    "mid..dots",
    "has space",
    "star*glob",
    "a".repeat(256),
  ]) {
    assert.equal(
      branchError(branch),
      "provision.github.source_branch is invalid",
      `invalid branch ${JSON.stringify(branch.slice(0, 20))} should be rejected`,
    );
  }
});

void test("boundary: 255-char branch is accepted, 256 rejected", () => {
  const max = "a".repeat(255);
  assert.equal(branchError(max), null, "255-char branch should be accepted");
  assert.notEqual(branchError(`${max}b`), null, "256-char branch should be rejected");
});
