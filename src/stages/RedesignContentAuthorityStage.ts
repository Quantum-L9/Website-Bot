// L9_META: layer=stage, role=redesign_content_authority, status=active, version=1.1.0
//
// Campaign 7 R6–R8: the redesign content authority chain.
//
//   WebsiteBuildBlueprint ──> real SEO-Bot SEOContentBlueprint
//                       └─┬─────────────┘
//                         v
//         deterministic PageContentContract (ZERO LLM)
//                         v
//           real SEO-Bot StructuredContentPackage
//
// Every edge is lineage-checked against the exact accepted
// CompetitiveLandscape / PageContentContract identity. No fixture fallback,
// no local substitute, no LLM repair. The StructuredContentPackage received
// here is the FINAL page prose authority — Website-Bot never rewrites it.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertIntelligenceArtifactIntegrity,
  canonicalJson,
  type MarketAuthority,
  type PageContentContractArtifact,
  type PageContentContractV1,
  readMarketAuthority,
  refForArtifact,
  type StructuredContentPackageArtifact,
  sameArtifactRef,
  sameMarketAuthority,
  sealIntelligenceArtifact,
  type VerifiedBusinessFact,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import {
  compilePageContentContract,
  PageContentContractCompileError,
} from "../intelligence/compile-page-content-contract.js";
import { SeoBuildIntelligenceHttpClient } from "../intelligence/SeoBuildIntelligenceHttpClient.js";
import type { SeoBuildIntelligencePort } from "../intelligence/SeoBuildIntelligencePort.js";
import { verifiedBusinessFactsFromSpec } from "../intelligence/verified-business-facts.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError, type BuildErrorCode } from "../pipeline/BuildError.js";
import {
  hydrateRedesignIntelligence,
  persistRedesignArtifact,
} from "../pipeline/evidence/RedesignIntelligenceArtifacts.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import type { WebsiteFactoryLLM } from "../services/llm.js";

const logger = createModuleLogger("stage:redesign-content-authority");

const COMPILER_VERSION = "1.0.0";

