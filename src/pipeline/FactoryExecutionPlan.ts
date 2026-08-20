// L9_META: layer=pipeline, role=canonical_execution_plan, status=active, version=1.0.0

import { ClientSourcePublishStage } from "../stages/ClientSourcePublishStage.js";
import { CompetitiveIntelligenceStage } from "../stages/CompetitiveIntelligenceStage.js";
import { ContentGenerationStage } from "../stages/ContentGenerationStage.js";
import { DesignIntelligenceStage } from "../stages/DesignIntelligenceStage.js";
import { DomainSpecLoaderStage } from "../stages/DomainSpecLoaderStage.js";
import { HandoffEmitterStage } from "../stages/HandoffEmitterStage.js";
import { ImageAssetPlanningStage } from "../stages/ImageAssetPlanningStage.js";
import { ImageGenerationStage } from "../stages/ImageGenerationStage.js";
import { ImageValidationStage } from "../stages/ImageValidationStage.js";
import { PlaceholderScanStage } from "../stages/PlaceholderScanStage.js";
import { PostHogSnippetStage } from "../stages/PostHogSnippetStage.js";
import { ProvisionClientStage } from "../stages/ProvisionClientStage.js";
import { RedesignContentAuthorityStage } from "../stages/RedesignContentAuthorityStage.js";
import { RedesignIntegrityReceiptStage } from "../stages/RedesignIntegrityReceiptStage.js";
import { RedesignSchemaSerializerStage } from "../stages/RedesignSchemaSerializerStage.js";
import { ReleaseReceiptFinalizerStage } from "../stages/ReleaseReceiptFinalizerStage.js";
import { ReleaseReceiptStage } from "../stages/ReleaseReceiptStage.js";
import { SchemaGeneratorStage } from "../stages/SchemaGeneratorStage.js";
import { SEOBaselineStage } from "../stages/SEOBaselineStage.js";
import { SeoBuildIntelligencePreflightStage } from "../stages/SeoBuildIntelligencePreflightStage.js";
import { SiteAssemblerStage } from "../stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../stages/SiteBuildStage.js";
import { SourceSiteIngestionStage } from "../stages/SourceSiteIngestionStage.js";
import { StructuredContentProjectionStage } from "../stages/StructuredContentProjectionStage.js";
import { UnknownResolverStage } from "../stages/UnknownResolverStage.js";
import { VercelDeployStage } from "../stages/VercelDeployStage.js";
import { VisualQAStage } from "../stages/VisualQAStage.js";
import type { BuildContext, ExecutionMode } from "./BuildContext.js";
import { BuildError } from "./BuildError.js";
import type { BuildIntent } from "./BuildIntent.js";
import { PipelineRunner, type Stage } from "./PipelineRunner.js";

export interface FactoryExecutionPlanOptions {
  mode: ExecutionMode;
  /**
   * Transformation intent; REDESIGN_IMPROVE inserts the
   * seo-build-intelligence-preflight and competitive-intelligence stages.
   */
  buildIntent?: BuildIntent;
  specPath: string;
  skipStages?: string[];
  provision?: boolean;
  persistDeployBlock?: boolean;
  rollbackCreatedResources?: boolean;
}

export interface FactoryExecutionPlan {
  mode: ExecutionMode;
  stages: Stage[];
  mandatoryStages: string[];
  requiredEvidence: string[];
  skipStages: string[];
}

const MANDATORY: Record<ExecutionMode, string[]> = {
  plan: [
    "domain-spec-loader",
    "unknown-resolver",
    "design-intelligence",
    "content-generation",
    "schema-generator",
    "placeholder-scan",
    "site-assembler",
    "posthog-snippet",
    "release-receipt",
  ],
  "local-proof": [
    "domain-spec-loader",
    "unknown-resolver",
    "design-intelligence",
    "content-generation",
    "schema-generator",
    "placeholder-scan",
    "site-assembler",
    "posthog-snippet",
    "site-build",
    "release-receipt",
  ],
  "publish-proof": [
    "domain-spec-loader",
    "unknown-resolver",
    "design-intelligence",
    "content-generation",
    "schema-generator",
    "placeholder-scan",
    "site-assembler",
    "posthog-snippet",
    "site-build",
    "client-source-publish",
    "release-receipt",
  ],
  "end-to-end": [
    "domain-spec-loader",
    "unknown-resolver",
    "design-intelligence",
    "content-generation",
    "schema-generator",
    "placeholder-scan",
    "site-assembler",
    "posthog-snippet",
    "site-build",
    "client-source-publish",
    "vercel-deploy",
    "release-receipt",
    "seo-baseline",
    "visual-qa",
    "release-receipt-finalizer",
    "handoff-emitter",
  ],
};
const REQUIRED_EVIDENCE: Record<ExecutionMode, string[]> = {
  plan: [],
  "local-proof": ["assembly", "build", "release"],
  "publish-proof": ["assembly", "build", "publication", "release"],
  "end-to-end": ["assembly", "build", "publication", "deployment", "release", "handoff"],
};

