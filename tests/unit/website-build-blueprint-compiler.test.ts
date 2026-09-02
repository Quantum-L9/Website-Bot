// L9_META: layer=test, role=blueprint_v2_compiler, status=active, version=1.0.0
//
// The dedicated compiler owns blueprint compilation and its gate (ADR-0018 §9).
// These tests prove the V1 guarantees survived the move and that the new
// cross-plane checks fail closed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  compileWebsiteBuildBlueprint,
  type CompileWebsiteBuildBlueprintInput,
  deriveVisualRequirements,
  digestOf,
  ensureCanonicalSlotCoverage,
  type PatternPortfolio,
} from "../../src/intelligence/WebsiteBuildBlueprintCompiler.js";
import {
  deriveDesignReferenceIntelligence,
  resolveClientVision,
  resolveDesignReferenceSet,
  resolvePaletteAuthority,
} from "../../src/intelligence/design-authority.js";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";
import { makeLandscape } from "./redesign-fixtures.js";

const landscape = makeLandscape();

const portfolio: PatternPortfolio = {
  patterns: [
    {
      pattern_id: "p-1",
      evidence: "donors lead with a single primary action",
      invariant: "one primary call to action above the fold",
      disposition: "PORT",
      beneficiary_destination: "home hero",
      risk: "low",
      acceptance_test: "home hero exposes exactly one primary CTA",
      donor_frequency: 8,
    },
    {
      pattern_id: "p-2",
      evidence: "donors bury pricing",
      invariant: "avoid hiding cost signals",
      disposition: "REJECT",
      beneficiary_destination: "none",
      risk: "n/a",
      acceptance_test: "",
      donor_frequency: 2,
    },
  ],
};

function spec(overrides: Partial<DomainSpec> = {}): DomainSpec {
  return {
    client_id: "c1",
    business_name: "Acme Roofing",
    vertical: "roofing",
    geography: { states: ["NC"], primary_state: "NC" },
    design: { status: "pending" },
    routes: [
      { slug: "/", title: "Home", components: ["hero", "services"] },
      { slug: "/about/", title: "About", components: ["story"] },
    ],
    ...overrides,
  } as DomainSpec;
}

function inputFor(overrides: Partial<CompileWebsiteBuildBlueprintInput> = {}) {
  const domainSpec = (overrides as { __spec?: DomainSpec }).__spec ?? spec();
  const clientVision = resolveClientVision(domainSpec);
  const referenceSet = resolveDesignReferenceSet(domainSpec);
  const intelligence = deriveDesignReferenceIntelligence(referenceSet);
  const base: CompileWebsiteBuildBlueprintInput = {
    clientId: "c1",
    buildId: "b1",
    producerVersion: "3.1.0",
    specRoutes: domainSpec.routes.map((route) => ({
      route_id: route.slug,
      path: route.slug,
      purpose: route.title,
      spec_components: route.components,
    })),
    baseline: domainSpec.routes,
    landscape,
    patternPortfolio: portfolio,
    clientVision,
    designReferenceIntelligence: intelligence,
    paletteAuthority: resolvePaletteAuthority({ spec: domainSpec, clientVision }),
    model: {
      strategy: { experience_attributes: ["fast"], differentiation: ["same-day"] },
      content_guardrails: { forbidden_claims: ["licensed"] },
      conversion: { primary_action: "Request a quote", secondary_actions: ["Call"] },
      routes: [
        {
          route_id: "/",
          sections: [
            {
              section_id: "hero",
              component_class: "hero",
              objective: "convert",
              content_slots: ["primary_offer"],
              pattern_refs: ["p-1"],
              proof_requirements: [],
            },
          ],
        },
      ],
      acceptance_tests: ["home converts"],
      design_principles: ["generous whitespace"],
    },
    produced_at: undefined,
  } as CompileWebsiteBuildBlueprintInput;
  return { ...base, ...overrides };
}

