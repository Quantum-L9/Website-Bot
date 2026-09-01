import { createHash } from "node:crypto";
import {
  type ContentSlot,
  canonicalJson,
  type PageContentContractV1,
  refForArtifact,
  type SEOContentBlueprintArtifact,
  type SEOContentRequirement,
  sameArtifactRef,
  type VerifiedBusinessFact,
  type WebsiteBlueprintSection,
  type WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";

export type ContractCompileErrorCode =
  | "COMPETITIVE_LANDSCAPE_MISMATCH"
  | "ROUTE_SET_MISMATCH"
  | "ROUTE_PATH_MISMATCH"
  | "CONTENT_REQUIREMENT_UNPLACED"
  | "INVALID_BUSINESS_FACT";

export class PageContentContractCompileError extends Error {
  readonly code: ContractCompileErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ContractCompileErrorCode, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = "PageContentContractCompileError";
    this.code = code;
    this.details = details;
  }
}

export interface CompilePageContentContractInput {
  websiteBlueprint: WebsiteBuildBlueprintArtifact;
  seoBlueprint: SEOContentBlueprintArtifact;
  businessFacts: VerifiedBusinessFact[];
  compilerVersion: string;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function intersects(a: ContentSlot[], b: ContentSlot[]): boolean {
  const bSet = new Set<ContentSlot>(b);
  return a.some((value) => bSet.has(value));
}

function digestBusinessFacts(facts: VerifiedBusinessFact[]): string {
  const sorted = [...facts].sort((a, b) => a.fact_id.localeCompare(b.fact_id));
  return createHash("sha256").update(canonicalJson(sorted)).digest("hex");
}

function validateFacts(facts: VerifiedBusinessFact[]): void {
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!fact.fact_id || !fact.key || fact.verified !== true) {
      throw new PageContentContractCompileError(
        "INVALID_BUSINESS_FACT",
        "All facts must have fact_id, key, and verified=true.",
        { fact },
      );
    }
    if (seen.has(fact.fact_id)) {
      throw new PageContentContractCompileError(
        "INVALID_BUSINESS_FACT",
        `Duplicate fact_id ${fact.fact_id}`,
      );
    }
    seen.add(fact.fact_id);
  }
}

function factsForRoute(facts: VerifiedBusinessFact[], routeId: string): VerifiedBusinessFact[] {
  return facts.filter(
    (fact) => !fact.route_ids || fact.route_ids.length === 0 || fact.route_ids.includes(routeId),
  );
}

function factAllowedForSection(
  fact: VerifiedBusinessFact,
  section: WebsiteBlueprintSection,
): boolean {
  if (!fact.target_slots || fact.target_slots.length === 0) {
    return true;
  }
  return intersects(fact.target_slots, section.content_slots);
}

function sectionsForRequirement(
  sections: WebsiteBlueprintSection[],
  requirement: SEOContentRequirement,
): WebsiteBlueprintSection[] {
  const matches = sections.filter((section) =>
    intersects(section.content_slots, requirement.target_slots),
  );
  if (matches.length === 0) {
    return [];
  }
  if (requirement.placement === "FIRST_MATCH") {
    // slice avoids an index access that static analysis reads as possibly-undefined
    return matches.slice(0, 1);
  }
  return matches;
}

