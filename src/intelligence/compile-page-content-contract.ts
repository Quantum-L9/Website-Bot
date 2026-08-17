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
  return [...new Set(values.filter(Boolean))].sort();
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

  if (!sameArtifactRef(website.competitive_landscape_ref, seo.competitive_landscape_ref)) {
    throw new PageContentContractCompileError(
      "COMPETITIVE_LANDSCAPE_MISMATCH",
      "Website and SEO blueprints were produced from different CompetitiveLandscape artifacts.",
      {
        website: website.competitive_landscape_ref,
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
          topics: uniq(requirements.flatMap((requirement) => requirement.required_topics)),
          entities: uniq(requirements.flatMap((requirement) => requirement.required_entities)),
          questions: uniq(requirements.flatMap((requirement) => requirement.questions)),
        },
        allowed_fact_ids: uniq(allowedFacts.map((fact) => fact.fact_id)),
        proof_requirements: uniq([
          ...section.proof_requirements,
          ...requirements.flatMap((requirement) => requirement.proof_needed),
        ]),
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
