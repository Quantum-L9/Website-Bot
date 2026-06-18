// L9_META: layer=cli, role=pipeline_entry, status=active, version=2.0.0
import { DomainSpecLoaderStage } from '../src/stages/DomainSpecLoaderStage.js';
import { UnknownResolverStage } from '../src/stages/UnknownResolverStage.js';
import { DesignIntelligenceStage } from '../src/stages/DesignIntelligenceStage.js';
import { ContentGenerationStage } from '../src/stages/ContentGenerationStage.js';
import { SchemaGeneratorStage } from '../src/stages/SchemaGeneratorStage.js';
import { PostHogSnippetStage } from '../src/stages/PostHogSnippetStage.js';
import { VercelDeployStage } from '../src/stages/VercelDeployStage.js';
import { SEOBaselineStage } from '../src/stages/SEOBaselineStage.js';
import { VisualQAStage } from '../src/stages/VisualQAStage.js';
import { HandoffEmitterStage } from '../src/stages/HandoffEmitterStage.js';
import { PipelineRunner } from '../src/pipeline/PipelineRunner.js';
import { makeBuildId } from '../src/pipeline/BuildContext.js';
import { createWebsiteFactoryLLM } from '../src/services/llm.js';
import type { BuildContext } from '../src/pipeline/BuildContext.js';
import type { DomainSpec } from '../src/pipeline/BuildContext.js';

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const autoRegisterSeoBot = args.includes('--auto-register-seo-bot');
const specPath = args.find(a => a.startsWith('--spec='))?.replace('--spec=', '')
  ?? 'domain_spec/domain_spec.normalized.yaml';
const skipArg = args.find(a => a.startsWith('--skip='));
const skipStages = skipArg ? skipArg.replace('--skip=', '').split(',') : [];

if (dryRun) console.log('[DRY RUN] No external calls or file writes will be made');

// ── Bootstrap context ───────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID ?? 'unknown-client';
const buildId = makeBuildId(CLIENT_ID);
const llm = createWebsiteFactoryLLM(CLIENT_ID);

const ctx: BuildContext = {
  buildId,
  clientId: CLIENT_ID,
  domainSpec: {} as DomainSpec, // populated by DomainSpecLoaderStage
  dryRun,
  autoRegisterSeoBot,
  llm,
  generatedContent: new Map(),
  generatedSchemas: new Map(),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};

// ── Build pipeline ──────────────────────────────────────────────────────────
const runner = new PipelineRunner(skipStages)
  .register(new DomainSpecLoaderStage(specPath))
  .register(new UnknownResolverStage())
  .register(new DesignIntelligenceStage())
  .register(new ContentGenerationStage())
  .register(new SchemaGeneratorStage())
  .register(new PostHogSnippetStage())
  .register(new VercelDeployStage())
  .register(new SEOBaselineStage())
  .register(new VisualQAStage())
  .register(new HandoffEmitterStage());

// ── Execute ─────────────────────────────────────────────────────────────────
runner.run(ctx)
  .then(() => {
    console.log(`Pipeline complete. Build: ${buildId}`);
    if (ctx.deploymentUrl) console.log(`Deployment: ${ctx.deploymentUrl}`);
    process.exit(0);
  })
  .catch((err: Error) => {
    console.error(`Pipeline FAILED: ${err.message}`);
    process.exit(1);
  });
