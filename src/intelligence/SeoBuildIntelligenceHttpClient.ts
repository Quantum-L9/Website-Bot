// L9_META: layer=intelligence, role=seo_bot_http_client, status=active, version=1.0.0
import {
  assertIntelligenceArtifactIntegrity,
  type CompetitiveLandscapeArtifact,
  type SEOContentBlueprintArtifact,
  type StructuredContentPackageArtifact,
} from "@quantum-l9/bot-interop";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, fetch as undiciFetch } from "undici";
import {
  SeoBotPreflightError,
  type SeoBotPreflightResult,
  type SeoBuildIntelligencePort,
  type CompetitiveLandscapeRequest,
  type SEOContentBlueprintRequest,
  type StructuredContentRequest,
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
/**
 * Local dependency versions for preflight parity checks. Scoped package
 * package.jsons are located by walking up node_modules (their exports maps do
 * not expose "./package.json"), the same technique SEO-Bot's preflight uses.
 */
const moduleDir = dirname(fileURLToPath(import.meta.url));
function scopedPkgVersion(scope: string, name: string): string {
  let dir = moduleDir;
  for (;;) {
    const candidate = join(dir, "node_modules", scope, name, "package.json");
    if (existsSync(candidate)) {
      return (JSON.parse(readFileSync(candidate, "utf8")) as { version: string }).version;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`cannot locate ${scope}/${name}/package.json above ${moduleDir}`);
    }
    dir = parent;
  }
}

export class SeoBuildIntelligenceHttpClient implements SeoBuildIntelligencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    // Heavy calls need the npm-undici transport (own Agent; Node's built-in
    // fetch cannot accept an npm-undici dispatcher). Injectable so tests can
    // observe heavy calls with a mock.
    private readonly heavyFetchImpl: typeof fetch = undiciFetch,
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
    // The two heavyweight endpoints generate content for the whole contract
    // in one request (blueprint: 8 batched strategy calls; structured
    // content: prose for all 29 routes). Both take minutes — the legacy
    // generator measured 327s for the same contract — so a blanket 120s cap
    // aborts them mid-generation. Lightweight endpoints keep 120s.
    const heavy =
      path.includes("structured-content") ||
      path.includes("seo-content-blueprint") ||
      // The landscape call embeds live SERP queries whose own timeout is now
      // 90s; several queries can push the endpoint past the 120s light cap
      // (golden run #37).
      path.includes("competitive-landscape");
    const timeoutMs = heavy
      ? Number(process.env.SEO_BOT_HEAVY_CALL_TIMEOUT_MS ?? 900_000)
      : 120_000;
    // undici's default headersTimeout (300s) kills a request that is still
    // waiting for response headers while the server computes — the heavy
    // endpoints respond after ~5 minutes. The heavy calls therefore use the
    // npm-undici fetch with its OWN Agent: Node's built-in fetch cannot
    // accept an npm-undici dispatcher (separate module instances; passing
    // one fails instantly with "fetch failed" — golden run #13).
    const fetchFn = heavy ? this.heavyFetchImpl : this.fetchImpl;
    const response = await fetchFn(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      ...(heavy ? { dispatcher: new Agent({ headersTimeout: timeoutMs }) } : {}),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `SEO-Bot intelligence ${path} failed (${response.status}): ${raw.slice(0, 500)}`,
      );
    }
    return JSON.parse(raw) as T;
  }

  private async get(path: string): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new SeoBotPreflightError(
        "SEO_BOT_UNREACHABLE",
        `SEO-Bot ${path} unreachable: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Authenticated REDESIGN preflight: the public health route proves the
   * network, the machine-authenticated build-intelligence preflight route
   * proves auth, capabilities, provider configuration, bot-interop
   * compatibility, and Router patch equality. Every failure maps to one of
   * the four SEO_BOT_* codes and fails closed before any expensive pipeline
   * work.
   */
  async preflight(): Promise<SeoBotPreflightResult> {
    // 1. Network reachability — the public health route.
    const health = await this.get("/health");
    if (!health.ok) {
      throw new SeoBotPreflightError(
        "SEO_BOT_UNREACHABLE",
        `SEO-Bot health check failed (${health.status})`,
      );
    }

    // 2. Machine-authenticated readiness snapshot. 401/403 means the machine
    //    credential is wrong — distinct from the service being unreachable.
    const snapshotResponse = await this.get("/api/build-intelligence/preflight");
    if (!snapshotResponse.ok) {
      const code =
        snapshotResponse.status === 401 || snapshotResponse.status === 403
          ? "SEO_BOT_AUTH_FAILED"
          : "SEO_BOT_UNREACHABLE";
      throw new SeoBotPreflightError(
        code,
        `SEO-Bot preflight failed (${snapshotResponse.status})`,
      );
    }
    let snapshot: SeoBotPreflightResult;
    try {
      snapshot = (await snapshotResponse.json()) as SeoBotPreflightResult;
    } catch (error) {
      throw new SeoBotPreflightError(
        "SEO_BOT_CAPABILITY_MISMATCH",
        `SEO-Bot preflight returned an unreadable payload: ${(error as Error).message}`,
      );
    }

    // 3. Required API capabilities + provider configuration.
    const capabilities = snapshot.capabilities ?? ({} as SeoBotPreflightResult["capabilities"]);
    const missingCapabilities = [
      !capabilities.competitive_landscape && "competitive_landscape",
      !capabilities.seo_content_blueprint && "seo_content_blueprint",
      !capabilities.structured_content && "structured_content",
    ].filter((name): name is string => typeof name === "string");
    if (missingCapabilities.length > 0) {
      throw new SeoBotPreflightError(
        "SEO_BOT_CAPABILITY_MISMATCH",
        `SEO-Bot is missing required capabilities: ${missingCapabilities.join(", ")}`,
      );
    }
    const configuration = snapshot.configuration ?? ({} as SeoBotPreflightResult["configuration"]);
    if (!configuration.dataforseo_configured || !configuration.llm_provider_configured) {
      throw new SeoBotPreflightError(
        "SEO_BOT_CAPABILITY_MISMATCH",
        "SEO-Bot provider configuration is incomplete (DataForSEO or LLM provider not configured)",
      );
    }

    // 4. bot-interop compatibility — both bots must speak the same schema line.
    const localInterop = scopedPkgVersion("@quantum-l9", "bot-interop");
    if (snapshot.bot_interop_version !== localInterop) {
      throw new SeoBotPreflightError(
        "SEO_BOT_CAPABILITY_MISMATCH",
        `SEO-Bot bot-interop ${snapshot.bot_interop_version} is not compatible with Website-Bot ${localInterop}`,
      );
    }

    // 5. Router patch equality with the locally pinned promoted patch.
    const localRouter = scopedPkgVersion("@quantum-l9", "llm-router");
    if (snapshot.llm_router_version !== localRouter) {
      throw new SeoBotPreflightError(
        "SEO_BOT_ROUTER_VERSION_MISMATCH",
        `SEO-Bot Router ${snapshot.llm_router_version} does not match Website-Bot Router ${localRouter}`,
      );
    }

    return snapshot;
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