void test("compiles and seals a gated V2 blueprint", () => {
  const blueprint = compileWebsiteBuildBlueprint(inputFor());
  assert.equal(blueprint.payload.schema, "l9://website-intelligence/website-build-blueprint/v2");
  assert.equal(blueprint.producer.repo, "Website-Bot");
  assert.equal(blueprint.artifact_id, `website_build_blueprint:${blueprint.integrity.payload_digest}`);
});

void test("WBV2-021: route identity comes from the spec, never the model", () => {
  const blueprint = compileWebsiteBuildBlueprint(
    inputFor({
      model: {
        ...inputFor().model,
        // The model invents a route that is not in the spec.
        routes: [
          { route_id: "/", sections: [] },
          { route_id: "/invented/", sections: [] },
        ],
      },
    }),
  );
  assert.deepEqual(
    blueprint.payload.routes.map((route) => route.route_id),
    ["/", "/about/"],
  );
});

void test("WBV2-021: a spec route the model omitted is still sealed", () => {
  const blueprint = compileWebsiteBuildBlueprint(inputFor());
  const about = blueprint.payload.routes.find((route) => route.route_id === "/about/");
  assert.ok(about, "/about/ must survive even though the model returned no sections for it");
  assert.ok(about.sections.length >= 1);
});

void test("WBV2-009: every provenance digest matches the input it describes", () => {
  const input = inputFor();
  const blueprint = compileWebsiteBuildBlueprint(input);
  assert.equal(blueprint.payload.provenance.baseline_digest, digestOf(input.baseline));
  assert.equal(blueprint.payload.provenance.pattern_portfolio_digest, digestOf(portfolio));
  assert.equal(
    blueprint.payload.provenance.competitive_landscape_ref.artifact_id,
    landscape.artifact_id,
  );
});

void test("WBV2-018: a pattern ref the portfolio does not contain fails closed", () => {
  const input = inputFor();
  assert.throws(
    () =>
      compileWebsiteBuildBlueprint({
        ...input,
        model: {
          ...input.model,
          routes: [
            {
              route_id: "/",
              sections: [
                {
                  section_id: "hero",
                  component_class: "hero",
                  objective: "convert",
                  content_slots: ["primary_offer"],
                  pattern_refs: ["p-does-not-exist"],
                  proof_requirements: [],
                },
              ],
            },
          ],
        },
      }),
    /BLUEPRINT_PATTERN_REF_UNKNOWN/,
  );
});

void test("WBV2-018: an adopted pattern without an acceptance test fails closed", () => {
  assert.throws(
    () =>
      compileWebsiteBuildBlueprint(
        inputFor({
          patternPortfolio: {
            patterns: [{ ...portfolio.patterns[0]!, acceptance_test: "  " }],
          },
        }),
      ),
    /BLUEPRINT_GATE_FAILED.*acceptance test/s,
  );
});

void test("a REJECTed pattern needs no acceptance test", () => {
  assert.doesNotThrow(() => compileWebsiteBuildBlueprint(inputFor()));
});

void test("the blueprint is bound to the landscape it was compiled from", () => {
  // The compiler derives provenance from its own input, so a cross-landscape
  // blueprint cannot be produced here at all — a stronger guarantee than
  // detecting one afterwards. The detection path for an artifact that arrives
  // from elsewhere is assertWebsiteBlueprintLandscape, covered in
  // seo-build-intelligence-port.test.ts.
  const other = makeLandscape({ donorDomains: ["other-donor.example.com"] });
  assert.notEqual(other.artifact_id, landscape.artifact_id);
  const blueprint = compileWebsiteBuildBlueprint(inputFor({ landscape: other }));
  assert.equal(
    blueprint.payload.provenance.competitive_landscape_ref.artifact_id,
    other.artifact_id,
  );
  assert.deepEqual(blueprint.input_refs.map((ref) => ref.artifact_id), [other.artifact_id]);
});

