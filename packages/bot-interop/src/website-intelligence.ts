import { createHash } from "node:crypto";
import { canonicalJson } from "./handoff.js";

export const WEBSITE_INTELLIGENCE_PROTOCOL = "l9.website-intelligence" as const;
export const WEBSITE_INTELLIGENCE_PROTOCOL_VERSION = "1.0" as const;

export const WEBSITE_INTELLIGENCE_SCHEMAS = {
  competitiveLandscape: "l9://website-intelligence/competitive-landscape/v1",
  websiteBuildBlueprint: "l9://website-intelligence/website-build-blueprint/v1",
  seoContentBlueprint: "l9://website-intelligence/seo-content-blueprint/v1",
  pageContentContract: "l9://website-intelligence/page-content-contract/v1",
  structuredContentPackage: "l9://website-intelligence/structured-content-package/v1",
} as const;

export type IntelligenceArtifactType =
  | "competitive_landscape"
  | "website_build_blueprint"
  | "seo_content_blueprint"
  | "page_content_contract"
  | "structured_content_package";

export type IntelligenceProducer = "Website-Bot" | "SEO-Bot";

export type ContentSlot =
  | "primary_offer"
  | "service_overview"
  | "differentiation"
  | "trust"
  | "process"
  | "project_proof"
  | "local_relevance"
  | "objection_handling"
  | "faq"
  | "conversion"
  | "metadata";

export interface ArtifactRef {
  artifact_type: IntelligenceArtifactType;
  artifact_id: string;
  payload_digest: string;
}

export interface IntelligenceArtifact<TType extends IntelligenceArtifactType, TPayload> {
  protocol: typeof WEBSITE_INTELLIGENCE_PROTOCOL;
  protocol_version: typeof WEBSITE_INTELLIGENCE_PROTOCOL_VERSION;
  artifact_type: TType;
  /**
   * Content-addressed identity:
   * `${artifact_type}:${payload_digest}`
   */
  artifact_id: string;
  client_id: string;
  build_id: string;
  producer: {
    repo: IntelligenceProducer;
    version: string;
  };
  produced_at: string;
  /**
   * Semantic upstream dependencies.
   * Sorted during sealing to keep identity deterministic.
   */
  input_refs: ArtifactRef[];
  payload: TPayload;
  integrity: {
    algorithm: "sha256";
    payload_digest: string;
  };
}

/* ------------------------------------------------------------------ */
/* CompetitiveLandscape                                               */
/* ------------------------------------------------------------------ */
export interface CompetitiveLandscapeV1 {
  schema: typeof WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape;
  market: {
    niche: string;
    country: string;
    language: string;
    device: "desktop" | "mobile";
    location_name?: string;
  };
  query_portfolio: Array<{
    query_id: string;
    query: string;
    intent: "informational" | "commercial" | "transactional" | "local";
    weight: number;
  }>;
  observations: Array<{
    observation_id: string;
    query_id: string;
    rank: number;
    url: string;
    domain: string;
    observed_at: string;
    /**
     * Ranking truth is deterministic SERP evidence.
     * Additional sources require a protocol revision/extension.
     */
    source: "dataforseo";
  }>;
  domains: Array<{
    domain: string;
    aggregate_visibility: number;
    qualifying_query_ids: string[];
    observation_ids: string[];
  }>;
  selected_donors: Array<{
    domain: string;
    aggregate_visibility: number;
    observation_ids: string[];
  }>;
  exclusions: Array<{
    domain: string;
    reason:
      | "directory"
      | "social"
      | "marketplace"
      | "publisher"
      | "aggregator"
      | "irrelevant"
      | "operator_exclusion";
  }>;
  evidence_complete: boolean;
}

/* ------------------------------------------------------------------ */
/* WebsiteBuildBlueprint                                              */
/* ------------------------------------------------------------------ */
export interface WebsiteBuildBlueprintV1 {
  schema: typeof WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint;
  build_intent: "REDESIGN_IMPROVE";
  competitive_landscape_ref: ArtifactRef;
  baseline_digest: string;
  pattern_portfolio_digest: string;
  strategy: {
    experience_attributes: string[];
    differentiation: string[];
    preserve: string[];
    evolve: string[];
    forbid: string[];
  };
  content_guardrails: {
    forbidden_claims: string[];
  };
  conversion: {
    primary_action: string;
    secondary_actions: string[];
    persistent_mobile_action: boolean;
  };
  routes: WebsiteBlueprintRoute[];
  acceptance_tests: string[];
}

export interface WebsiteBlueprintRoute {
  route_id: string;
  path: string;
  purpose: string;
  sections: WebsiteBlueprintSection[];
}

export interface WebsiteBlueprintSection {
  section_id: string;
  /**
   * Abstract component class, not concrete donor markup.
   */
  component_class: string;
  objective: string;
  content_slots: ContentSlot[];
  pattern_refs: string[];
  proof_requirements: string[];
  conversion_action?: string;
  acceptance_tests?: string[];
}

/* ------------------------------------------------------------------ */
/* SEOContentBlueprint                                                */
/* ------------------------------------------------------------------ */
export type RequirementPlacement = "FIRST_MATCH" | "ALL_MATCHES";

