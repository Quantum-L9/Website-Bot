// L9_META: layer=pipeline, role=canonical_execution_plan, status=active, version=1.0.0
import { BuildError } from './BuildError.js';
import type { BuildContext, ExecutionMode } from './BuildContext.js';
import { PipelineRunner, type Stage } from './PipelineRunner.js';
import { DomainSpecLoaderStage } from '../stages/DomainSpecLoaderStage.js';
import { ProvisionClientStage } from '../stages/ProvisionClientStage.js';
import { UnknownResolverStage } from '../stages/UnknownResolverStage.js';
import { DesignIntelligenceStage } from '../stages/DesignIntelligenceStage.js';
import { ContentGenerationStage } from '../stages/ContentGenerationStage.js';
import { SchemaGeneratorStage } from '../stages/SchemaGeneratorStage.js';
import { PlaceholderScanStage } from '../stages/PlaceholderScanStage.js';
import { SiteAssemblerStage } from '../stages/SiteAssemblerStage.js';
import { PostHogSnippetStage } from '../stages/PostHogSnippetStage.js';
import { SiteBuildStage } from '../stages/SiteBuildStage.js';
import { ClientSourcePublishStage } from '../stages/ClientSourcePublishStage.js';
import { VercelDeployStage } from '../stages/VercelDeployStage.js';
import { ReleaseReceiptStage } from '../stages/ReleaseReceiptStage.js';
import { SEOBaselineStage } from '../stages/SEOBaselineStage.js';
import { VisualQAStage } from '../stages/VisualQAStage.js';
import { ReleaseReceiptFinalizerStage } from '../stages/ReleaseReceiptFinalizerStage.js';
import { HandoffEmitterStage } from '../stages/HandoffEmitterStage.js';

export interface FactoryExecutionPlanOptions {
  mode: ExecutionMode;
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

const MANDATORY: Record<ExecutionMode,string[]> = {
  plan: ['domain-spec-loader','unknown-resolver','design-intelligence','content-generation','schema-generator','placeholder-scan','site-assembler','posthog-snippet','release-receipt'],
  'local-proof': ['domain-spec-loader','unknown-resolver','design-intelligence','content-generation','schema-generator','placeholder-scan','site-assembler','posthog-snippet','site-build','release-receipt'],
  'publish-proof': ['domain-spec-loader','unknown-resolver','design-intelligence','content-generation','schema-generator','placeholder-scan','site-assembler','posthog-snippet','site-build','client-source-publish','release-receipt'],
  'end-to-end': ['domain-spec-loader','unknown-resolver','design-intelligence','content-generation','schema-generator','placeholder-scan','site-assembler','posthog-snippet','site-build','client-source-publish','vercel-deploy','release-receipt','seo-baseline','visual-qa','release-receipt-finalizer','handoff-emitter'],
};
const REQUIRED_EVIDENCE: Record<ExecutionMode,string[]> = {
  plan: [],
  'local-proof': ['assembly','build','release'],
  'publish-proof': ['assembly','build','publication','release'],
  'end-to-end': ['assembly','build','publication','deployment','release','handoff'],
};


class TerminalConvergenceStage implements Stage {
  name = 'terminal-convergence';
  version = '1.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: false };
  constructor(private readonly mode: ExecutionMode, private readonly mandatory: string[], private readonly requiredEvidence: string[]) {}
  async run(ctx: BuildContext): Promise<void> {
    for (const stage of this.mandatory) {
      const result=ctx.stageResults.get(stage);
      if (!result?.ok || result.skipped) throw new BuildError('RELEASE_EVIDENCE_INCOMPLETE', `Mandatory stage did not converge: ${stage}`);
    }
    if (this.mode === 'plan') return;
    for (const kind of this.requiredEvidence) {
      if (!await ctx.evidenceStore.referenceFor(kind as never)) throw new BuildError('EVIDENCE_REFERENCE_MISSING', `Terminal convergence requires ${kind} evidence`);
    }
    if (this.mode === 'end-to-end') {
      await ctx.evidenceStore.loadValidatedReleaseBundle({requireStatus:'succeeded',requireMode:'end-to-end'});
      if (!await ctx.evidenceStore.readHandoff()) throw new BuildError('RELEASE_EVIDENCE_INCOMPLETE','End-to-end convergence requires persisted handoff evidence');
      if (ctx.autoRegisterSeoBot && !await ctx.evidenceStore.readRegistrationAck()) throw new BuildError('RELEASE_EVIDENCE_INCOMPLETE','Auto-registration requires a verified SEO-Bot acknowledgement');
    }
    ctx.evidenceIndex=await ctx.evidenceStore.transitionRunConverged();
  }
}

export function buildFactoryExecutionPlan(options: FactoryExecutionPlanOptions): FactoryExecutionPlan {
  const skips=[...new Set(options.skipStages ?? [])];
  const mandatory=MANDATORY[options.mode];
  const illegal=skips.filter(stage => mandatory.includes(stage));
  if (illegal.length) throw new BuildError('VALIDATION_FAILED', `Cannot skip mandatory ${options.mode} stages: ${illegal.join(', ')}`);
  const stages: Stage[]=[new DomainSpecLoaderStage(options.specPath)];
  if (options.provision) stages.push(new ProvisionClientStage(options.specPath,{persistDeployBlock:options.persistDeployBlock ?? true,rollbackCreatedResources:options.rollbackCreatedResources ?? true}));
  stages.push(new UnknownResolverStage(),new DesignIntelligenceStage(),new ContentGenerationStage(),new SchemaGeneratorStage(),new PlaceholderScanStage(),new SiteAssemblerStage(),new PostHogSnippetStage());
  if (options.mode !== 'plan') stages.push(new SiteBuildStage());
  if (options.mode === 'publish-proof' || options.mode === 'end-to-end') stages.push(new ClientSourcePublishStage());
  if (options.mode === 'end-to-end') stages.push(new VercelDeployStage());
  stages.push(new ReleaseReceiptStage());
  if (options.mode === 'end-to-end') stages.push(new SEOBaselineStage(),new VisualQAStage(),new ReleaseReceiptFinalizerStage(),new HandoffEmitterStage());
  stages.push(new TerminalConvergenceStage(options.mode, mandatory, REQUIRED_EVIDENCE[options.mode]));
  return {mode:options.mode,stages,mandatoryStages:[...mandatory,'terminal-convergence'],requiredEvidence:[...REQUIRED_EVIDENCE[options.mode]],skipStages:skips};
}

export async function executeFactoryPlan(ctx: BuildContext, plan: FactoryExecutionPlan): Promise<void> {
  const runner=new PipelineRunner(plan.skipStages);
  for (const stage of plan.stages) runner.register(stage);
  await runner.run(ctx);
}
