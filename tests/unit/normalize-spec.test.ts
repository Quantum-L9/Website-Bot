// L9_META: layer=test, role=unit, status=active, version=1.0.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { buildFlatSpec } from "../../scripts/normalize-spec.js";

/** Minimal rich authoring spec; overrides target the block under test. */
function rich(overrides: Record<string, unknown> = {}) {
  return {
    domain_spec: {
      metadata: { spec_id: "test-client" },
      identity: { business_name: "Test Co", canonical_url: "https://test.example.com" },
      market: { niche: "ai_consulting" },
      geography: { primary_regions: ["US"] },
      content: {
        required_pages: [{ path: "/", template: "homepage" }],
        page_templates: [{ template_name: "homepage", required_sections: ["hero"] }],
      },
      seo: {
        primary_keyword_cluster: {
          cluster_name: "test",
          target_page: "/",
          intent: "service_provider",
          keywords: ["ai consulting"],
        },
        secondary_keyword_clusters: [],
        metadata_rules: { title_pattern: "T", description_pattern: "D" },
        schema_rules: ["Organization"],
        internal_linking_rules: { hub_pages: ["/"], spoke_pages: [], prohibited_links: [] },
      },
      design: {
        design_status: "placeholder",
        brand_tokens: { colors: "{{COLOR_TOKENS_PLACEHOLDER}}", typography: "{{TYPOGRAPHY_PLACEHOLDER}}" },
      },
      ...overrides,
    },
  };
}

test("carries build_intent from the rich spec and rejects unknown values", () => {
  const flat = buildFlatSpec(rich({ build_intent: "REDESIGN_IMPROVE" }));
  assert.equal(flat.build_intent, "REDESIGN_IMPROVE");

  // Legacy specs that declare nothing keep the COPY default (no field emitted).
  assert.equal(buildFlatSpec(rich({})).build_intent, undefined);

  assert.throws(() => buildFlatSpec(rich({ build_intent: "UPGRADE" })), /build_intent must be/);
});

test("carries client_vision verbatim into the flat spec", () => {
  const flat = buildFlatSpec(
    rich({ client_vision: { brand_attributes: ["calm"], palette: { primary: "#112233" } } }),
  );
  assert.deepEqual(flat.client_vision?.brand_attributes, ["calm"]);
  assert.deepEqual(flat.client_vision?.palette, { primary: "#112233" });
  assert.throws(() => buildFlatSpec(rich({ client_vision: "not-an-object" })), /client_vision must be an object/);
});

test("carries design_references verbatim into the flat spec", () => {
  const references = [{ reference_id: "linear", accepted: false, rejection_reason: "too generic" }];
  const flat = buildFlatSpec(rich({ design_references: references }));
  assert.deepEqual(flat.design_references, references);
  assert.throws(() => buildFlatSpec(rich({ design_references: {} })), /design_references must be an array/);
});

test("structured brand tokens become resolved first-party design", () => {
  const flat = buildFlatSpec(
    rich({
      design: {
        design_status: "resolved",
        brand_tokens: {
          colors: { primary: "#0B0F17", accent: "#22D3EE" },
          typography: { heading: "Space Grotesk", body: "Inter" },
        },
      },
    }),
  );
  assert.equal(flat.design.status, "resolved");
  assert.deepEqual(flat.design.palette, { primary: "#0B0F17", accent: "#22D3EE" });
  assert.deepEqual(flat.design.fonts, { font_heading: "Space Grotesk", font_body: "Inter" });
});

test("placeholder brand tokens keep the legacy pending path", () => {
  const flat = buildFlatSpec(rich({}));
  assert.equal(flat.design.status, "pending");
  assert.equal(flat.design.palette, undefined);
  assert.equal(flat.design.fonts, undefined);
});

test("reference client flat spec remains byte-stable (no regression)", () => {
  const source = parse(
    readFileSync("examples/supplemental-insurance-pros/domain_spec.source.yaml", "utf-8"),
  );
  const committed = parse(
    readFileSync("examples/supplemental-insurance-pros/domain_spec.normalized.yaml", "utf-8"),
  );
  assert.deepEqual(buildFlatSpec(source), committed);
});