export interface SEOContentBlueprintV1 {
  schema: typeof WEBSITE_INTELLIGENCE_SCHEMAS.seoContentBlueprint;
  competitive_landscape_ref: ArtifactRef;
  routes: SEOContentBlueprintRoute[];
}

export interface SEOContentBlueprintRoute {
  route_id: string;
  path: string;
  search_intent: {
    primary: string;
    secondary: string[];
    journey_stage: "informational" | "commercial" | "transactional";
  };
  targets: {
    primary_query: string;
    supporting_queries: string[];
    topics: string[];
    entities: string[];
  };
  requirements: SEOContentRequirement[];
  competitive_gaps: Array<{
    gap_id: string;
    description: string;
    donor_domains: string[];
    opportunity: string;
  }>;
  internal_links: Array<{
    target_route_id: string;
    purpose: string;
  }>;
  aeo_geo: {
    answer_targets: string[];
    schema_requirements: string[];
  };
  metadata: {
    title_requirements: string[];
    description_requirements: string[];
  };
  forbidden_claims: string[];
  acceptance_tests: string[];
}

export interface SEOContentRequirement {
  requirement_id: string;
  target_slots: ContentSlot[];
  placement: RequirementPlacement;
  required_topics: string[];
  required_entities: string[];
  questions: string[];
  proof_needed: string[];
  required: boolean;
}

/* ------------------------------------------------------------------ */
/* Verified business facts                                            */
/* ------------------------------------------------------------------ */
export type VerifiedFactValue = string | number | boolean | string[];

export interface VerifiedBusinessFact {
  fact_id: string;
  key: string;
  value: VerifiedFactValue;
  verified: true;
  source_refs: string[];
  /**
   * Omitted means globally applicable.
   */
  route_ids?: string[];
  /**
   * Omitted means the fact can support any appropriate slot.
   */
  target_slots?: ContentSlot[];
}

/* ------------------------------------------------------------------ */
/* PageContentContract                                                */
/* ------------------------------------------------------------------ */
export interface PageContentContractV1 {
  schema: typeof WEBSITE_INTELLIGENCE_SCHEMAS.pageContentContract;
  compiler: {
    name: "website-content-contract-compiler";
    version: string;
    warnings: string[];
  };
  inputs: {
    website_build_blueprint: ArtifactRef;
    seo_content_blueprint: ArtifactRef;
    business_facts_digest: string;
  };
  routes: PageContentContractRoute[];
}

export interface PageContentContractRoute {
  route_id: string;
  path: string;
  purpose: string;
  search_context: {
    primary_intent: string;
    secondary_intents: string[];
    primary_query: string;
    supporting_queries: string[];
    topics: string[];
    entities: string[];
  };
  metadata_requirements: {
    title: string[];
    description: string[];
  };
  business_facts: VerifiedBusinessFact[];
  sections: PageContentContractSection[];
  internal_link_requirements: Array<{
    target_route_id: string;
    purpose: string;
  }>;
  forbidden_claims: string[];
  acceptance_tests: string[];
}

export interface PageContentContractSection {
  section_id: string;
  component_class: string;
  objective: string;
  slots: ContentSlot[];
  content_requirements: {
    requirement_ids: string[];
    topics: string[];
    entities: string[];
    questions: string[];
  };
  allowed_fact_ids: string[];
  proof_requirements: string[];
  conversion_action?: string;
  acceptance_tests: string[];
}

/* ------------------------------------------------------------------ */
/* StructuredContentPackage                                           */
/* ------------------------------------------------------------------ */
export type ContentBlock =
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "bullets";
      items: string[];
    }
  | {
      kind: "steps";
      items: string[];
    }
  | {
      kind: "quote";
      text: string;
      attribution?: string;
    };

export interface StructuredContentPackageV1 {
  schema: typeof WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage;
  page_content_contract_ref: ArtifactRef;
  routes: StructuredContentRoute[];
  validation: {
    seo_blueprint_passed: boolean;
    contract_passed: boolean;
    unsupported_claims: string[];
    failed_requirements: string[];
  };
}