export class TerminalConvergenceStage implements Stage {
  name = "terminal-convergence";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };
  constructor(
    private readonly mode: ExecutionMode,
    private readonly mandatory: string[],
    private readonly requiredEvidence: string[],
  ) {}
  async run(ctx: BuildContext): Promise<void> {
    this.requireMandatoryConvergence(ctx);
    if (this.mode === "plan") return;
    await this.requireBaseEvidence(ctx);
    // Conditional visual-asset evidence, additive to the base gates: a site with
    // image slots must have persisted its delivered manifest, and an enabled source
    // site must have persisted its crawl evidence.
    await this.requireVisualAssetEvidence(ctx);
    if (this.mode === "end-to-end") await this.requireEndToEndEvidence(ctx);
    // The chain-status transition happens in PipelineRunner AFTER this stage's
    // success is recorded (transitionStageSucceeded clears the prior active
    // failure); calling transitionRunConverged here dead-ended every resume.
  }

  private requireMandatoryConvergence(ctx: BuildContext): void {
    for (const stage of this.mandatory) {
      const result = ctx.stageResults.get(stage);
      // A skipped mandatory stage can only come from a resume whose checkpoint was
      // re-verified against on-disk evidence (checkpointIsValid) — user --skip of
      // mandatory stages is rejected at plan build. Skipped-with-valid-checkpoint
      // therefore IS convergence; failing here made every resume after a
      // downstream stage failure unusable.
      if (!result?.ok)
        throw new BuildError(
          "RELEASE_EVIDENCE_INCOMPLETE",
          `Mandatory stage did not converge: ${stage}`,
        );
    }
  }

  private async requireBaseEvidence(ctx: BuildContext): Promise<void> {
    for (const kind of this.requiredEvidence) {
      if (!(await ctx.evidenceStore.referenceFor(kind as never)))
        throw new BuildError(
          "EVIDENCE_REFERENCE_MISSING",
          `Terminal convergence requires ${kind} evidence`,
        );
    }
  }

  private async requireVisualAssetEvidence(ctx: BuildContext): Promise<void> {
    const assets = ctx.domainSpec.assets;
    if (
      (assets?.imageSlots ?? []).length > 0 &&
      !(await ctx.evidenceStore.referenceFor("image_assets"))
    ) {
      throw new BuildError(
        "EVIDENCE_REFERENCE_MISSING",
        "Terminal convergence requires image_assets evidence for a site with image slots",
      );
    }
    if (
      assets?.sourceSite?.enabled === true &&
      !(await ctx.evidenceStore.referenceFor("source_site"))
    ) {
      throw new BuildError(
        "EVIDENCE_REFERENCE_MISSING",
        "Terminal convergence requires source_site evidence when source-site ingestion is enabled",
      );
    }
  }

  private async requireEndToEndEvidence(ctx: BuildContext): Promise<void> {
    await ctx.evidenceStore.loadValidatedReleaseBundle({
      requireStatus: "succeeded",
      requireMode: "end-to-end",
    });
    if (!(await ctx.evidenceStore.readHandoff()))
      throw new BuildError(
        "RELEASE_EVIDENCE_INCOMPLETE",
        "End-to-end convergence requires persisted handoff evidence",
      );
    if (ctx.autoRegisterSeoBot && !(await ctx.evidenceStore.readRegistrationAck()))
      throw new BuildError(
        "RELEASE_EVIDENCE_INCOMPLETE",
        "Auto-registration requires a verified SEO-Bot acknowledgement",
      );
  }
}

/**
 * Campaign 7: under REDESIGN_IMPROVE the legacy content/schema authorities
 * are replaced (not merely asked to "do less") and the redesign intelligence
 * stages become mandatory — skipping them or falling back to the COPY
 * topology cannot satisfy redesign convergence.
 */
