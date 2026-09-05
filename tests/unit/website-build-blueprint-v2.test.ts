// L9_META: layer=test, role=blueprint_v2_contract, status=active, version=1.0.0
//
// WebsiteBuildBlueprintV2 contract law (ADR-0018). These are the negative tests
// that make the migration irreversible: a V1 artifact, a V1 schema URI, a
// leaked palette, a raw-expression transfer, or an SEO-Bot-produced blueprint
// must all be rejected, not tolerated.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoRawExpressionTransfer,
  assertPaletteNonAuthority,
  assertProvenanceCompleteness,
  assertWebsiteBuildBlueprintProducer,
  assertWebsiteBuildBlueprintV2,
  type PaletteAuthority,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";
import { makeLandscape, makeWebsiteBlueprint } from "./redesign-fixtures.js";

const landscape = makeLandscape();

function reseal(
  mutate: (payload: Record<string, unknown>) => void,
  producer: "Website-Bot" | "SEO-Bot" = "Website-Bot",
): WebsiteBuildBlueprintArtifact {
  const base = makeWebsiteBlueprint(landscape);
  const payload = JSON.parse(JSON.stringify(base.payload)) as Record<string, unknown>;
  mutate(payload);
  return sealIntelligenceArtifact({
    artifact_type: "website_build_blueprint",
    client_id: base.client_id,
    build_id: base.build_id,
    producer: { repo: producer, version: "3.1.0" },
    produced_at: base.produced_at,
    input_refs: base.input_refs,
    payload,
  }) as unknown as WebsiteBuildBlueprintArtifact;
}

void test("WBV2-001: the only active blueprint schema is v2", () => {
  assert.equal(
    WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    "l9://website-intelligence/website-build-blueprint/v2",
  );
});

void test("WBV2-001: a well-formed V2 blueprint passes the contract gate", () => {
  assert.doesNotThrow(() => assertWebsiteBuildBlueprintV2(makeWebsiteBlueprint(landscape)));
});

void test("WBV2-001: the retired V1 schema URI is rejected outright", () => {
  const v1 = reseal((payload) => {
    payload.schema = "l9://website-intelligence/website-build-blueprint/v1";
  });
  assert.throws(
    () => assertWebsiteBuildBlueprintV2(v1),
    /BLUEPRINT_SCHEMA_REJECTED.*website-build-blueprint\/v1/s,
  );
});

void test("WBV2-015: a V1-shaped artifact has no fallback path — it fails, it is not upgraded", () => {
  // Exactly the V1 payload shape: flat provenance, no design_direction.
  const v1Shaped = reseal((payload) => {
    payload.schema = "l9://website-intelligence/website-build-blueprint/v1";
    const provenance = payload.provenance as Record<string, unknown>;
    payload.competitive_landscape_ref = provenance.competitive_landscape_ref;
    payload.baseline_digest = provenance.baseline_digest;
    payload.pattern_portfolio_digest = provenance.pattern_portfolio_digest;
    delete payload.provenance;
    delete payload.design_direction;
  });
  assert.throws(() => assertWebsiteBuildBlueprintV2(v1Shaped), /BLUEPRINT_SCHEMA_REJECTED/);
});

void test("WBV2-002: an SEO-Bot-produced blueprint is rejected", () => {
  const foreign = reseal(() => {}, "SEO-Bot");
  assert.throws(
    () => assertWebsiteBuildBlueprintProducer(foreign),
    /BLUEPRINT_PRODUCER_FORBIDDEN.*SEO-Bot/s,
  );
  assert.throws(() => assertWebsiteBuildBlueprintV2(foreign), /BLUEPRINT_PRODUCER_FORBIDDEN/);
});

void test("WBV2-009: every provenance digest is required", () => {
  for (const field of [
    "baseline_digest",
    "client_vision_digest",
    "design_reference_intelligence_digest",
    "pattern_portfolio_digest",
  ]) {
    const missing = reseal((payload) => {
      delete (payload.provenance as Record<string, unknown>)[field];
    });
    assert.throws(
      () => assertWebsiteBuildBlueprintV2(missing),
      new RegExp(`BLUEPRINT_PROVENANCE_INCOMPLETE.*${field}`, "s"),
      `${field} must be required`,
    );
  }
});