export interface StructuredContentRoute {
  route_id: string;
  path: string;
  metadata: {
    title: string;
    description: string;
  };
  sections: Array<{
    section_id: string;
    eyebrow?: string;
    heading?: string;
    subheading?: string;
    blocks: ContentBlock[];
    cta?: {
      label: string;
      action: string;
    };
  }>;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
  internal_links: Array<{
    target_route_id: string;
    anchor_text: string;
  }>;
  /**
   * Website-Bot serializes the final JSON-LD deterministically.
   * SEO-Bot provides content requirements/inputs, not markup ownership.
   */
  schema_content_inputs: {
    faq?: boolean;
    service?: boolean;
    local_business?: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Artifact aliases                                                   */
/* ------------------------------------------------------------------ */
export type CompetitiveLandscapeArtifact = IntelligenceArtifact<
  "competitive_landscape",
  CompetitiveLandscapeV1
>;
export type WebsiteBuildBlueprintArtifact = IntelligenceArtifact<
  "website_build_blueprint",
  WebsiteBuildBlueprintV1
>;
export type SEOContentBlueprintArtifact = IntelligenceArtifact<
  "seo_content_blueprint",
  SEOContentBlueprintV1
>;
export type PageContentContractArtifact = IntelligenceArtifact<
  "page_content_contract",
  PageContentContractV1
>;
export type StructuredContentPackageArtifact = IntelligenceArtifact<
  "structured_content_package",
  StructuredContentPackageV1
>;

export type WebsiteIntelligenceArtifact =
  | CompetitiveLandscapeArtifact
  | WebsiteBuildBlueprintArtifact
  | SEOContentBlueprintArtifact
  | PageContentContractArtifact
  | StructuredContentPackageArtifact;

/* ------------------------------------------------------------------ */
/* Integrity                                                          */
/* ------------------------------------------------------------------ */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRefs(refs: ArtifactRef[]): ArtifactRef[] {
  return [...refs].sort((a, b) => {
    const ak = `${a.artifact_type}:${a.artifact_id}:${a.payload_digest}`;
    const bk = `${b.artifact_type}:${b.artifact_id}:${b.payload_digest}`;
    return ak.localeCompare(bk);
  });
}

function semanticBody<TType extends IntelligenceArtifactType, TPayload>(input: {
  artifact_type: TType;
  client_id: string;
  input_refs: ArtifactRef[];
  payload: TPayload;
}): unknown {
  return {
    protocol: WEBSITE_INTELLIGENCE_PROTOCOL,
    protocol_version: WEBSITE_INTELLIGENCE_PROTOCOL_VERSION,
    artifact_type: input.artifact_type,
    client_id: input.client_id,
    input_refs: normalizeRefs(input.input_refs),
    payload: input.payload,
  };
}

export function digestIntelligencePayload<TType extends IntelligenceArtifactType, TPayload>(input: {
  artifact_type: TType;
  client_id: string;
  input_refs: ArtifactRef[];
  payload: TPayload;
}): string {
  return sha256(canonicalJson(semanticBody(input)));
}

export function sealIntelligenceArtifact<TType extends IntelligenceArtifactType, TPayload>(input: {
  artifact_type: TType;
  client_id: string;
  build_id: string;
  producer: {
    repo: IntelligenceProducer;
    version: string;
  };
  produced_at?: string;
  input_refs?: ArtifactRef[];
  payload: TPayload;
}): IntelligenceArtifact<TType, TPayload> {
  const inputRefs = normalizeRefs(input.input_refs ?? []);
  const payloadDigest = digestIntelligencePayload({
    artifact_type: input.artifact_type,
    client_id: input.client_id,
    input_refs: inputRefs,
    payload: input.payload,
  });
  return {
    protocol: WEBSITE_INTELLIGENCE_PROTOCOL,
    protocol_version: WEBSITE_INTELLIGENCE_PROTOCOL_VERSION,
    artifact_type: input.artifact_type,
    artifact_id: `${input.artifact_type}:${payloadDigest}`,
    client_id: input.client_id,
    build_id: input.build_id,
    producer: input.producer,
    produced_at: input.produced_at ?? new Date().toISOString(),
    input_refs: inputRefs,
    payload: input.payload,
    integrity: {
      algorithm: "sha256",
      payload_digest: payloadDigest,
    },
  };
}

export function refForArtifact(artifact: WebsiteIntelligenceArtifact): ArtifactRef {
  return {
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    payload_digest: artifact.integrity.payload_digest,
  };
}

export function sameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return (
    a.artifact_type === b.artifact_type &&
    a.artifact_id === b.artifact_id &&
    a.payload_digest === b.payload_digest
  );
}

export function assertIntelligenceArtifactIntegrity(artifact: WebsiteIntelligenceArtifact): void {
  if (artifact.protocol !== WEBSITE_INTELLIGENCE_PROTOCOL) {
    throw new Error(`INTEL_ARTIFACT_SCHEMA_MISMATCH: unexpected protocol ${artifact.protocol}`);
  }
  if (artifact.protocol_version !== WEBSITE_INTELLIGENCE_PROTOCOL_VERSION) {
    throw new Error(
      `INTEL_ARTIFACT_SCHEMA_MISMATCH: unsupported protocol version ${artifact.protocol_version}`,
    );
  }
  if (artifact.integrity.algorithm !== "sha256") {
    throw new Error("INTEL_ARTIFACT_HASH_MISMATCH: unsupported integrity algorithm");
  }
  const expectedDigest = digestIntelligencePayload({
    artifact_type: artifact.artifact_type,
    client_id: artifact.client_id,
    input_refs: artifact.input_refs,
    payload: artifact.payload,
  });
  if (artifact.integrity.payload_digest !== expectedDigest) {
    throw new Error(
      "INTEL_ARTIFACT_HASH_MISMATCH: payload digest does not match canonical artifact content",
    );
  }
  const expectedArtifactId = `${artifact.artifact_type}:${expectedDigest}`;
  if (artifact.artifact_id !== expectedArtifactId) {
    throw new Error("INTEL_ARTIFACT_HASH_MISMATCH: artifact_id does not match payload digest");
  }
}