const REDESIGN_ADDED_MANDATORY = [
  "seo-build-intelligence-preflight",
  "competitive-intelligence",
  "redesign-content-authority",
  "structured-content-projection",
  "redesign-schema-serializer",
  "redesign-integrity-receipt",
] as const;
const REDESIGN_REPLACED_LEGACY: Record<string, string> = {
  "content-generation": "structured-content-projection",
  "schema-generator": "redesign-schema-serializer",
};

export function mandatoryStagesFor(mode: ExecutionMode, buildIntent?: BuildIntent): string[] {
  const base = MANDATORY[mode];
  if (buildIntent !== "REDESIGN_IMPROVE") return [...base];
  const replaced = base.map((stage) => REDESIGN_REPLACED_LEGACY[stage] ?? stage);
  return [...new Set([...replaced, ...REDESIGN_ADDED_MANDATORY])];
}

export function buildFactoryExecutionPlan(
  options: FactoryExecutionPlanOptions,
): FactoryExecutionPlan {
  const redesign = options.buildIntent === "REDESIGN_IMPROVE";
  const skips = [...new Set(options.skipStages ?? [])];
  const mandatory = mandatoryStagesFor(options.mode, options.buildIntent);
  const illegal = skips.filter((stage) => mandatory.includes(stage));
  if (illegal.length)
    throw new BuildError(
      "VALIDATION_FAILED",
      `Cannot skip mandatory ${options.mode} stages: ${illegal.join(", ")}`,
    );
  const stages: Stage[] = [new DomainSpecLoaderStage(options.specPath)];
  if (options.provision)
    stages.push(
      new ProvisionClientStage(options.specPath, {
        persistDeployBlock: options.persistDeployBlock ?? true,
        rollbackCreatedResources: options.rollbackCreatedResources ?? true,
      }),
    );
  stages.push(new UnknownResolverStage());
  if (redesign) {
    // The readiness proof precedes the first paid build-intelligence call;
    // ordering here IS the guarantee, and CompetitiveIntelligenceStage
    // fails closed if it ever runs without the resulting evidence.
    stages.push(new SeoBuildIntelligencePreflightStage(), new CompetitiveIntelligenceStage());
  }
  stages.push(new SourceSiteIngestionStage(), new DesignIntelligenceStage());
  if (redesign) {
    // Redesign content/schema authority chain: legacy ContentGenerationStage
    // and SchemaGeneratorStage are ABSENT from this plan, not downgraded.
    stages.push(
      new RedesignContentAuthorityStage(),
      new StructuredContentProjectionStage(),
      new RedesignSchemaSerializerStage(),
    );
  } else {
    stages.push(new ContentGenerationStage(), new SchemaGeneratorStage());
  }
  stages.push(
    new ImageAssetPlanningStage(),
    new ImageGenerationStage(),
    new PlaceholderScanStage(),
    new SiteAssemblerStage(),
    new ImageValidationStage(),
    new PostHogSnippetStage(),
  );
  if (options.mode !== "plan") stages.push(new SiteBuildStage());
  if (options.mode === "publish-proof" || options.mode === "end-to-end")
    stages.push(new ClientSourcePublishStage());
  if (options.mode === "end-to-end") stages.push(new VercelDeployStage());
  stages.push(new ReleaseReceiptStage());
  if (options.mode === "end-to-end")
    stages.push(
      new SEOBaselineStage(),
      new VisualQAStage(),
      new ReleaseReceiptFinalizerStage(),
      new HandoffEmitterStage(),
    );
  if (redesign) stages.push(new RedesignIntegrityReceiptStage());
  stages.push(
    new TerminalConvergenceStage(options.mode, mandatory, REQUIRED_EVIDENCE[options.mode]),
  );
  return {
    mode: options.mode,
    stages,
    mandatoryStages: [...mandatory, "terminal-convergence"],
    requiredEvidence: [...REQUIRED_EVIDENCE[options.mode]],
    skipStages: skips,
  };
}

export async function executeFactoryPlan(
  ctx: BuildContext,
  plan: FactoryExecutionPlan,
): Promise<void> {
  const runner = new PipelineRunner(plan.skipStages);
  for (const stage of plan.stages) runner.register(stage);
  await runner.run(ctx);
}
