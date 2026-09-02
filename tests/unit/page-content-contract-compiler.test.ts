// L9_META: layer=test, role=page_content_contract_compiler, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  type ArtifactRef,
  type SEOContentBlueprintArtifact,
  type SEOContentBlueprintV1,
  type SEOContentRequirement,
  sealIntelligenceArtifact,
  type VerifiedBusinessFact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteBuildBlueprintV2,
} from "@quantum-l9/bot-interop";
import {
  compilePageContentContract,
  PageContentContractCompileError,
} from "../../src/intelligence/compile-page-content-contract.js";

const landscapeRef: ArtifactRef = {
  artifact_type: "competitive_landscape",
  artifact_id: "competitive_landscape:" + "a".repeat(64),
  payload_digest: "a".repeat(64),
};

const otherLandscapeRef: ArtifactRef = {
  artifact_type: "competitive_landscape",
  artifact_id: "competitive_landscape:" + "c".repeat(64),
  payload_digest: "c".repeat(64),
};

function websitePayload(landscape: ArtifactRef): WebsiteBuildBlueprintV2 {
  return {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: "REDESIGN_IMPROVE",
    provenance: {
      competitive_landscape_ref: landscape,
      baseline_digest: "b".repeat(64),
      client_vision_digest: "c".repeat(64),
      design_reference_intelligence_digest: "e".repeat(64),
      pattern_portfolio_digest: "d".repeat(64),
    },
    design_direction: {
      principles: [],
      desired_attributes: [],
      rejected_attributes: [],
      reference_pattern_refs: [],
      prohibited_transfers: [],
      palette_authority: { source: "none", tokens: {}, observed_characteristics: [] },
    },
    strategy: {
      experience_attributes: ["fast", "trustworthy"],
      differentiation: ["same-day pickup"],
      preserve: ["phone number"],
      evolve: ["hero"],
      forbid: ["stock imagery"],
    },
    content_guardrails: { forbidden_claims: ["licensed"] },
    conversion: {
      primary_action: "request_quote",
      secondary_actions: ["call"],
      persistent_mobile_action: true,
    },
    routes: [
      {
        route_id: "home",
        path: "/",
        purpose: "convert local searchers",
        sections: [
          {
            section_id: "hero",
            component_class: "hero",
            objective: "state primary offer",
            content_slots: ["primary_offer", "conversion"],
            pattern_refs: ["pat-hero"],
            proof_requirements: ["years_in_business"],
            conversion_action: "request_quote",
            acceptance_tests: ["hero-has-cta"],
          },
          {
            section_id: "services",
            component_class: "service_grid",
            objective: "explain services",
            content_slots: ["service_overview", "differentiation"],
            pattern_refs: ["pat-grid"],
            proof_requirements: [],
          },
        ],
      },
    ],
    visual_requirements: [],
    acceptance_tests: ["site-builds"],
  };
}

function seoRequirement(over: Partial<SEOContentRequirement> = {}): SEOContentRequirement {
  return {
    requirement_id: "req-1",
    target_slots: ["service_overview"],
    placement: "FIRST_MATCH",
    required_topics: ["ferrous", "non-ferrous"],
    required_entities: ["copper"],
    questions: ["what do you buy?"],
    proof_needed: ["price_list"],
    required: true,
    ...over,
  };
}

function seoPayload(
  landscape: ArtifactRef,
  requirements: SEOContentRequirement[],
): SEOContentBlueprintV1 {
  return {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.seoContentBlueprint,
    competitive_landscape_ref: landscape,
    batch_size: 4,
    batch_count: 1,
    routes: [
      {
        route_id: "home",
        path: "/",
        search_intent: {
          primary: "buy scrap metal",
          secondary: ["scrap prices"],
          journey_stage: "commercial",
        },
        targets: {
          primary_query: "scrap metal buyer",
          supporting_queries: ["copper price"],
          topics: ["recycling"],
          entities: ["aluminum"],
        },
        requirements,
        competitive_gaps: [],
        internal_links: [],
        aeo_geo: { answer_targets: [], schema_requirements: [] },
        metadata: {
          title_requirements: ["include city"],
          description_requirements: ["include phone"],
        },
        forbidden_claims: ["guaranteed price"],
        acceptance_tests: ["metadata-present"],
      },
    ],
  };
}

function sealWebsite(payload: WebsiteBuildBlueprintV2): WebsiteBuildBlueprintArtifact {
  return sealIntelligenceArtifact({
    artifact_type: "website_build_blueprint",
    client_id: "client-1",
    build_id: "build-1",
    producer: { repo: "Website-Bot", version: "3.1.0" },
    produced_at: "2026-08-14T00:00:00.000Z",
    input_refs: [payload.provenance.competitive_landscape_ref],
    payload,
  });
}

function sealSeo(payload: SEOContentBlueprintV1): SEOContentBlueprintArtifact {
  return sealIntelligenceArtifact({
    artifact_type: "seo_content_blueprint",
    client_id: "client-1",
    build_id: "build-1",
    producer: { repo: "SEO-Bot", version: "2.1.0" },
    produced_at: "2026-08-14T00:00:00.000Z",
    input_refs: [payload.competitive_landscape_ref],
    payload,
  });
}

