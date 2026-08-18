import type {
  CompetitiveLandscapeArtifact,
  PageContentContractArtifact,
  SEOContentBlueprintArtifact,
  StructuredContentPackageArtifact,
  VerifiedBusinessFact,
  WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";

export interface CompetitiveLandscapeRequest {
  client_id: string;
  build_id: string;
  market: {
    niche: string;
    country: string;
    language: string;
    device: "desktop" | "mobile";
    location_name?: string;
  };
  seed_queries: string[];
  desired_donor_count: number;
}

export interface SEOContentBlueprintRequest {
  client_id: string;
  build_id: string;
  competitive_landscape: CompetitiveLandscapeArtifact;
  /**
   * SEO-Bot does not consume WebsiteBuildBlueprint.
   * It receives route identity and verified business truth,
   * preserving independent authority.
   */
  routes: Array<{
    route_id: string;
    path: string;
    purpose: string;
  }>;
  business_facts: VerifiedBusinessFact[];
}

export interface StructuredContentRequest {
  client_id: string;
  build_id: string;
  page_content_contract: PageContentContractArtifact;
}

/** Machine-authenticated readiness snapshot returned by the SEO-Bot preflight. */
export interface SeoBotPreflightResult {
  status: string;
  service: string;
  version: string;
  bot_interop_version: string;
  llm_router_version: string;
  capabilities: {
    competitive_landscape: boolean;
    seo_content_blueprint: boolean;
    structured_content: boolean;
  };
  configuration: {
    dataforseo_configured: boolean;
    llm_provider_configured: boolean;
  };
}

/** Typed preflight failure carrying the mapped SEO_BOT_* failure code. */
export class SeoBotPreflightError extends Error {
  readonly code:
    | "SEO_BOT_UNREACHABLE"
    | "SEO_BOT_AUTH_FAILED"
    | "SEO_BOT_CAPABILITY_MISMATCH"
    | "SEO_BOT_ROUTER_VERSION_MISMATCH";
  constructor(
    code: SeoBotPreflightError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SeoBotPreflightError";
    this.code = code;
  }
}

export interface SeoBuildIntelligencePort {
  createCompetitiveLandscape(
    request: CompetitiveLandscapeRequest,
  ): Promise<CompetitiveLandscapeArtifact>;

  createSEOContentBlueprint(
    request: SEOContentBlueprintRequest,
  ): Promise<SEOContentBlueprintArtifact>;

  createStructuredContent(
    request: StructuredContentRequest,
  ): Promise<StructuredContentPackageArtifact>;

  /**
   * Machine-authenticated REDESIGN preflight: health reachability plus the
   * build-intelligence readiness snapshot. Throws {@link SeoBotPreflightError}
   * with one of the four SEO_BOT_* failure codes on any failure.
   */
  preflight(): Promise<SeoBotPreflightResult>;
}

/**
 * Boundary helper for callers that want to explicitly prove a
 * WebsiteBuildBlueprint belongs to the same CompetitiveLandscape before
 * compiling content.
 */
export function assertWebsiteBlueprintLandscape(
  websiteBlueprint: WebsiteBuildBlueprintArtifact,
  competitiveLandscape: CompetitiveLandscapeArtifact,
): void {
  const expected = competitiveLandscape.artifact_id;
  const actual = websiteBlueprint.payload.competitive_landscape_ref.artifact_id;
  if (actual !== expected) {
    throw new Error(
      "INTEL_INPUT_HASH_MISMATCH: WebsiteBuildBlueprint references a different CompetitiveLandscape.",
    );
  }
}
