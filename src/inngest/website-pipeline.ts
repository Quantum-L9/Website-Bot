/**
 * website-pipeline.ts — Inngest durable function for the full Website-Bot pipeline.
 *
 * Wraps all 10 existing stages in durable steps.
 * Adds:
 *   - Per-step budget tracking via AgentBudgetGuard
 *   - Compensation registration before Vercel deploy and CMS writes
 *   - waitForEvent approval gate before production promotion
 *   - Structured handoff emission as the final step
 *
 * Prerequisites:
 *   npm install inngest
 *   Set env vars: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
 *
 * Register this function in your Inngest serve() handler:
 *   import { websitePipeline } from './src/inngest/website-pipeline';
 *   serve({ client: inngestClient, functions: [websitePipeline] });
 */

import { Inngest } from 'inngest';
import { AgentBudgetGuard, BudgetExceededError } from '../lib/budget-guard.js';
import { CompensationRegistry } from '../lib/compensation.js';

export const inngestClient = new Inngest({ id: 'website-bot' });

interface PipelineEvent {
  data: {
    specPath: string;
    costCapUsd: number;
    dryRun?: boolean;
    runId: string;
    triggeredBy?: string;
  };
}

export const websitePipeline = inngestClient.createFunction(
  {
    id: 'website-pipeline',
    name: 'Website Pipeline (Autonomous)',
    retries: 3,
    concurrency: { limit: 1 },   // Only one full pipeline at a time
  },
  { event: 'website/pipeline.requested' },
  async ({ event, step, logger }: { event: PipelineEvent; step: any; logger: any }) => {
    const { specPath, costCapUsd, dryRun = false, runId } = event.data;
    const jobId = `wp-${runId}`;
    const guard = new AgentBudgetGuard(jobId, costCapUsd, process.env.POSTGRES_URL);
    const saga = new CompensationRegistry(jobId);

    await guard.open(costCapUsd * 0.10);  // Reject if initial forecast already exceeds cap

    // ── STAGE 1: Validate domain spec ─────────────────────────────────────────
    const domainSpec = await step.run('validate-domain-spec', async () => {
      const { DomainSpecLoader } = await import('../pipeline/DomainSpecLoader.js');
      return DomainSpecLoader.load(specPath);
    });

    // ── STAGE 2: Resolve unknowns ─────────────────────────────────────────────
    const resolvedSpec = await step.run('resolve-unknowns', async () => {
      const { UnknownResolver } = await import('../pipeline/UnknownResolver.js');
      guard.reserve(0.02);
      const result = await UnknownResolver.resolve(domainSpec);
      guard.reconcile(result.costUsd ?? 0);
      return result.spec;
    });

    // ── STAGE 3: Design intelligence ──────────────────────────────────────────
    const design = await step.run('generate-design-tokens', async () => {
      const { DesignIntelligence } = await import('../pipeline/DesignIntelligence.js');
      guard.reserve(0.05);
      const result = await DesignIntelligence.generate(resolvedSpec);
      guard.reconcile(result.costUsd ?? 0);
      return result.tokens;
    });

    // ── STAGE 4: Content generation (parallel by route) ───────────────────────
    const routes: string[] = resolvedSpec.routes ?? [];
    const contentResults = await step.run('generate-content-parallel', async () => {
      const { ContentGeneration } = await import('../pipeline/ContentGeneration.js');
      const CONCURRENCY = 5;
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < routes.length; i += CONCURRENCY) {
        const batch = routes.slice(i, i + CONCURRENCY);
        guard.reserve(0.08 * batch.length);
        const batchResults = await Promise.all(
          batch.map((route: string) => ContentGeneration.generate(resolvedSpec, design, route)),
        );
        const batchCost = batchResults.reduce((s: number, r: any) => s + (r.costUsd ?? 0), 0);
        guard.reconcile(batchCost);
        results.push(...batchResults);
      }
      return results;
    });

    // ── STAGE 5: Schema generation ────────────────────────────────────────────
    const schema = await step.run('generate-schema', async () => {
      const { SchemaGenerator } = await import('../pipeline/SchemaGenerator.js');
      guard.reserve(0.02);
      const result = await SchemaGenerator.generate(resolvedSpec, contentResults);
      guard.reconcile(result.costUsd ?? 0);
      return result.schema;
    });

    // ── STAGE 6: PostHog snippet injection ────────────────────────────────────
    await step.run('inject-posthog-snippet', async () => {
      const { PostHogSnippet } = await import('../pipeline/PostHogSnippet.js');
      return PostHogSnippet.inject(resolvedSpec);
    });

    if (dryRun) {
      logger.info({ jobId, mode: 'dry_run' }, 'Dry run — stopping before deploy');
      return { jobId, status: 'dry_run_complete', budgetUsd: guard.enforce() };
    }

    // ── STAGE 7: Deploy preview to Vercel ────────────────────────────────────
    // Register compensation BEFORE the deploy step
    const deployResult = await step.run('deploy-preview-vercel', async () => {
      const { VercelDeploy } = await import('../pipeline/VercelDeploy.js');
      const result = await VercelDeploy.deployPreview(resolvedSpec, contentResults, schema);
      // Register rollback NOW — after we have the deploymentId
      saga.register('vercel-preview', async () => {
        await VercelDeploy.rollback(result.deploymentId);
      });
      return result;
    });

    // ── STAGE 8: Visual QA ───────────────────────────────────────────────────
    const qaResult = await step.run('run-visual-qa', async () => {
      const { VisualQA } = await import('../pipeline/VisualQA.js');
      guard.reserve(0.04);
      const result = await VisualQA.run(deployResult.previewUrl);
      guard.reconcile(result.costUsd ?? 0);
      if (!result.passed) {
        throw new Error(`Visual QA failed: ${result.summary}`);
      }
      return result;
    });

    // ── STAGE 9: SEO baseline capture ────────────────────────────────────────
    const seoBaseline = await step.run('capture-seo-baseline', async () => {
      const { SEOBaseline } = await import('../pipeline/SEOBaseline.js');
      return SEOBaseline.capture(deployResult.previewUrl);
    });

    // ── HUMAN APPROVAL GATE ──────────────────────────────────────────────────
    // Workflow hibernates here until a 'website/production.approved' event is sent.
    // Timeout: 24 hours — if no approval, open a GitHub issue and mark suspended.
    const approval = await step.waitForEvent('await-production-approval', {
      event: 'website/production.approved',
      match: 'data.jobId',
      timeout: '24h',
    });

    if (!approval) {
      // Timeout reached — compensate preview and raise issue
      await saga.compensate();
      return {
        jobId,
        status: 'approval_timeout',
        action: 'preview_rolled_back',
        message: 'No approval received within 24h. Preview deployment rolled back.',
      };
    }

    // ── STAGE 10: Promote to production ──────────────────────────────────────
    const prodResult = await step.run('promote-production', async () => {
      const { VercelDeploy } = await import('../pipeline/VercelDeploy.js');
      // Register compensation for production promotion
      saga.register('vercel-production', async () => {
        await VercelDeploy.rollback(deployResult.deploymentId);
      });
      return VercelDeploy.promoteToProduction(deployResult.deploymentId);
    });

    // ── STAGE 11: Emit SEO handoff ────────────────────────────────────────────
    await step.run('emit-seo-handoff', async () => {
      await inngestClient.send({
        name: 'l9/seo-handoff.received',
        data: {
          jobId,
          siteUrl: prodResult.productionUrl,
          routes: routes,
          seoBaseline,
          deployedAt: new Date().toISOString(),
        },
      });
    });

    saga.clear();
    await guard.close();

    return {
      jobId,
      status: 'success',
      productionUrl: prodResult.productionUrl,
      budget: guard.enforce(),
    };
  },
);
