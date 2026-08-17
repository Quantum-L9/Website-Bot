// L9_META: layer=test, role=build_intent, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LEGACY_BUILD_INTENT,
  isCopyIntent,
  isImproveIntent,
  parseBuildIntent,
} from "../../src/pipeline/BuildIntent.js";

test("missing/empty build_intent resolves to legacy COPY", () => {
  assert.equal(DEFAULT_LEGACY_BUILD_INTENT, "COPY");
  assert.equal(parseBuildIntent(undefined), "COPY");
  assert.equal(parseBuildIntent(null), "COPY");
  assert.equal(parseBuildIntent(""), "COPY");
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