function pccPayloadDigest(payload: PageContentContractV1): string {
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function forbiddenLlm(operation: string, onCall: () => void): WebsiteFactoryLLM {
  const reject = (): never => {
    onCall();
    throw new BuildError(
      "FORBIDDEN_LLM_OPERATION",
      `${operation} is deterministic; LLM calls are forbidden on this path`,
    );
  };
  return new Proxy({} as WebsiteFactoryLLM, {
    get(_target, property) {
      if (property === "then") return undefined;
      return reject;
    },
  });
}

function compileErrorCode(error: PageContentContractCompileError): BuildErrorCode {
  switch (error.code) {
    case "COMPETITIVE_LANDSCAPE_MISMATCH":
      return "COMPETITIVE_LANDSCAPE_MISMATCH";
    case "ROUTE_SET_MISMATCH":
    case "ROUTE_PATH_MISMATCH":
      return "ROUTE_SET_MISMATCH";
    case "CONTENT_REQUIREMENT_UNPLACED":
      return "CONTENT_REQUIREMENT_UNPLACED";
    default:
      return "VALIDATION_FAILED";
  }
}

export class RedesignContentAuthorityStage implements Stage {
  name = "redesign-content-authority";
  version = "1.1.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  constructor(
    private readonly portFactory: (ctx: BuildContext) => SeoBuildIntelligencePort = defaultPort,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; content authority skipped");
      return;
    }
    const { blueprint, authority } = this.assertPrerequisites(ctx);
    if (!ctx.seoBuildIntelligencePreflight) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "redesign content authority requires successful SEO-Bot preflight evidence",
      );
    }
    if (ctx.resume && !ctx.dryRun) {
      const hydrated = hydrateRedesignIntelligence(ctx, [
        "seo-content-blueprint",
        "page-content-contract",
        "pcc-determinism",
        "structured-content-package",
        "redesign-counters",
      ]);
      if (
        hydrated.includes("seo-content-blueprint") &&
        hydrated.includes("page-content-contract") &&
        hydrated.includes("pcc-determinism") &&
        hydrated.includes("structured-content-package")
      ) {
        this.assertSeoBlueprintLineage(
          ctx,
          ctx.seoContentBlueprint as NonNullable<BuildContext["seoContentBlueprint"]>,
          blueprint,
          authority,
          ctx.domainSpec.routes.map((route) => ({
            route_id: route.slug,
            path: route.slug,
            purpose: route.purpose ?? route.title,
          })),
        );
        this.validateStructuredContent(
          ctx,
          ctx.pageContentContract as PageContentContractArtifact,
          ctx.structuredContentPackage as StructuredContentPackageArtifact,
        );
        logger.info(
          { hydrated },
          "content authority chain reused from persisted redesign artifacts",
        );
        return;
      }
    }
    ctx.redesignCounters ??= {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    };
    const counters = ctx.redesignCounters;
    const port = this.portFactory(ctx);

    const routeTargets = ctx.domainSpec.seo_contract?.route_targets ?? [];
    const routes = ctx.domainSpec.routes.map((route) => {
      const keywords: string[] = [];
      const seen = new Set<string>();
      for (const target of routeTargets) {
        if (target.target_page !== route.slug) continue;
        for (const keyword of target.keywords ?? []) {
          const trimmed = keyword.trim();
          if (trimmed.length === 0 || seen.has(trimmed)) continue;
          seen.add(trimmed);
          keywords.push(trimmed);
        }
      }
      return {
        route_id: route.slug,
        path: route.slug,
        purpose: route.purpose ?? route.title,
        ...(keywords && keywords.length > 0 ? { keywords } : {}),
      };
    });
    const businessFacts = verifiedBusinessFactsFromSpec(ctx.domainSpec);

    const seoBlueprint = await port.createSEOContentBlueprint({
      client_id: ctx.clientId,
      build_id: ctx.buildId,
      ...(authority.kind === "competitive_landscape"
        ? { competitive_landscape: ctx.competitiveLandscape }
        : { first_party_authority: authority.record }),
      routes,
      business_facts: businessFacts,
    });
    this.assertSeoBlueprintLineage(ctx, seoBlueprint, blueprint, authority, routes);
    ctx.seoContentBlueprint = seoBlueprint;
    persistRedesignArtifact(ctx, "seo-content-blueprint", seoBlueprint);
    logger.info(
      { artifactId: seoBlueprint.artifact_id, routes: seoBlueprint.payload.routes.length },
      "SEOContentBlueprint accepted (lineage verified)",
    );

    const contract = this.compileContractDeterministically(
      ctx,
      blueprint,
      seoBlueprint,
      businessFacts,
      counters,
    );
    ctx.pageContentContract = contract;
    persistRedesignArtifact(ctx, "page-content-contract", contract);
    persistRedesignArtifact(ctx, "pcc-determinism", ctx.pccDeterminism);
    if (!ctx.dryRun) {
      const assetsDir = clientAssetRoot(ctx);
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(
        resolve(assetsDir, "page-content-contract.json"),
        `${JSON.stringify(contract, null, 2)}\n`,
        "utf-8",
      );
    }
    logger.info(
      { artifactId: contract.artifact_id, llmCalls: counters.pageContentContractLlmCalls },
      "PageContentContract sealed deterministically (0 LLM calls)",
    );

    const contentPackage = await port.createStructuredContent({
      client_id: ctx.clientId,
      build_id: ctx.buildId,
      page_content_contract: contract,
    });
    this.validateStructuredContent(ctx, contract, contentPackage);
    ctx.structuredContentPackage = contentPackage;
    persistRedesignArtifact(ctx, "structured-content-package", contentPackage);
    persistRedesignArtifact(ctx, "redesign-counters", counters);
    logger.info(
      { artifactId: contentPackage.artifact_id, routes: contentPackage.payload.routes.length },
      "StructuredContentPackage accepted as final page prose authority",
    );
  }

  private assertPrerequisites(ctx: BuildContext): {
    blueprint: NonNullable<BuildContext["websiteBlueprint"]>;
    authority: MarketAuthority;
  } {
    const blueprint = ctx.websiteBlueprint;
    if (!blueprint) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "redesign content authority requires the sealed WebsiteBuildBlueprint",
      );
    }
    let authority: MarketAuthority;
    try {
      authority = readMarketAuthority(blueprint.payload.provenance);
    } catch (error) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        `redesign content authority requires exactly one market authority: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (authority.kind === "competitive_landscape") {
      if (!ctx.competitiveLandscape) {
        throw new BuildError(
          "REDESIGN_PIPELINE_INCOMPLETE",
          "redesign content authority requires the CompetitiveLandscape this blueprint cites",
        );
      }
      if (
        !sameArtifactRef(authority.ref, refForArtifact(ctx.competitiveLandscape)) ||
        ctx.firstPartyAuthority
      ) {
        throw new BuildError(
          "COMPETITIVE_LANDSCAPE_MISMATCH",
          "WebsiteBuildBlueprint cites a different market authority than this run accepted",
        );
      }
    } else if (ctx.competitiveLandscape) {
      throw new BuildError(
        "COMPETITIVE_LANDSCAPE_MISMATCH",
        "a first-party blueprint must not be paired with a CompetitiveLandscape",
      );
    } else if (
      ctx.firstPartyAuthority &&
      !sameMarketAuthority(
        { first_party_authority: ctx.firstPartyAuthority },
        { first_party_authority: authority.record },
      )
    ) {
      throw new BuildError(
        "COMPETITIVE_LANDSCAPE_MISMATCH",
        "WebsiteBuildBlueprint cites a different first-party authority than this run recorded",
      );
    }
    return { blueprint, authority };
  }

  private assertSeoBlueprintLineage(
    ctx: BuildContext,
    seoBlueprint: Awaited<ReturnType<SeoBuildIntelligencePort["createSEOContentBlueprint"]>>,
    blueprint: NonNullable<BuildContext["websiteBlueprint"]>,
    authority: MarketAuthority,
    routes: Array<{ route_id: string; path: string; purpose: string }>,
  ): void {
    try {
      assertIntelligenceArtifactIntegrity(seoBlueprint);
    } catch (error) {
      throw new BuildError(
        "SEO_CONTENT_BLUEPRINT_INVALID",
        `SEOContentBlueprint failed integrity verification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (seoBlueprint.client_id !== ctx.clientId) {
      throw new BuildError(
        "SEO_CONTENT_BLUEPRINT_INVALID",
        `SEOContentBlueprint belongs to client ${seoBlueprint.client_id}, expected ${ctx.clientId}`,
      );
    }
    if (!sameMarketAuthority(blueprint.payload.provenance, seoBlueprint.payload)) {
      throw new BuildError(
        "COMPETITIVE_LANDSCAPE_MISMATCH",
        authority.kind === "first_party"
          ? "SEOContentBlueprint cites a different first-party authority than the website blueprint"
          : "SEOContentBlueprint references a different CompetitiveLandscape than this run accepted",
      );
    }
    if (
      authority.kind === "competitive_landscape" &&
      ctx.competitiveLandscape &&
      !sameArtifactRef(authority.ref, refForArtifact(ctx.competitiveLandscape))
    ) {
      throw new BuildError(
        "COMPETITIVE_LANDSCAPE_MISMATCH",
        "WebsiteBuildBlueprint references a different CompetitiveLandscape than this run accepted",
      );
    }
    const expectedRouteIds = new Set(routes.map((route) => route.route_id));
    const seoRouteIds = new Set(seoBlueprint.payload.routes.map((route) => route.route_id));
    if (
      seoRouteIds.size !== expectedRouteIds.size ||
      [...expectedRouteIds].some((id) => !seoRouteIds.has(id))
    ) {
      throw new BuildError(
        "ROUTE_SET_MISMATCH",
        "SEOContentBlueprint route set does not match the spec route set",
      );
    }
  }

  private compileContractDeterministically(
    ctx: BuildContext,
    blueprint: NonNullable<BuildContext["websiteBlueprint"]>,
    seoBlueprint: Awaited<ReturnType<SeoBuildIntelligencePort["createSEOContentBlueprint"]>>,
    businessFacts: VerifiedBusinessFact[],
    counters: NonNullable<BuildContext["redesignCounters"]>,
  ): PageContentContractArtifact {
    const realLlm = ctx.llm;
    ctx.llm = forbiddenLlm("PageContentContract compilation", () => {
      counters.pageContentContractLlmCalls += 1;
    });
    let contract: PageContentContractArtifact;
    let digestRun1: string;
    let digestRun2: string;
    try {
      const compile = (): PageContentContractV1 =>
        compilePageContentContract({
          websiteBlueprint: blueprint,
          seoBlueprint,
          businessFacts,
          compilerVersion: COMPILER_VERSION,
        });
      const payloadRun1 = compile();
      digestRun1 = pccPayloadDigest(payloadRun1);
      const payloadRun2 = compile();
      digestRun2 = pccPayloadDigest(payloadRun2);
      if (digestRun1 !== digestRun2) {
        throw new BuildError(
          "CONTENT_CONTRACT_HASH_MISMATCH",
          `PCC_NONDETERMINISTIC: identical semantic input produced different PageContentContract digests (${digestRun1} != ${digestRun2})`,
        );
      }
      contract = sealIntelligenceArtifact({
        artifact_type: "page_content_contract",
        client_id: ctx.clientId,
        build_id: ctx.buildId,
        producer: { repo: "Website-Bot", version: COMPILER_VERSION },
        input_refs: [refForArtifact(blueprint), refForArtifact(seoBlueprint)],
        payload: payloadRun1,
      });
    } catch (error) {
      if (error instanceof PageContentContractCompileError) {
        throw new BuildError(
          compileErrorCode(error),
          error.details ? `${error.message} ${JSON.stringify(error.details)}` : error.message,
        );
      }
      throw error;
    } finally {
      ctx.llm = realLlm;
    }
    if (counters.pageContentContractLlmCalls !== 0) {
      throw new BuildError(
        "FORBIDDEN_LLM_OPERATION",
        `PageContentContract compilation performed ${counters.pageContentContractLlmCalls} LLM call(s); required count is 0`,
      );
    }
    ctx.pccDeterminism = {
      digestRun1,
      digestRun2,
      sameSemanticInputSameDigest: true,
    };
    return contract;
  }

  private validateStructuredContent(
    ctx: BuildContext,
    contract: PageContentContractArtifact,
    contentPackage: StructuredContentPackageArtifact,
  ): void {
    try {
      assertIntelligenceArtifactIntegrity(contentPackage);
    } catch (error) {
      throw new BuildError(
        "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
        `StructuredContentPackage failed integrity verification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (contentPackage.client_id !== ctx.clientId) {
      throw new BuildError(
        "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
        `StructuredContentPackage belongs to client ${contentPackage.client_id}, expected ${ctx.clientId}`,
      );
    }
    const contractRef = refForArtifact(contract);
    if (!sameArtifactRef(contentPackage.payload.page_content_contract_ref, contractRef)) {
      throw new BuildError(
        "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
        "StructuredContentPackage references a different PageContentContract than the one sealed by this run",
      );
    }
    const contractRoutes = new Set(contract.payload.routes.map((route) => route.route_id));
    const packageRoutes = new Set(contentPackage.payload.routes.map((route) => route.route_id));
    if (
      packageRoutes.size !== contractRoutes.size ||
      [...contractRoutes].some((id) => !packageRoutes.has(id))
    ) {
      throw new BuildError(
        "ROUTE_SET_MISMATCH",
        "StructuredContentPackage route set does not match the PageContentContract route set",
      );
    }
    const validation = contentPackage.payload.validation;
    if (
      !validation.contract_passed ||
      !validation.seo_blueprint_passed ||
      validation.unsupported_claims.length > 0 ||
      validation.failed_requirements.length > 0
    ) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `StructuredContentPackage failed its own validation gates: ${JSON.stringify(validation)}`,
      );
    }
    for (const route of contentPackage.payload.routes) {
      if (route.sections.length === 0) {
        throw new BuildError(
          "VALIDATION_FAILED",
          `StructuredContentPackage route ${route.route_id} carries no content sections`,
        );
      }
    }
  }
}

function defaultPort(_ctx: BuildContext): SeoBuildIntelligencePort {
  return new SeoBuildIntelligenceHttpClient(
    process.env.SEO_BOT_URL?.trim() ?? "",
    process.env.SEO_BOT_API_KEY?.trim() ?? "",
  );
}
