// L9_META: layer=stage, role=design_reference_acquisition, status=active, version=1.0.0
//
// Resolves the first-party design authorities (ClientVision, DesignReferenceSet)
// from the frozen spec, then ACQUIRES and ANALYZES every accepted client
// reference URL through repository-owned code (GAP-1, run 2026-09-01). The
// result feeds `DesignReferenceIntelligence` and, through it, the sealed
// WebsiteBuildBlueprintV2 — so a client who supplied URLs and taste, and no
// hand-authored principles, still gets a design direction grounded in what
// the references actually exhibit.
//
// Topology: runs AFTER seo-build-intelligence-preflight (so an unreachable
// SEO-Bot fails the run before any Website-Bot LLM spend) and BEFORE
// competitive-intelligence (which consumes the resolved authorities).
//
// Policy (fail closed, honest partial):
//   - a reference with no URL contributes only operator-authored principles;
//   - an unreachable / non-HTML / forbidden reference is recorded with its
//     reason and contributes only operator-authored principles;
//   - when the spec declares URL-bearing references and NONE could be acquired,
//     the run fails with DESIGN_REFERENCE_UNACQUIRED — the client's evidence
//     base is entirely missing and the blueprint would be built on air.

import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type { HttpPageFetcher } from "../ingestion/PageFetcher.js";
import {
  PlaywrightScreenshotCapturer,
  type ScreenshotCapturer,
} from "../ingestion/ScreenshotCapturer.js";
import {
  acquireAndAnalyzeDesignReferences,
  applyAcquisitionToReferenceSet,
  DesignReferenceAnalysisError,
} from "../intelligence/DesignReferenceAcquisition.js";
import {
  acquirableReferences,
  DesignAuthorityError,
  deriveDesignReferenceIntelligence,
  resolveClientVision,
  resolveDesignReferenceSet,
} from "../intelligence/design-authority.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import {
  hydrateRedesignIntelligence,
  persistRedesignArtifact,
} from "../pipeline/evidence/RedesignIntelligenceArtifacts.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:design-reference-acquisition");

export interface DesignReferenceAcquisitionDeps {
  fetcher?: HttpPageFetcher;
  screenshots?: () => ScreenshotCapturer;
  /** Test-only: permit loopback/private hosts so a local fixture server is reachable. */
  allowPrivateHosts?: boolean;
  navigationTimeoutMs?: number;
}

export class DesignReferenceAcquisitionStage implements Stage {
  name = "design-reference-acquisition";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  constructor(private readonly deps: DesignReferenceAcquisitionDeps = {}) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info(
        { intent: ctx.buildIntent },
        "not a redesign build; reference acquisition skipped",
      );
      return;
    }

    let clientVision: ReturnType<typeof resolveClientVision>;
    let declared: ReturnType<typeof resolveDesignReferenceSet>;
    try {
      clientVision = resolveClientVision(ctx.domainSpec);
      declared = resolveDesignReferenceSet(ctx.domainSpec);
    } catch (error) {
      if (error instanceof DesignAuthorityError) {
        throw new BuildError("VALIDATION_FAILED", error.message);
      }
      throw error;
    }
    ctx.clientVision = clientVision;

    const acquirable = acquirableReferences(declared);
    if (ctx.dryRun) {
      ctx.designReferenceSet = declared;
      ctx.designReferenceIntelligence = deriveDesignReferenceIntelligence(declared);
      logger.info(
        { references: acquirable.length },
        "[dry-run] Would acquire and analyze client design references",
      );
      return;
    }

    // Resume: reuse a persisted, verified acquisition for this exact build
    // rather than re-fetching and re-spending.
    if (ctx.resume) {
      const hydrated = hydrateRedesignIntelligence(ctx, [
        "design-reference-acquisition",
        "design-reference-set",
        "design-reference-intelligence",
      ]);
      if (
        hydrated.includes("design-reference-set") &&
        hydrated.includes("design-reference-intelligence")
      ) {
        logger.info({ hydrated }, "design references reused from persisted redesign intelligence");
        return;
      }
    }

    if (acquirable.length === 0) {
      ctx.designReferenceSet = declared;
      ctx.designReferenceIntelligence = deriveDesignReferenceIntelligence(declared);
      this.persist(ctx);
      logger.info(
        { declared: declared.accepted_references.length },
        "no URL-bearing design references; operator-authored principles only",
      );
      return;
    }

    const screenshots = this.deps.screenshots?.() ?? new PlaywrightScreenshotCapturer();
    let manifest: Awaited<ReturnType<typeof acquireAndAnalyzeDesignReferences>>;
    try {
      manifest = await acquireAndAnalyzeDesignReferences(declared, {
        llm: ctx.llm,
        clientId: ctx.clientId,
        buildId: ctx.buildId,
        outputDir: resolve(clientAssetRoot(ctx), "design-reference-evidence"),
        fetcher: this.deps.fetcher,
        screenshots,
        allowPrivateHosts: this.deps.allowPrivateHosts,
        navigationTimeoutMs: this.deps.navigationTimeoutMs,
        clientContext: {
          brand_attributes: clientVision.brand_attributes,
          change: clientVision.change,
          explicit_constraints: clientVision.explicit_constraints,
        },
      });
    } catch (error) {
      if (error instanceof DesignReferenceAnalysisError) {
        throw new BuildError("INTELLIGENCE_PARSE_FAILED", error.message);
      }
      throw error;
    } finally {
      await screenshots.close();
    }

    if (manifest.summary.acquired === 0) {
      throw new BuildError(
        "DESIGN_REFERENCE_UNACQUIRED",
        `none of the ${manifest.summary.with_url} client-supplied design reference URL(s) could be acquired: ${manifest.references
          .filter((entry) => entry.status !== "acquired")
          .map(
            (entry) =>
              `${entry.reference_id} (${entry.status}: ${entry.failure_reason ?? "no url"})`,
          )
          .join("; ")}`,
      );
    }

    const set = applyAcquisitionToReferenceSet(declared, manifest);
    ctx.designReferenceAcquisition = manifest;
    ctx.designReferenceSet = set;
    ctx.designReferenceIntelligence = deriveDesignReferenceIntelligence(set);
    this.persist(ctx);
    logger.info(
      {
        declared: manifest.summary.declared,
        withUrl: manifest.summary.with_url,
        acquired: manifest.summary.acquired,
        failed: manifest.summary.failed,
        analyzed: manifest.summary.analyzed,
        derivedPrinciples:
          ctx.designReferenceIntelligence.layout_principles.length +
          ctx.designReferenceIntelligence.hierarchy_principles.length +
          ctx.designReferenceIntelligence.interaction_principles.length +
          ctx.designReferenceIntelligence.density_principles.length +
          ctx.designReferenceIntelligence.positive_patterns.length +
          ctx.designReferenceIntelligence.negative_patterns.length,
      },
      "client design references acquired and analyzed",
    );
  }

  private persist(ctx: BuildContext): void {
    persistRedesignArtifact(ctx, "client-vision", ctx.clientVision);
    if (ctx.designReferenceAcquisition)
      persistRedesignArtifact(ctx, "design-reference-acquisition", ctx.designReferenceAcquisition);
    persistRedesignArtifact(ctx, "design-reference-set", ctx.designReferenceSet);
    persistRedesignArtifact(ctx, "design-reference-intelligence", ctx.designReferenceIntelligence);
  }
}
