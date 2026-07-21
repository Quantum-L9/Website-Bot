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
import { FileEvidenceStore } from '../src/pipeline/evidence/FileEvidenceStore.js';
import { MemoryEvidenceStore } from '../src/pipeline/evidence/MemoryEvidenceStore.js';
import type { BuildContext, ExecutionMode } from '../src/pipeline/BuildContext.js';
import type { DomainSpec } from '../src/pipeline/BuildContext.js';
import type { EvidenceStore } from '../src/pipeline/evidence/EvidenceStore.js';

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const resume = args.includes('--resume');
const autoRegisterSeoBot = args.includes('--auto-register-seo-bot');
// Execution mode. --dry-run maps to `plan` (in-memory, no writes/mutations); the
// default full run is `end-to-end` (preserving today's `npm run pipeline`). The
// new lighter modes (local-proof, publish-proof) are additive.
const modeArg = args.find(a => a.startsWith('--mode='))?.replace('--mode=', '') as ExecutionMode | undefined;
const mode: ExecutionMode = dryRun ? 'plan' : (modeArg ?? 'end-to-end');
const explicitSpec = args.find(a => a.startsWith('--spec='))?.replace('--spec=', '');
// Default targets the bundled reference client under examples/. Real client
// builds pass --spec=<path> (or SPEC_PATH/CLIENT_ID via the workflows).
const DEFAULT_SPEC_PATH = 'examples/supplemental-insurance-pros/domain_spec.normalized.yaml';
const specPath = explicitSpec ?? DEFAULT_SPEC_PATH;
const skipArg = args.find(a => a.startsWith('--skip='));
const skipStages = skipArg ? skipArg.replace('--skip=', '').split(',') : [];

if (!explicitSpec) {
  console.warn(
    `[spec] no --spec provided; defaulting to ${DEFAULT_SPEC_PATH}. ` +
    `Pass --spec=<flat DomainSpec> (e.g. fixtures/ci-test-spec.yaml) to override.`,
  );
}

if (dryRun) console.log('[DRY RUN] No external calls or file writes will be made');

// ── Bootstrap context ───────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID ?? 'unknown-client';
const buildId = makeBuildId(CLIENT_ID);
const llm = createWebsiteFactoryLLM(CLIENT_ID);

// Evidence authority: plan/dry uses an in-memory, mutation-free store (no disk
// evidence writes); every other mode persists to the canonical evidence root.
const evidenceStore: EvidenceStore = mode === 'plan'
  ? new MemoryEvidenceStore(CLIENT_ID, buildId, mode)
  : new FileEvidenceStore({
      clientId: CLIENT_ID,
      buildId,
      mode,
      evidenceRoot: process.env.EVIDENCE_ROOT ?? 'build/evidence',
    });
const evidenceIndex = await evidenceStore.initialize();

const ctx: BuildContext = {
  buildId,
  clientId: CLIENT_ID,
  domainSpec: {} as DomainSpec, // populated by DomainSpecLoaderStage
  dryRun,
  mode,
  autoRegisterSeoBot,
  llm,
  outputDir: process.env.OUTPUT_DIR ?? `build/sites/${CLIENT_ID}`,
  evidenceStore,
  evidenceIndex,
  resume,
  qualityEvidence: { seoBaseline: 'pending', visualQa: 'pending' },
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
