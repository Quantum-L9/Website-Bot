// L9_META: layer=workflow, role=durable_pipeline_wrapper, status=active, version=2.0.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inngest } from 'inngest';
import { parse } from 'yaml';
import { AgentBudgetGuard, AdmissionRejectedError, BudgetExceededError } from '../lib/budget-guard.js';
import { CompensationRegistry } from '../lib/compensation.js';
import { buildFactoryExecutionPlan, executeFactoryPlan } from '../pipeline/FactoryExecutionPlan.js';
import type { BuildContext, ExecutionMode } from '../pipeline/BuildContext.js';
import { validateDomainSpec } from '../pipeline/validateDomainSpec.js';
import { FileEvidenceStore } from '../pipeline/evidence/FileEvidenceStore.js';
import { createWebsiteFactoryLLM } from '../services/llm.js';

export const inngest = new Inngest({ id: 'website-bot' });

interface PipelineRequestedData {
  specPath: string;
  buildId: string;
  mode?: ExecutionMode;
  evidenceRoot?: string;
  costCapUsd?: number;
  autoRegisterSeoBot?: boolean;
  provision?: boolean;
}

const MODES: ExecutionMode[] = ['local-proof', 'publish-proof', 'end-to-end'];

export const websitePipeline = inngest.createFunction(
  {
    id: 'website-pipeline',
    name: 'Website Pipeline (Evidence Backed)',
    retries: 2,
    triggers: { event: 'website/pipeline.requested' },
  },
  async ({ event, step }: { event: { data: PipelineRequestedData }; step: any }) => {
    const data = event.data as PipelineRequestedData;
    if (!data.specPath || !data.buildId) throw new Error('specPath and buildId are required');
    const mode = data.mode ?? 'end-to-end';
    if (!MODES.includes(mode)) throw new Error(`durable pipeline mode must be one of ${MODES.join(', ')}`);
    const parsed = parse(readFileSync(data.specPath, 'utf-8')) as unknown;
    const spec = validateDomainSpec(parsed, data.specPath);
    const evidenceRoot = resolve(data.evidenceRoot ?? 'build/evidence', spec.client_id, data.buildId);
    const guard = new AgentBudgetGuard(data.buildId, data.costCapUsd ?? Number(process.env.COST_CAP_USD ?? 1), process.env.POSTGRES_URL);
    const compensation = new CompensationRegistry(data.buildId);

    return await step.run('run-evidence-backed-pipeline', async () => {
      const evidenceStore = new FileEvidenceStore({ rootDir: evidenceRoot, clientId: spec.client_id, buildId: data.buildId, mode });
      const ctx: BuildContext = {
        buildId: data.buildId,
        clientId: spec.client_id,
        domainSpec: spec,
        dryRun: false,
        mode,
        autoRegisterSeoBot: data.autoRegisterSeoBot ?? false,
        llm: createWebsiteFactoryLLM(spec.client_id),
        outputDir: '',
        evidenceStore,
        evidenceIndex: await evidenceStore.initialize(),
        resume: true,
        qualityEvidence: { seoBaseline: 'pending', visualQa: 'pending' },
        generatedContent: new Map(),
        generatedSchemas: new Map(),
        visualQaPassed: false,
        stageResults: new Map(),
        startedAt: new Date(),
      };
      const shouldProvision = Boolean(data.provision || (!spec.deploy && spec.provision?.enabled !== false && spec.provision));
      const plan = buildFactoryExecutionPlan({ mode, specPath: data.specPath, provision: shouldProvision });

      compensation.register('release-evidence', async () => {
        const failure = await evidenceStore.referenceFor('failure');
        if (!failure) throw new Error(`build ${data.buildId} failed without failure evidence`);
      });
      try {
        await guard.open();
        guard.reserve(0);
        await executeFactoryPlan(ctx, plan);
        guard.reconcile(0);
        const budget = guard.enforce();
        const index = await evidenceStore.readIndex();
        const release = await evidenceStore.referenceFor('release');
        await step.sendEvent('emit-pipeline-completed', {
          name: 'website/pipeline.completed',
          data: { buildId: data.buildId, clientId: spec.client_id, mode, evidenceRoot, evidenceIndex: index, releaseReceipt: release ?? null, budget },
        });
        compensation.clear();
        return { buildId: data.buildId, clientId: spec.client_id, mode, evidenceRoot, chainStatus: index.chain_status, releaseReceipt: release ?? null };
      } catch (error) {
        if (error instanceof BudgetExceededError || error instanceof AdmissionRejectedError) await compensation.compensate();
        const failure = await evidenceStore.referenceFor('failure');
        await step.sendEvent('emit-pipeline-failed', {
          name: 'website/pipeline.failed',
          data: { buildId: data.buildId, clientId: spec.client_id, mode, evidenceRoot, failureEvidence: failure ?? null },
        });
        throw error;
      } finally {
        await guard.close();
      }
    });
  },
);