const facts: VerifiedBusinessFact[] = [
  {
    fact_id: "f-years",
    key: "years_in_business",
    value: 22,
    verified: true,
    source_refs: ["crm"],
  },
  {
    fact_id: "f-phone",
    key: "phone",
    value: "555-1234",
    verified: true,
    source_refs: ["crm"],
    target_slots: ["conversion"],
  },
];

test("compiler places a required SEO requirement onto a compatible website slot", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(seoPayload(landscapeRef, [seoRequirement()]));
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });

  assert.equal(contract.schema, WEBSITE_INTELLIGENCE_SCHEMAS.pageContentContract);
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  assert.deepEqual(services.content_requirements.requirement_ids, ["req-1"]);
  assert.ok(services.content_requirements.topics.includes("ferrous"));
  // The phone fact is slot-scoped to `conversion`; only the hero should allow it.
  const hero = home.sections.find((s) => s.section_id === "hero");
  if (!hero) throw new Error("expected a hero section");
  assert.ok(hero.allowed_fact_ids.includes("f-phone"));
  assert.ok(!services.allowed_fact_ids.includes("f-phone"));
});

test("unverifiable credential entities are dropped from the coverage contract (golden run #42)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({ required_entities: ["licensed contractor", "copper"] }),
    ]),
  );
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  // "licensed contractor" carries the unverifiable "licens" marker and no
  // verified fact asserts it — requiring it would force an ungrounded claim.
  assert.ok(!services.content_requirements.entities.includes("licensed contractor"));
  assert.ok(services.content_requirements.entities.includes("copper"));
});

test("unverifiable availability-claim topics are dropped unless corpus-backed (golden run #43)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({ required_topics: ["no obligation", "free inspection"] }),
    ]),
  );
  // No fact asserts either phrase: both are dropped — a coverage requirement
  // can never demand a banned claim phrase the writer is forbidden to write.
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  assert.deepEqual(services.content_requirements.topics, []);

  // With a verified fact asserting "free inspection", the corpus-backed
  // phrase stays in the contract; the ungrounded one still drops.
  const factsWithInspection: VerifiedBusinessFact[] = [
    ...facts,
    {
      fact_id: "f-insp",
      key: "free_inspection",
      value: "free inspection",
      verified: true,
      source_refs: ["crm"],
    },
  ];
  const backed = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: factsWithInspection,
    compilerVersion: "1.0.0",
  });
  const backedHome = backed.routes.find((r) => r.route_id === "home");
  if (!backedHome) throw new Error("expected a compiled home route");
  const backedServices = backedHome.sections.find((s) => s.section_id === "services");
  if (!backedServices) throw new Error("expected a services section");
  assert.deepEqual(backedServices.content_requirements.topics, ["free inspection"]);
});

test("proof-class topics are dropped when no verified fact can support them (quantumaipartners_com live run)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({
        required_topics: [
          "measurable client outcomes",
          "recognizable credibility signals",
          "quantifiable achievements",
          "third-party validation",
          "experience indicators",
          "evaluation methodology",
          // Structural-gate class: multi-segment proof-demand sentences the
          // blueprint rephrases endlessly (live runs, attempt 11/18).
          "measurable_transformation_examples",
          "anonymized_outcome_examples",
          "adaptable_framework_demonstration",
          "step_by_step_industry_tailored_guides",
        ],
      }),
    ]),
  );
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  // The proof-class topics cannot be covered without fabrication — the live
  // run's generator failed closed on exactly these. Methodology coverage
  // stays: it is honest and satisfiable.
  assert.deepEqual(services.content_requirements.topics, ["evaluation methodology"]);
});

test("unverifiable response-time questions are dropped; fact-answerable questions stay (golden run #44)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({
        questions: [
          "How quickly can you respond?",
          "How can I contact you?",
          "Do you offer free inspections?",
        ],
      }),
    ]),
  );
  const factsWithInspection: VerifiedBusinessFact[] = [
    ...facts,
    {
      fact_id: "f-insp",
      key: "free_inspection",
      value: "free inspection",
      verified: true,
      source_refs: ["crm"],
    },
  ];
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: factsWithInspection,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  // "How quickly can you respond?" demands a response-time commitment no
  // verified fact asserts — it can never be answered honestly.
  assert.ok(!services.content_requirements.questions.includes("How quickly can you respond?"));
  assert.ok(services.content_requirements.questions.includes("How can I contact you?"));
  // Corpus-backed ("free inspection" is a verified fact) — kept.
  assert.ok(services.content_requirements.questions.includes("Do you offer free inspections?"));
});

