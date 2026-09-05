// L9_META: layer=test, role=build_intent, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  DEFAULT_LEGACY_BUILD_INTENT,
  isCopyIntent,
  isImproveIntent,
  parseBuildIntent,
  requireBuildIntent,
  requireRedesignIntent,
} from "../../src/pipeline/BuildIntent.js";
import {
  buildRedesignRunSpec,
  redesignDeployTargetFromEnv,
} from "../../src/recursive/redesign-spec.js";

test("missing/empty build_intent resolves to legacy COPY only on the explicit legacy parser", () => {
  assert.equal(DEFAULT_LEGACY_BUILD_INTENT, "COPY");
  assert.equal(parseBuildIntent(undefined), "COPY");
  assert.equal(parseBuildIntent(null), "COPY");
  assert.equal(parseBuildIntent(""), "COPY");
});

test("redesign surfaces fail closed on missing intent (BUILD_INTENT_REQUIRED)", () => {
  for (const missing of [undefined, null, ""]) {
    assert.throws(
      () => requireBuildIntent(missing, "test-surface"),
      (error: unknown) => error instanceof BuildError && error.code === "BUILD_INTENT_REQUIRED",
    );
  }
});

test("requireBuildIntent accepts explicit intents and rejects unknown values", () => {
  assert.equal(requireBuildIntent("REDESIGN_IMPROVE", "test-surface"), "REDESIGN_IMPROVE");
  assert.equal(requireBuildIntent("COPY", "test-surface"), "COPY");
  assert.throws(() => requireBuildIntent("IMPROVE", "test-surface"), /INVALID_BUILD_INTENT/);
});

test("requireRedesignIntent rejects both missing intent and explicit COPY", () => {
  assert.equal(requireRedesignIntent("REDESIGN_IMPROVE", "test-surface"), "REDESIGN_IMPROVE");
  for (const bad of [undefined, "COPY"]) {
    assert.throws(
      () => requireRedesignIntent(bad, "test-surface"),
      (error: unknown) => error instanceof BuildError && error.code === "BUILD_INTENT_REQUIRED",
    );
  }
});

test("recursive:improve run spec binds REDESIGN_IMPROVE even when the fixture has no intent", () => {
  const fixtureWithoutIntent = [
    "client_id: fixture-client",
    "business_name: Fixture Co",
    "vertical: example",
    "routes: []",
    "seo_contract:",
    "  site_url: fixture.example.com",
  ].join("\n");
  const spec = buildRedesignRunSpec({
    fixtureYaml: fixtureWithoutIntent,
    sourceUrl: "https://www.example.com",
    clientId: "recursive-client",
  });
  assert.equal(spec.build_intent, "REDESIGN_IMPROVE");
  assert.equal((spec.seo_contract as Record<string, unknown>).site_url, "www.example.com");
  const sourceSite = (spec.assets as Record<string, Record<string, unknown>>).sourceSite;
  assert.equal(sourceSite.enabled, true);
  assert.equal(sourceSite.url, "https://www.example.com");
});

test("redesign deploy target from env is all-or-nothing (fail-closed)", () => {
  assert.equal(redesignDeployTargetFromEnv({}), undefined);
  assert.throws(
    () => redesignDeployTargetFromEnv({ REDESIGN_DEPLOY_GITHUB_REPO: "owner/repo" }),
    /must all be set together/,
  );
  const target = redesignDeployTargetFromEnv({
    REDESIGN_DEPLOY_GITHUB_REPO: "owner/repo",
    REDESIGN_DEPLOY_GITHUB_REPO_ID: "123",
    REDESIGN_DEPLOY_VERCEL_PROJECT_ID: "prj_abc",
    REDESIGN_DEPLOY_SOURCE_BRANCH: "seam-branch",
  });
  assert.deepEqual(target, {
    githubRepo: "owner/repo",
    githubRepoId: "123",
    vercelProjectId: "prj_abc",
    sourceBranch: "seam-branch",
  });
  const spec = buildRedesignRunSpec({
    fixtureYaml: ["client_id: fixture-client", "seo_contract:", "  site_url: f.example.com"].join(
      "\n",
    ),
    sourceUrl: "https://www.example.com",
    clientId: "recursive-client",
    deploy: target,
  });
  assert.deepEqual(spec.deploy, {
    github_repo: "owner/repo",
    github_repo_id: "123",
    source_branch: "seam-branch",
    vercel_project_id: "prj_abc",
  });
});

test("explicit intents parse to themselves", () => {
  assert.equal(parseBuildIntent("COPY"), "COPY");
  assert.equal(parseBuildIntent("REDESIGN_IMPROVE"), "REDESIGN_IMPROVE");
});

test("unknown intent fails closed", () => {
  assert.throws(() => parseBuildIntent("IMPROVE"), /INVALID_BUILD_INTENT/);
  assert.throws(() => parseBuildIntent(42), /INVALID_BUILD_INTENT/);
});

test("intent guards narrow correctly", () => {
  assert.ok(isCopyIntent("COPY"));
  assert.ok(!isCopyIntent("REDESIGN_IMPROVE"));
  assert.ok(isImproveIntent("REDESIGN_IMPROVE"));
  assert.ok(!isImproveIntent("COPY"));
});