void test("WBV2-009: a placeholder digest is not provenance", () => {
  const placeholder = reseal((payload) => {
    (payload.provenance as Record<string, unknown>).client_vision_digest = "unknown";
  });
  assert.throws(
    () => assertWebsiteBuildBlueprintV2(placeholder),
    /BLUEPRINT_PROVENANCE_INCOMPLETE/,
  );
});

void test("WBV2-009: a missing provenance block fails closed", () => {
  const stripped = reseal((payload) => {
    delete payload.provenance;
  });
  assert.throws(() => assertWebsiteBuildBlueprintV2(stripped), /BLUEPRINT_PROVENANCE_INCOMPLETE/);
});

void test("WBV2-009: a complete provenance block passes", () => {
  assert.doesNotThrow(() =>
    assertProvenanceCompleteness(makeWebsiteBlueprint(landscape).payload.provenance),
  );
});

/* ---------------- palette non-authority (WBV2-007) ---------------- */

void test("WBV2-007: an unsourced palette authority may carry no tokens", () => {
  const leaked: PaletteAuthority = {
    source: "none",
    // A source-site primary that has been smuggled in as an authoritative token.
    tokens: { primary: "#0b5fff" },
    observed_characteristics: [],
  };
  assert.throws(() => assertPaletteNonAuthority(leaked), /PALETTE_AUTHORITY_LEAK/);
});

void test("WBV2-007: an observed characteristic may never be a concrete color", () => {
  for (const value of ["#0b0b0b", "rgb(11, 11, 11)", "hsl(210 100% 50%)"]) {
    assert.throws(
      () =>
        assertPaletteNonAuthority({
          source: "none",
          tokens: {},
          observed_characteristics: [value],
        }),
      /PALETTE_AUTHORITY_LEAK/,
      `${value} must not survive as an observed characteristic`,
    );
  }
});

void test("WBV2-007: abstract characteristics are allowed", () => {
  assert.doesNotThrow(() =>
    assertPaletteNonAuthority({
      source: "none",
      tokens: {},
      observed_characteristics: ["dark-dominant", "high-contrast", "restrained-accent"],
    }),
  );
});

void test("WBV2-007: a declared authority must actually carry tokens", () => {
  assert.throws(
    () =>
      assertPaletteNonAuthority({
        source: "client_vision",
        tokens: {},
        observed_characteristics: [],
      }),
    /PALETTE_AUTHORITY_EMPTY/,
  );
});

void test("WBV2-007: a sealed blueprint claiming no authority but carrying tokens is rejected", () => {
  const leaked = reseal((payload) => {
    const direction = payload.design_direction as Record<string, unknown>;
    direction.palette_authority = {
      source: "none",
      tokens: { primary: "#123456" },
      observed_characteristics: [],
    };
  });
  assert.throws(() => assertWebsiteBuildBlueprintV2(leaked), /PALETTE_AUTHORITY_LEAK/);
});

/* ---------------- raw expression transfer (WBV2-004) -------------- */

void test("WBV2-004: raw markup, CSS and colors never transfer as principles", () => {
  const forbidden = [
    ['<section class="hero">', "markup"],
    [".hero { background: #0b0b0b; }", "a CSS block"],
    ["background-color: navy", "a CSS declaration"],
    ["url(https://donor.example.com/hero.jpg)", "an embedded asset reference"],
    ["primary #0b5fff", "a concrete color value"],
    ["data:image/png;base64,AAAA", "an embedded asset reference"],
  ] as const;
  for (const [value] of forbidden) {
    assert.throws(
      () => assertNoRawExpressionTransfer([value], "design_direction.principles"),
      /DESIGN_REFERENCE_RAW_TRANSFER/,
      `${value} must be rejected`,
    );
  }
});

void test("WBV2-004: abstract principles pass unharmed", () => {
  assert.doesNotThrow(() =>
    assertNoRawExpressionTransfer(
      [
        "generous whitespace between proof blocks",
        "single primary call to action above the fold",
        "dark-dominant, high-contrast typography",
        "progressive disclosure for long service lists",
      ],
      "design_direction.principles",
    ),
  );
});

void test("WBV2-004: a blueprint carrying raw expression in design direction is rejected", () => {
  const raw = reseal((payload) => {
    const direction = payload.design_direction as Record<string, unknown>;
    direction.principles = ['<div class="hero">copy the donor hero</div>'];
  });
  assert.throws(() => assertWebsiteBuildBlueprintV2(raw), /DESIGN_REFERENCE_RAW_TRANSFER/);
});
