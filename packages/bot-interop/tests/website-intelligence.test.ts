import assert from "node:assert/strict";
import test from "node:test";
import {
  type ArtifactRef,
  assertIntelligenceArtifactIntegrity,
  assertProvenanceCompleteness,
  type BlueprintProvenance,
  type CompetitiveLandscapeV1,
  FIRST_PARTY_AUTHORITY_SCHEMA,
  type FirstPartyAuthorityRecord,
  refForArtifact,
  sameArtifactRef,
  sameMarketAuthority,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_PROTOCOL,
  WEBSITE_INTELLIGENCE_PROTOCOL_VERSION,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "../src/index.js";

const sha256 = /^[a-f0-9]{64}$/;

function landscape(niche: string): CompetitiveLandscapeV1 {
  return {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape,
    market: { niche, country: "US", language: "en", device: "desktop" },
    query_portfolio: [{ query_id: "q1", query: "scrap metal near me", intent: "local", weight: 1 }],
    observations: [
      {
        observation_id: "o1",
        query_id: "q1",
        rank: 1,
        url: "https://example.com/",
        domain: "example.com",
        observed_at: "2026-08-14T00:00:00.000Z",
        source: "dataforseo",
      },
    ],
    domains: [
      {
        domain: "example.com",
        aggregate_visibility: 1,
        qualifying_query_ids: ["q1"],
        observation_ids: ["o1"],
      },
    ],
    selected_donors: [{ domain: "example.com", aggregate_visibility: 1, observation_ids: ["o1"] }],
    exclusions: [],
    evidence_complete: true,
    ranking_llm_calls: 0,
  };
}

const refA: ArtifactRef = {
  artifact_type: "competitive_landscape",
  artifact_id: `competitive_landscape:${"a".repeat(64)}`,
  payload_digest: "a".repeat(64),
};
const refB: ArtifactRef = {
  artifact_type: "seo_content_blueprint",
  artifact_id: `seo_content_blueprint:${"b".repeat(64)}`,
  payload_digest: "b".repeat(64),
};

function seal(
  payload: CompetitiveLandscapeV1,
  over: Partial<{
    produced_at: string;
    build_id: string;
    version: string;
    input_refs: ArtifactRef[];
  }> = {},
) {
  return sealIntelligenceArtifact({
    artifact_type: "competitive_landscape",
    client_id: "client-1",
    build_id: over.build_id ?? "build-1",
    producer: { repo: "SEO-Bot", version: over.version ?? "2.1.0" },
    produced_at: over.produced_at ?? "2026-08-14T00:00:00.000Z",
    input_refs: over.input_refs ?? [],
    payload,
  });
}

test("sealed artifact is content-addressed and passes integrity verification", () => {
  const artifact = seal(landscape("scrap-metal"));
  assert.equal(artifact.protocol, WEBSITE_INTELLIGENCE_PROTOCOL);
  assert.equal(artifact.protocol_version, WEBSITE_INTELLIGENCE_PROTOCOL_VERSION);
  assert.equal(artifact.integrity.algorithm, "sha256");
  assert.match(artifact.integrity.payload_digest, sha256);
  assert.equal(artifact.artifact_id, `competitive_landscape:${artifact.integrity.payload_digest}`);
  assert.doesNotThrow(() => assertIntelligenceArtifactIntegrity(artifact));
});

test("identity ignores producer timestamp, build id, and producer version", () => {
  const a = seal(landscape("scrap-metal"), {
    produced_at: "2026-01-01T00:00:00.000Z",
    build_id: "b-a",
    version: "2.1.0",
  });
  const b = seal(landscape("scrap-metal"), {
    produced_at: "2030-12-31T23:59:59.000Z",
    build_id: "b-b",
    version: "9.9.9",
  });
  assert.equal(a.integrity.payload_digest, b.integrity.payload_digest);
  assert.equal(a.artifact_id, b.artifact_id);
});

test("different semantic payload produces a different digest", () => {
  const a = seal(landscape("scrap-metal"));
  const b = seal(landscape("demolition"));
  assert.notEqual(a.integrity.payload_digest, b.integrity.payload_digest);
  assert.notEqual(a.artifact_id, b.artifact_id);
});

test("input_refs are order-independent for identity", () => {
  const a = seal(landscape("scrap-metal"), { input_refs: [refA, refB] });
  const b = seal(landscape("scrap-metal"), { input_refs: [refB, refA] });
  assert.equal(a.integrity.payload_digest, b.integrity.payload_digest);
});

test("different input_refs change identity", () => {
  const a = seal(landscape("scrap-metal"), { input_refs: [refA] });
  const b = seal(landscape("scrap-metal"), { input_refs: [refA, refB] });
  assert.notEqual(a.integrity.payload_digest, b.integrity.payload_digest);
});

test("tampered payload fails integrity verification", () => {
  const artifact = seal(landscape("scrap-metal"));
  const tampered = { ...artifact, payload: landscape("tampered") };
  assert.throws(
    () => assertIntelligenceArtifactIntegrity(tampered),
    /INTEL_ARTIFACT_HASH_MISMATCH/,
  );
});

test("tampered artifact_id fails integrity verification", () => {
  const artifact = seal(landscape("scrap-metal"));
  const tampered = { ...artifact, artifact_id: `competitive_landscape:${"f".repeat(64)}` };
  assert.throws(
    () => assertIntelligenceArtifactIntegrity(tampered),
    /INTEL_ARTIFACT_HASH_MISMATCH/,
  );
});

test("unsupported protocol version fails schema verification", () => {
  const artifact = seal(landscape("scrap-metal"));
  const tampered = {
    ...artifact,
    protocol_version: "9.9" as typeof WEBSITE_INTELLIGENCE_PROTOCOL_VERSION,
  };
  assert.throws(
    () => assertIntelligenceArtifactIntegrity(tampered),
    /INTEL_ARTIFACT_SCHEMA_MISMATCH/,
  );
});

function provenance(over: Partial<BlueprintProvenance> = {}): BlueprintProvenance {
  return {
    competitive_landscape_ref: refA,
    baseline_digest: "b".repeat(64),
    client_vision_digest: "c".repeat(64),
    design_reference_intelligence_digest: "d".repeat(64),
    pattern_portfolio_digest: "e".repeat(64),
    ...over,
  };
}

const firstParty: FirstPartyAuthorityRecord = {
  schema: FIRST_PARTY_AUTHORITY_SCHEMA,
  market_research: "not_requested",
  domain_spec_digest: "f".repeat(64),
  donor_count: 0,
};

test("a landscape ref and a first-party record are mutually exclusive", () => {
  assert.doesNotThrow(() => assertProvenanceCompleteness(provenance()));
  const { competitive_landscape_ref: _removed, ...withoutLandscape } = provenance();
  assert.throws(
    () => assertProvenanceCompleteness(withoutLandscape),
    /exactly one of competitive_landscape_ref or first_party_authority/,
  );
  assert.throws(
    () => assertProvenanceCompleteness(provenance({ first_party_authority: firstParty })),
    /exactly one of competitive_landscape_ref or first_party_authority/,
  );
  assert.doesNotThrow(() =>
    assertProvenanceCompleteness({
      ...withoutLandscape,
      first_party_authority: firstParty,
    }),
  );
});

test("a first-party record with donors or a missing digest is incomplete", () => {
  const { competitive_landscape_ref: _removed, ...withoutLandscape } = provenance();
  assert.throws(
    () =>
      assertProvenanceCompleteness({
        ...withoutLandscape,
        first_party_authority: { ...firstParty, donor_count: 1 as 0 },
      }),
    /donor_count=0/,
  );
  assert.throws(
    () =>
      assertProvenanceCompleteness({
        ...withoutLandscape,
        first_party_authority: { ...firstParty, domain_spec_digest: "not-a-digest" },
      }),
    /domain_spec_digest/,
  );
});

test("sameMarketAuthority accepts only the same exclusive form", () => {
  const landscape = provenance();
  const specOnly = provenance();
  delete specOnly.competitive_landscape_ref;
  specOnly.first_party_authority = firstParty;
  assert.equal(sameMarketAuthority(landscape, provenance()), true);
  assert.equal(sameMarketAuthority(specOnly, { ...specOnly }), true);
  assert.equal(sameMarketAuthority(landscape, specOnly), false);
});

test("refForArtifact and sameArtifactRef round-trip", () => {
  const artifact = seal(landscape("scrap-metal"));
  const ref = refForArtifact(artifact);
  assert.equal(ref.artifact_type, "competitive_landscape");
  assert.equal(ref.artifact_id, artifact.artifact_id);
  assert.equal(ref.payload_digest, artifact.integrity.payload_digest);
  assert.ok(sameArtifactRef(ref, refForArtifact(artifact)));
  assert.ok(!sameArtifactRef(ref, refA));
});
