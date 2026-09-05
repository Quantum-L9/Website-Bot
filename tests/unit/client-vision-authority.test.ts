// L9_META: layer=test, role=client_vision_authority, status=active, version=1.0.0
//
// WBV2-003 / WBV2-004 / WBV2-019: explicit client intent outranks inferred
// observation, references contribute abstractions only, and no lower authority
// silently overwrites a higher one.
import assert from "node:assert/strict";
import test from "node:test";
import {
  abstractPaletteCharacteristics,
  DesignAuthorityError,
  deriveDesignReferenceIntelligence,
  digestDesignAuthority,
  resolveClientVision,
  resolveDesignDirection,
  resolveDesignReferenceSet,
  resolvePaletteAuthority,
} from "../../src/intelligence/design-authority.js";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";

function spec(overrides: Partial<DomainSpec> = {}): DomainSpec {
  return {
    client_id: "c1",
    business_name: "Acme",
    vertical: "roofing",
    geography: { states: ["NC"], primary_state: "NC" },
    design: { status: "pending" },
    routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    ...overrides,
  } as DomainSpec;
}

/* ---------------- ClientVision (WBV2-003) ------------------------- */

void test("an absent client_vision resolves to an honest undeclared record", () => {
  const vision = resolveClientVision(spec());
  assert.equal(vision.declared, false);
  assert.deepEqual(vision.brand_attributes, []);
  // Undeclared still digests to real provenance — WBV2-009 is satisfied without
  // inventing a vision the client never stated.
  assert.match(digestDesignAuthority(vision), /^[0-9a-f]{64}$/);
});

void test("a declared client_vision is normalized deterministically", () => {
  const vision = resolveClientVision(
    spec({
      client_vision: {
        brand_attributes: ["  Trustworthy ", "Local", "Local"],
        change: ["dated hero"],
      },
    } as Partial<DomainSpec>),
  );
  assert.equal(vision.declared, true);
  assert.deepEqual(vision.brand_attributes, ["Local", "Trustworthy"]);
  assert.equal(
    digestDesignAuthority(vision),
    digestDesignAuthority(
      resolveClientVision(
        spec({
          client_vision: { brand_attributes: ["Local", "Trustworthy"], change: ["dated hero"] },
        } as Partial<DomainSpec>),
      ),
    ),
  );
});

void test("WBV2-018: a declared but empty client_vision fails closed", () => {
  assert.throws(
    () => resolveClientVision(spec({ client_vision: {} } as Partial<DomainSpec>)),
    DesignAuthorityError,
  );
});

void test("WBV2-018: a malformed client_vision fails closed rather than degrading to undeclared", () => {
  assert.throws(
    () =>
      resolveClientVision(
        spec({
          client_vision: { brand_attributes: "trustworthy" },
        } as unknown as Partial<DomainSpec>),
      ),
    /CLIENT_VISION_INVALID/,
  );
  assert.throws(
    () =>
      resolveClientVision(
        spec({ client_vision: { palette: { primary: "not-a-color!" } } } as Partial<DomainSpec>),
      ),
    /CLIENT_VISION_INVALID/,
  );
});

/* ---------------- DesignReference (WBV2-004) ---------------------- */

void test("an accepted reference must justify its selection", () => {
  assert.throws(
    () =>
      resolveDesignReferenceSet(
        spec({ design_references: [{ reference_id: "r1" }] } as Partial<DomainSpec>),
      ),
    /DESIGN_REFERENCE_INVALID.*selection_reason/s,
  );
});

void test("a rejected reference must record why", () => {
  assert.throws(
    () =>
      resolveDesignReferenceSet(
        spec({
          design_references: [{ reference_id: "r1", accepted: false }],
        } as Partial<DomainSpec>),
      ),
    /DESIGN_REFERENCE_INVALID.*rejection_reason/s,
  );
});

void test("WBV2-004: a reference carrying raw expression is rejected at resolution", () => {
  assert.throws(
    () =>
      resolveDesignReferenceSet(
        spec({
          design_references: [
            {
              reference_id: "r1",
              selection_reason: "strong proof layout",
              principles: { layout: [".hero { background: #0b0b0b; }"] },
            },
          ],
        } as Partial<DomainSpec>),
      ),
    /DESIGN_REFERENCE_RAW_TRANSFER/,
  );
});

void test("intelligence abstracts only the accepted references", () => {
  const set = resolveDesignReferenceSet(
    spec({
      design_references: [
        {
          reference_id: "r-accepted",
          selection_reason: "clear proof hierarchy",
          principles: { layout: ["proof above the fold"], negative: ["carousel heroes"] },
          evidence_refs: ["screenshot-1"],
        },
        {
          reference_id: "r-rejected",
          accepted: false,
          rejection_reason: "off-vertical",
          principles: { layout: ["never used"] },
        },
      ],
    } as Partial<DomainSpec>),
  );
  const intelligence = deriveDesignReferenceIntelligence(set);
  assert.equal(intelligence.declared, true);
  assert.deepEqual(intelligence.layout_principles, ["proof above the fold"]);
  assert.deepEqual(intelligence.negative_patterns, ["carousel heroes"]);
  assert.deepEqual(intelligence.evidence_refs, ["screenshot-1"]);
  assert.ok(intelligence.prohibited_transfers.includes("observed_palette_as_theme"));
});