export function compilePageContentContract(
  input: CompilePageContentContractInput,
): PageContentContractV1 {
  const website = input.websiteBlueprint.payload;
  const seo = input.seoBlueprint.payload;

  validateFacts(input.businessFacts);

  if (!sameArtifactRef(website.provenance.competitive_landscape_ref, seo.competitive_landscape_ref)) {
    throw new PageContentContractCompileError(
      "COMPETITIVE_LANDSCAPE_MISMATCH",
      "Website and SEO blueprints were produced from different CompetitiveLandscape artifacts.",
      {
        website: website.provenance.competitive_landscape_ref,
        seo: seo.competitive_landscape_ref,
      },
    );
  }

  const websiteRouteIds = uniq(website.routes.map((route) => route.route_id));
  const seoRouteIds = uniq(seo.routes.map((route) => route.route_id));
  if (canonicalJson(websiteRouteIds) !== canonicalJson(seoRouteIds)) {
    throw new PageContentContractCompileError(
      "ROUTE_SET_MISMATCH",
      "WebsiteBuildBlueprint and SEOContentBlueprint must describe the same route set.",
      { websiteRouteIds, seoRouteIds },
    );
  }

  const warnings: string[] = [];

  const routes = website.routes.map((websiteRoute) => {
    const seoRoute = seo.routes.find((candidate) => candidate.route_id === websiteRoute.route_id);
    if (!seoRoute) {
      throw new PageContentContractCompileError(
        "ROUTE_SET_MISMATCH",
        `Missing SEO route ${websiteRoute.route_id}`,
      );
    }
    if (seoRoute.path !== websiteRoute.path) {
      throw new PageContentContractCompileError(
        "ROUTE_PATH_MISMATCH",
        `Route ${websiteRoute.route_id} has conflicting paths.`,
        { websitePath: websiteRoute.path, seoPath: seoRoute.path },
      );
    }

    const routeFacts = factsForRoute(input.businessFacts, websiteRoute.route_id);

    const requirementPlacement = new Map<string, SEOContentRequirement[]>();
    for (const section of websiteRoute.sections) {
      requirementPlacement.set(section.section_id, []);
    }

    for (const requirement of seoRoute.requirements) {
      const destinations = sectionsForRequirement(websiteRoute.sections, requirement);
      if (destinations.length === 0) {
        if (requirement.required) {
          throw new PageContentContractCompileError(
            "CONTENT_REQUIREMENT_UNPLACED",
            `Required SEO content requirement ${requirement.requirement_id} has no compatible WebsiteBuildBlueprint content slot.`,
            {
              route_id: websiteRoute.route_id,
              requirement_id: requirement.requirement_id,
              target_slots: requirement.target_slots,
            },
          );
        }
        warnings.push(
          `Optional requirement ${requirement.requirement_id} was not placed on route ${websiteRoute.route_id}.`,
        );
        continue;
      }
      for (const destination of destinations) {
        // destination is one of websiteRoute.sections, every section_id of which
        // was pre-seeded above, so the bucket is always present. The explicit
        // guard keeps the access provably safe instead of asserting non-null.
        const bucket = requirementPlacement.get(destination.section_id);
        if (bucket) {
          bucket.push(requirement);
        }
      }
    }

    // Unverifiable credential topics, entities, AND questions: the oracle's
    // fact_guardrails (claims_requiring_explicit_verified_fact) mark
    // license/certification/award/availability/response-time status as
    // claims that need a verified fact. A coverage requirement in that set
    // with no fact to back it can never be satisfied honestly — requiring it
    // forces the generator to either invent the claim or write a disclaimer
    // the validator rejects (topics: golden runs #19-#22; entities: golden
    // run #42, where a blueprint-invented "licensed contractor" entity
    // forced the writer to choose between an ungrounded credential claim and
    // literal entity coverage; topics again: golden run #43, where
    // "no obligation" — a banned claim phrase — was simultaneously required
    // by topic coverage and forbidden by claim grounding; questions: golden
    // run #44, where "How quickly can you respond?" demanded a response-time
    // commitment no verified fact asserts). Drop such requirements from the
    // coverage contract; the claim itself remains covered by claim grounding
    // on the prose.
    //
    // The availability/offer markers below mirror SEO-Bot's credential
    // claim vocabulary (claim-grounding CREDENTIAL_CLAIM_TOKENS) so a
    // coverage requirement can never demand a phrase the writer is
    // forbidden to write ungrounded. Corpus backing keeps grounded phrases
    // in the contract ("fully insured", "warranty", "free inspection",
    // "24/7 emergency service available").
    const UNVERIFIABLE_TOPIC_MARKERS = [
      "licens", "certif", "accredit", "award", "bond", "years in business",
      "obligat", "financing", "free estimat", "free inspect", "money-back",
      "money back", "same-day", "same day", "24/7", "emergency servic",
      "guarantee", "warrant", "insured",
      // Response-time commitments: an answer to "how quickly?" is a promise
      // only a verified fact can make.
      "respond", "response time", "how quickly", "how fast", "how soon",
      "turnaround",
      // Quantity/cost commitments: "how long do metal roofs last?", "how
      // much does it cost?" demand numbers the facts do not assert (golden
      // run #45: the writer's lifespan number was grounded-scrubbed, leaving
      // broken prose the semantic validator then flagged).
      "how long", "how much", "how many", "cost",
      // Lifespan/comparison topics: "lifespan comparison" invites
      // comparative lifespan claims no fact asserts (golden run #49: the
      // guide route's comparison content was flagged as unsupported claims).
      "lifespan",
      // Proof-class coverage: "measurable client outcomes", "recognizable
      // credibility signals", "quantifiable achievements", "third-party
      // validation", and "experience indicators" demand proof only a
      // verified fact can supply. A client with no public case studies or
      // credentials (live run: quantumaipartners_com) cannot cover them
      // without fabrication, and the SEO-Bot generator/validator then fail
      // closed on exactly the right grounds — the contract itself was
      // unsatisfiable. Methodology phrasings stay in the contract; the
      // claim-level guardrails still catch any ungrounded claim in prose.
      "client outcom", "measurabl", "quantifiab", "quantified", "credibility signal",
      "third party", "third-party", "experience indicator", "track record",
      "case stud", "testimonial", "client logo", "portfolio", "client brand",
      "collaboration example", "industry-specific example", "client example",
      "client validation", "recognizable", "substantiat", "innovation",
      "latest", "industry", "benefit", "prominent",
    ];
    const factCorpus = routeFacts
      .map((fact) => `${fact.key} ${Array.isArray(fact.value) ? fact.value.join(" ") : String(fact.value)}`)
      .join(" ")
      .toLowerCase();
    const isBacked = (value: string): boolean =>
      // (1) Marker gate: proof-class topics drop unless corpus-backed.
      (!UNVERIFIABLE_TOPIC_MARKERS.some((marker) => value.toLowerCase().includes(marker)) ||
        factCorpus.includes(value.toLowerCase())) &&
      // (2) Structural gate: the blueprint LLM rephrases proof demands into
      // long topic sentences ("measurable_transformation_examples",
      // "step_by_step_industry_tailored_guides") that no marker list can
      // exhaust. Real coverage topics are short; any topic of 3+ word
      // segments must be corpus-backed verbatim or it drops.
      (value.toLowerCase().split(/[\s_]+/).filter(Boolean).length < 3 ||
        factCorpus.includes(value.toLowerCase()));
    const filterBacked = (values: string[]): string[] =>
      uniq(values).filter((value) => value.trim().length > 0 && isBacked(value));
    // Questions are phrased as questions, so the full-string corpus check
    // above would drop every fact-answerable one ("Do you offer free
    // inspections?" never equals the fact "free inspection"). A question is
    // answerable when every unverifiable marker inside it is corpus-grounded
    // ("free inspection" fact backs the "free inspect" marker; a "how
    // quickly?" response-time marker has no fact anywhere in the corpus).
    const isBackedQuestion = (question: string): boolean => {
      const lower = question.toLowerCase();
      const found = UNVERIFIABLE_TOPIC_MARKERS.filter((marker) => lower.includes(marker));
      return found.every((marker) => factCorpus.includes(marker));
    };
    const filterQuestions = (questions: string[]): string[] =>
      uniq(questions).filter(
        (question) => question.trim().length > 0 && isBackedQuestion(question),
      );

    const sections = websiteRoute.sections.map((section) => {
      const requirements = requirementPlacement.get(section.section_id) ?? [];
      const allowedFacts = routeFacts.filter((fact) => factAllowedForSection(fact, section));
      return {
        section_id: section.section_id,
        component_class: section.component_class,
        objective: section.objective,
        slots: [...section.content_slots],
        content_requirements: {
          requirement_ids: uniq(requirements.map((requirement) => requirement.requirement_id)),
          topics: filterBacked(requirements.flatMap((requirement) => requirement.required_topics)),
          entities: filterBacked(requirements.flatMap((requirement) => requirement.required_entities)),
          questions: filterQuestions(requirements.flatMap((requirement) => requirement.questions)),
        },
        allowed_fact_ids: uniq(allowedFacts.map((fact) => fact.fact_id)),
        proof_requirements: uniq([
          ...section.proof_requirements,
          ...requirements.flatMap((requirement) => requirement.proof_needed),
        ]).filter((proof) => {
          // Unverifiable proof classes: community involvement, awards,
          // licensure, certifications, statistics/percentages/lifespan data,
          // cost/rating/weather data — anything the frozen facts cannot
          // assert. Requiring them forces the generator to invent claims
          // the semantic validator then rejects (golden run #34, /about;
          // golden run #45, /services/metal-roofing, where "durability
          // statistics" / "energy savings" / "lifespan data" demanded
          // numbers the facts do not contain — the writer's invented
          // lifespan number was grounded-scrubbed, leaving broken prose;
          // golden run #49, the guide route's "cost data" / "energy
          // efficiency ratings" / "local weather data"). Project/gallery
          // proof (image-backed) is never filtered.
          const UNVERIFIABLE_PROOF_MARKERS = [
            "community", "involvement", "participation", "award",
            "certif", "licens", "bond", "membership", "accredit",
            "statistic", "percentage", "lifespan", "savings",
            "cost", "rating", "data", "threshold",
            // The magnitude phrase itself is a banned claim token — a proof
            // demanding it can never be satisfied (golden run #53: the
            // writer's attempt was scrubbed into "6 serving Charlotte"
            // residue and the validator kept the requirement unmet).
            "years of experience",
          ];
          if (!UNVERIFIABLE_PROOF_MARKERS.some((marker) => proof.toLowerCase().includes(marker))) {
            return true;
          }
          return factCorpus.includes(proof.toLowerCase());
        }),
        ...(section.conversion_action ? { conversion_action: section.conversion_action } : {}),
        acceptance_tests: uniq(section.acceptance_tests ?? []),
      };
    });

    return {
      route_id: websiteRoute.route_id,
      path: websiteRoute.path,
      purpose: websiteRoute.purpose,
      search_context: {
        primary_intent: seoRoute.search_intent.primary,
        secondary_intents: uniq(seoRoute.search_intent.secondary),
        primary_query: seoRoute.targets.primary_query,
        supporting_queries: uniq(seoRoute.targets.supporting_queries),
        topics: uniq(seoRoute.targets.topics),
        entities: uniq(seoRoute.targets.entities),
      },
      metadata_requirements: {
        title: uniq(seoRoute.metadata.title_requirements),
        description: uniq(seoRoute.metadata.description_requirements),
      },
      business_facts: routeFacts,
      sections,
      internal_link_requirements: [...seoRoute.internal_links].sort((a, b) =>
        `${a.target_route_id}:${a.purpose}`.localeCompare(`${b.target_route_id}:${b.purpose}`),
      ),
      forbidden_claims: uniq([
        ...website.content_guardrails.forbidden_claims,
        ...seoRoute.forbidden_claims,
      ]),
      acceptance_tests: uniq([...website.acceptance_tests, ...seoRoute.acceptance_tests]),
    };
  });

  return {
    schema: "l9://website-intelligence/page-content-contract/v1",
    compiler: {
      name: "website-content-contract-compiler",
      version: input.compilerVersion,
      warnings: uniq(warnings),
    },
    inputs: {
      website_build_blueprint: refForArtifact(input.websiteBlueprint),
      seo_content_blueprint: refForArtifact(input.seoBlueprint),
      business_facts_digest: digestBusinessFacts(input.businessFacts),
    },
    routes,
  };
}