void test("WBV2-009: provenance digests track their inputs rather than being constants", () => {
  // A digest that did not change when its input changed would be a placeholder
  // wearing a digest's shape — exactly what WBV2-009 forbids.
  const base = inputFor();
  const baseline = compileWebsiteBuildBlueprint(base);

  const differentVision = compileWebsiteBuildBlueprint({
    ...base,
    clientVision: { ...base.clientVision, brand_attributes: ["family-owned"] },
  });
  assert.notEqual(
    differentVision.payload.provenance.client_vision_digest,
    baseline.payload.provenance.client_vision_digest,
  );

  const differentReferences = compileWebsiteBuildBlueprint({
    ...base,
    designReferenceIntelligence: {
      ...base.designReferenceIntelligence,
      layout_principles: ["asymmetric proof grid"],
    },
  });
  assert.notEqual(
    differentReferences.payload.provenance.design_reference_intelligence_digest,
    baseline.payload.provenance.design_reference_intelligence_digest,
  );

  const differentBaseline = compileWebsiteBuildBlueprint({ ...base, baseline: ["/", "/other/"] });
  assert.notEqual(
    differentBaseline.payload.provenance.baseline_digest,
    baseline.payload.provenance.baseline_digest,
  );
});

void test("WBV2-006: the compiler imports no SEO blueprint type — no cycle can exist", () => {
  // Structural proof against the import surface, not raw text: the module's
  // prose may name the forbidden type to explain its absence, but no import
  // statement or type position may reference it.
  const source = readFileSync(
    resolve("src/intelligence/WebsiteBuildBlueprintCompiler.ts"),
    "utf8",
  );
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/SEOContentBlueprint/.test(withoutComments),
    "WebsiteBuildBlueprintCompiler must not reference SEOContentBlueprint in code (WBV2-006)",
  );
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map(
    (match) => match[1],
  );
  assert.ok(
    imports.every((specifier) => !/seo/i.test(specifier)),
    `compiler must import nothing SEO-owned; saw ${imports.join(", ")}`,
  );
});

void test("WBV2-005: CompetitiveLandscape is the only SEO-Bot input", () => {
  const blueprint = compileWebsiteBuildBlueprint(inputFor());
  assert.deepEqual(
    blueprint.input_refs.map((ref) => ref.artifact_type),
    ["competitive_landscape"],
  );
});

/* --------- ported V1 guarantees (WBV2-016, WBV2-022) -------------- */

void test("WBV2-022: canonical slot coverage survives an empty model section list", () => {
  const sections = ensureCanonicalSlotCoverage([], ["hero", "services", "faq", "contact"]);
  const covered = new Set(sections.flatMap((section) => section.content_slots));
  for (const slot of [
    "primary_offer",
    "service_overview",
    "differentiation",
    "trust",
    "process",
    "project_proof",
    "local_relevance",
    "objection_handling",
    "faq",
    "conversion",
    "metadata",
  ]) {
    assert.ok(covered.has(slot as never), `slot ${slot} must be covered`);
  }
});

void test("WBV2-022: sections are padded to spec-component parity (golden run #51)", () => {
  const sections = ensureCanonicalSlotCoverage(
    [
      {
        section_id: "only",
        component_class: "prose",
        objective: "",
        content_slots: [],
        pattern_refs: [],
        proof_requirements: [],
      },
    ],
    ["story", "team", "values", "cta"],
  );
  assert.equal(sections.length, 4);
});

void test("WBV2-010: visual requirements are derived deterministically from structure", () => {
  const routes = compileWebsiteBuildBlueprint(inputFor()).payload.routes;
  const first = deriveVisualRequirements(routes);
  const second = deriveVisualRequirements(routes);
  assert.deepEqual(first, second);
  assert.ok(first.some((requirement) => requirement.slot_id === "global:logo"));
  assert.ok(first.every((requirement, index) => index === 0 || requirement.slot_id > first[index - 1]!.slot_id));
});

void test("WBV2-010: the sealed blueprint carries its own visual requirements", () => {
  const blueprint = compileWebsiteBuildBlueprint(inputFor());
  assert.ok(blueprint.payload.visual_requirements.length > 0);
  assert.ok(
    blueprint.payload.visual_requirements.some((requirement) => requirement.role === "logo"),
  );
});