/* ---------------- Priority ladder (WBV2-019) ---------------------- */

void test("WBV2-019: client intent outranks reference and pattern tiers", () => {
  const clientVision = resolveClientVision(
    spec({
      client_vision: {
        explicit_constraints: ["no full-bleed video"],
        visual_preferences: ["editorial spacing"],
        brand_attributes: ["understated"],
      },
    } as Partial<DomainSpec>),
  );
  const direction = resolveDesignDirection({
    clientVision,
    designReferenceIntelligence: deriveDesignReferenceIntelligence(
      resolveDesignReferenceSet(spec()),
    ),
    patternPrinciples: ["dense feature grids"],
    modelPrinciples: ["generic marketing layout"],
    paletteAuthority: { source: "none", tokens: {}, observed_characteristics: [] },
  });
  // Highest tier first, lowest last — ordering IS the authority.
  assert.equal(direction.principles[0], "no full-bleed video");
  assert.equal(direction.principles[1], "editorial spacing");
  assert.equal(direction.principles.at(-1), "generic marketing layout");
  assert.ok(direction.principles.indexOf("dense feature grids") > 1);
});

void test("WBV2-019: a lower authority cannot reintroduce what the client rejected", () => {
  const clientVision = resolveClientVision(
    spec({
      client_vision: { change: ["carousel heroes"], brand_attributes: ["calm"] },
    } as Partial<DomainSpec>),
  );
  const direction = resolveDesignDirection({
    clientVision,
    designReferenceIntelligence: {
      ...deriveDesignReferenceIntelligence(resolveDesignReferenceSet(spec())),
      declared: true,
      // A reference that loves exactly what the client rejected.
      positive_patterns: ["carousel heroes", "calm"],
      layout_principles: ["carousel heroes"],
    },
    patternPrinciples: ["carousel heroes"],
    paletteAuthority: { source: "none", tokens: {}, observed_characteristics: [] },
  });
  assert.ok(direction.rejected_attributes.includes("carousel heroes"));
  assert.ok(
    !direction.desired_attributes.includes("carousel heroes"),
    "a client-rejected attribute must never surface as desired",
  );
  assert.ok(!direction.principles.includes("carousel heroes"));
  assert.ok(direction.desired_attributes.includes("calm"));
});

/* ---------------- Palette authority (WBV2-007) -------------------- */

void test("WBV2-007: with no client and no first-party palette, authority is none", () => {
  const authority = resolvePaletteAuthority({
    spec: spec(),
    clientVision: resolveClientVision(spec()),
    observedCharacteristics: ["dark-dominant"],
  });
  assert.equal(authority.source, "none");
  assert.deepEqual(authority.tokens, {});
  assert.deepEqual(authority.observed_characteristics, ["dark-dominant"]);
});

void test("WBV2-007: explicit client color intent becomes authoritative", () => {
  const domainSpec = spec({
    client_vision: { palette: { primary: "#0b5fff", background: "#ffffff" } },
  } as Partial<DomainSpec>);
  const authority = resolvePaletteAuthority({
    spec: domainSpec,
    clientVision: resolveClientVision(domainSpec),
  });
  assert.equal(authority.source, "client_vision");
  assert.equal(authority.tokens.primary, "#0b5fff");
});

void test("WBV2-019: an explicit first-party design spec outranks client palette intent", () => {
  const domainSpec = spec({
    design: { status: "resolved", palette: { primary: "#111111" } },
    client_vision: { palette: { primary: "#0b5fff" } },
  } as Partial<DomainSpec>);
  const authority = resolvePaletteAuthority({
    spec: domainSpec,
    clientVision: resolveClientVision(domainSpec),
  });
  assert.equal(authority.source, "first_party_design_spec");
  assert.equal(authority.tokens.primary, "#111111");
});

void test("WBV2-007: an observed palette is abstracted, never carried through as values", () => {
  const characteristics = abstractPaletteCharacteristics({
    primary: "#0b5fff",
    secondary: "#333333",
    accent: "#0b5fff",
    background: "#0b0b0b",
    text: "#f5f5f5",
  });
  assert.ok(characteristics.includes("dark-dominant"));
  assert.ok(characteristics.includes("high-contrast"));
  for (const value of characteristics) {
    assert.ok(!/#[0-9a-fA-F]{3,8}/.test(value), `${value} must not carry a color literal`);
  }
});

void test("WBV2-007: a light source site abstracts to light-dominant", () => {
  const characteristics = abstractPaletteCharacteristics({
    background: "#ffffff",
    text: "#111111",
    primary: "#0b5fff",
  });
  assert.ok(characteristics.includes("light-dominant"));
});

void test("an unparseable observed palette abstracts to nothing rather than guessing", () => {
  assert.deepEqual(abstractPaletteCharacteristics(undefined), []);
  assert.deepEqual(abstractPaletteCharacteristics({ background: "not-a-color" }), []);
});
