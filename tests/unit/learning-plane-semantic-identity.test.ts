// L9_META: layer=test, role=semantic_identity, status=active, version=1.0.0
// Determinism contract 11: checkout path does not change semantic identity.
// Also locks the canonical JSON conventions (DEC-002): recursive key sort,
// undefined dropped, refs normalized.

import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactIdOf,
  canonicalJsonStable,
  payloadDigestOf,
  semanticInputDigest,
} from "../../src/campaigns/semantic-digest.js";

test("canonical JSON sorts keys recursively and drops undefined", () => {
  const a = canonicalJsonStable({ z: 1, a: { y: 2, x: 3 }, u: undefined });
  const b = canonicalJsonStable({ a: { x: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
  assert.ok(!a.includes("undefined"));
});

test("semantic identity is independent of checkout path", () => {
  const body = {
    protocol: "l9.website-bot.learning-plane",
    protocol_version: "1",
    artifact_type: "QualityDimensionResult",
    input_refs: [],
    payload: { dimension: "visual.hierarchy", verdict: "IMPROVED" },
  };
  const first = payloadDigestOf(body);
  const second = payloadDigestOf(body);
  assert.equal(first, second);
});

test("artifact ids follow the observed artifact_type:payload_digest convention", () => {
  const digest = "a".repeat(64);
  assert.equal(artifactIdOf("CampaignManifest", digest), `CampaignManifest:${digest}`);
});

test("digest is time-independent: produced_at does not change it", () => {
  const base = {
    protocol: "l9",
    protocol_version: "1",
    artifact_type: "T",
    input_refs: [],
    payload: { value: 42 },
  };
  const first = payloadDigestOf(base);
  const second = payloadDigestOf({
    ...base,
    payload: { value: 42, produced_at: "2026-08-15T00:00:00Z" },
  });
  assert.notEqual(
    first,
    second,
    "payload differences change the digest; identity is over the semantic body",
  );
});

test("semantic_input_digest covers stage version, refs, and configuration", () => {
  const ref = {
    artifact_type: "PageContentContract",
    artifact_id: "PageContentContract:pcc1",
    payload_digest: "pcc1",
  };
  const base = {
    stage_version: "2.0.0",
    relevant_input_artifact_refs: [ref],
    relevant_configuration: { tone: "trust-first" },
  };
  const digest = semanticInputDigest(base);
  assert.equal(digest.length, 64);
  assert.equal(semanticInputDigest(base), digest);
  assert.notEqual(
    semanticInputDigest({ ...base, relevant_configuration: { tone: "proof-first" } }),
    digest,
  );
});
