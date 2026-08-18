// L9_META: layer=intelligence, role=seo_bot_http_client, status=active, version=1.0.0
import {
  assertIntelligenceArtifactIntegrity,
  type CompetitiveLandscapeArtifact,
  type SEOContentBlueprintArtifact,
  type StructuredContentPackageArtifact,
} from "@quantum-l9/bot-interop";
import type {
  CompetitiveLandscapeRequest,
  SEOContentBlueprintRequest,
  SeoBuildIntelligencePort,
  StructuredContentRequest,
} from "./SeoBuildIntelligencePort.js";

/**
 * HTTP transport for the SEO-Bot build-time intelligence seam
 * (l9.website-intelligence/v1).
 *
 * Security contract (agrees with SEO-Bot's machine-auth contract):
 * - `SEO_BOT_API_KEY` is the machine API credential for Website-Bot to
 *   SEO-Bot build-intelligence calls. It travels ONLY in the Authorization
 *   header of build-intelligence route requests.
 * - The operator dashboard key (OPERATOR_API_KEY) is NEVER used by this
 *   client — operator routes are for the human dashboard, not machine calls.
 * - Fail closed: constructing the client without a URL or key throws before
 *   any network traffic, so missing configuration surfaces in seconds
 *   instead of an empty-credential request failing twenty minutes in.
 *
 * Every response is re-validated against the sealed-artifact integrity contract.
 */
export class SeoBuildIntelligenceHttpClient implements SeoBuildIntelligencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!this.baseUrl.trim()) {
      throw new Error(
        "SEO_BOT_URL is required for the SEO-Bot intelligence seam (fail-closed)",
      );
    }
    if (!this.apiKey.trim()) {
      throw new Error(
        "SEO_BOT_API_KEY is required for the SEO-Bot intelligence seam (fail-closed); " +
          "the operator dashboard key is never used by this client",
      );
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `SEO-Bot intelligence ${path} failed (${response.status}): ${raw.slice(0, 500)}`,
      );
    }
    return JSON.parse(raw) as T;
  }

  async createCompetitiveLandscape(
    request: CompetitiveLandscapeRequest,
  ): Promise<CompetitiveLandscapeArtifact> {
    // Port carries plain seed queries; the API schema wants {query, intent} per
    // seed. Default intent is commercial (lead-gen factory context).
    const artifact = await this.post<CompetitiveLandscapeArtifact>(
      "/api/build-intelligence/competitive-landscape",
      {
        client_id: request.client_id,
        build_id: request.build_id,
        market: request.market,
        seed_queries: request.seed_queries.map((query) => ({ query, intent: "commercial" })),
        desired_donor_count: request.desired_donor_count,
      },
    );
    assertIntelligenceArtifactIntegrity(artifact);
    return artifact;
  }

  async createSEOContentBlueprint(
    request: SEOContentBlueprintRequest,
  ): Promise<SEOContentBlueprintArtifact> {
    const artifact = await this.post<SEOContentBlueprintArtifact>(
      "/api/build-intelligence/seo-content-blueprint",
      request,
    );
    assertIntelligenceArtifactIntegrity(artifact);
    return artifact;
  }

  async createStructuredContent(
    request: StructuredContentRequest,
  ): Promise<StructuredContentPackageArtifact> {
    const artifact = await this.post<StructuredContentPackageArtifact>(
      "/api/build-intelligence/structured-content",
      request,
    );
    assertIntelligenceArtifactIntegrity(artifact);
    return artifact;
  }
}
