// L9_META: layer=test, role=build_id_uniqueness, status=active, version=1.0.0
//
// makeBuildId must not collide when builds start in the same millisecond
// (parallel tests, a fan-out run). The id keeps its `<clientId>-<epoch ms>`
// prefix and stays a safe path segment: it names on-disk build directories
// (clientAssetRoot, the assembler's backup root via safePathSegment).

import assert from "node:assert/strict";
import test from "node:test";
import { makeBuildId } from "../../src/pipeline/BuildContext.js";
import { safePathSegment } from "../../src/validation/validate-generated-site.js";

test("ids created in the same millisecond are unique", (t) => {
  t.mock.method(Date, "now", () => 1_795_000_000_000);
  const ids = Array.from({ length: 1_000 }, () => makeBuildId("acme-roofing"));
  assert.equal(new Set(ids).size, ids.length);
});

test("the id keeps the clientId and timestamp prefix and is a safe path segment", (t) => {
  t.mock.method(Date, "now", () => 1_795_000_000_123);
  const id = makeBuildId("acme-roofing");
  assert.ok(id.startsWith("acme-roofing-1795000000123-"), id);
  assert.match(id, /^acme-roofing-1795000000123-[0-9a-f]{8}$/);
  assert.equal(safePathSegment(id, "buildId"), id);
});

test("a long client id still yields a safe path segment of at most 128 characters", (t) => {
  t.mock.method(Date, "now", () => 1_795_000_000_123);
  for (const length of [105, 106, 114, 115, 127]) {
    const clientId = `c${"x".repeat(length - 1)}`;
    const id = makeBuildId(clientId);
    assert.ok(id.length <= 128, `${length}: ${id.length}`);
    assert.equal(safePathSegment(id, "buildId"), id);
    assert.match(id, /-1795000000123-[0-9a-f]{8}$/);
    assert.ok(id.startsWith(clientId.slice(0, 100)), "keeps the client id prefix");
  }
});