test("quantity questions and statistical proofs are dropped unless corpus-backed (golden runs #45/#49)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({
        questions: ["How long do metal roofs last?", "What types of metal roofing do you install?"],
        proof_needed: [
          "durability statistics",
          "energy savings",
          "lifespan data",
          "cost data",
          "energy efficiency ratings",
          "local weather data",
          "damage thresholds",
          "years of experience",
          "material options",
        ],
      }),
    ]),
  );
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  // "How long do metal roofs last?" demands a lifespan number no fact
  // asserts; "What types…" is answerable and stays.
  assert.ok(!services.content_requirements.questions.includes("How long do metal roofs last?"));
  assert.ok(services.content_requirements.questions.includes("What types of metal roofing do you install?"));
  // Statistical/data proofs demand numbers the facts do not contain;
  // qualitative proof classes stay.
  for (const dropped of [
    "durability statistics",
    "energy savings",
    "lifespan data",
    "cost data",
    "energy efficiency ratings",
    "local weather data",
    "damage thresholds",
    "years of experience",
  ]) {
    assert.ok(!services.proof_requirements.includes(dropped), `proof should drop: ${dropped}`);
  }
  assert.ok(services.proof_requirements.includes("material options"));
});

test("image-backed multi-word proof requirements are kept without a textual fact", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [
      seoRequirement({
        proof_needed: ["before and after photos", "step by step diagram", "quantified success metrics"],
      }),
    ]),
  );
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const home = contract.routes.find((r) => r.route_id === "home");
  if (!home) throw new Error("expected a compiled home route");
  const services = home.sections.find((s) => s.section_id === "services");
  if (!services) throw new Error("expected a services section");
  assert.ok(services.proof_requirements.includes("before and after photos"));
  assert.ok(services.proof_requirements.includes("step by step diagram"));
  assert.ok(!services.proof_requirements.includes("quantified success metrics"));
});

test("compiler is deterministic — identical inputs produce byte-identical output", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(seoPayload(landscapeRef, [seoRequirement()]));
  const input = {
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  };
  const a = compilePageContentContract(input);
  const b = compilePageContentContract(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("different required inputs produce a different business_facts_digest", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(seoPayload(landscapeRef, [seoRequirement()]));
  const a = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  const b = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: [facts[0]],
    compilerVersion: "1.0.0",
  });
  assert.notEqual(a.inputs.business_facts_digest, b.inputs.business_facts_digest);
});

test("a required requirement with no compatible slot fails closed (CONTENT_REQUIREMENT_UNPLACED)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [seoRequirement({ target_slots: ["faq"], required: true })]),
  );
  assert.throws(
    () =>
      compilePageContentContract({
        websiteBlueprint: website,
        seoBlueprint: seo,
        businessFacts: facts,
        compilerVersion: "1.0.0",
      }),
    (err: unknown) =>
      err instanceof PageContentContractCompileError && err.code === "CONTENT_REQUIREMENT_UNPLACED",
  );
});

test("an optional requirement with no compatible slot is recorded as a warning, not a failure", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(
    seoPayload(landscapeRef, [seoRequirement({ target_slots: ["faq"], required: false })]),
  );
  const contract = compilePageContentContract({
    websiteBlueprint: website,
    seoBlueprint: seo,
    businessFacts: facts,
    compilerVersion: "1.0.0",
  });
  assert.equal(contract.compiler.warnings.length, 1);
  const [warning] = contract.compiler.warnings;
  if (!warning) throw new Error("expected a compiler warning");
  assert.match(warning, /req-1/);
});

test("blueprints from different CompetitiveLandscape artifacts fail closed", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(seoPayload(otherLandscapeRef, [seoRequirement()]));
  assert.throws(
    () =>
      compilePageContentContract({
        websiteBlueprint: website,
        seoBlueprint: seo,
        businessFacts: facts,
        compilerVersion: "1.0.0",
      }),
    (err: unknown) =>
      err instanceof PageContentContractCompileError &&
      err.code === "COMPETITIVE_LANDSCAPE_MISMATCH",
  );
});

test("mismatched route sets fail closed", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seoPayloadValue = seoPayload(landscapeRef, [seoRequirement()]);
  seoPayloadValue.routes[0].route_id = "about";
  const seo = sealSeo(seoPayloadValue);
  assert.throws(
    () =>
      compilePageContentContract({
        websiteBlueprint: website,
        seoBlueprint: seo,
        businessFacts: facts,
        compilerVersion: "1.0.0",
      }),
    (err: unknown) =>
      err instanceof PageContentContractCompileError && err.code === "ROUTE_SET_MISMATCH",
  );
});

test("duplicate business facts fail closed (INVALID_BUSINESS_FACT)", () => {
  const website = sealWebsite(websitePayload(landscapeRef));
  const seo = sealSeo(seoPayload(landscapeRef, [seoRequirement()]));
  assert.throws(
    () =>
      compilePageContentContract({
        websiteBlueprint: website,
        seoBlueprint: seo,
        businessFacts: [facts[0], facts[0]],
        compilerVersion: "1.0.0",
      }),
    (err: unknown) =>
      err instanceof PageContentContractCompileError && err.code === "INVALID_BUSINESS_FACT",
  );
});
