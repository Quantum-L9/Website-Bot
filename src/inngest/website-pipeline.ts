/**
 * website-pipeline.ts — Inngest durable function for the Website-Bot pipeline.
 *
 * Wraps the existing 10-stage PipelineRunner in a durable Inngest function and adds:
 *   - Budget admission/reservation/enforcement via AgentBudgetGuard (Postgres-backed ledger)
 *   - Compensation registration (saga rollback hook) around the deploy stage
 *   - Structured handoff event emission as the final step
 *
 * Scope note (2026-07-20 remediation): the original design of this file called
 * `VercelDeploy.deployPreview()` / `.promoteToProduction()` / `.rollback()` and a
 * `step.waitForEvent('website/production.approved')` human-approval gate between a
 * preview deploy and a production promotion. None of that API exists on
 * `VercelDeployStage` today — it performs one direct `target: 'production'` deploy
 * with no preview/promote split and no rollback method. Building that preview ->
 * approve -> promote -> rollback flow is a real, currently-missing feature (and
 * would put this ahead of the locked "preview-first only" deployment posture in
 * AGENTS.md, since VercelDeployStage itself doesn't do preview-first yet) — it is
 * intentionally NOT fabricated here. This function wraps the pipeline as it exists:
 * one durable step per full pipeline run, with budget guard + compensation-on-
 * failure + handoff wired at the Inngest layer. See docs/autonomy-architecture.md
 * "Implementation status" for the tracked gap.
 *
 * Also note: PipelineRunner opens/closes its own BuildDB (SQLite) connection once
 * per run() call, so the pipeline is wrapped as ONE Inngest step rather than one
 * step per stage — splitting it further would leave that SQLite handle spanning
 * step boundaries, which Inngest does not guarantee stays valid across replays.
 *
 * Prerequisites:
 *   npm install inngest pg
 *   Set env vars: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, POSTGRES_URL (optional)
 *
 * Register this function in your Inngest serve() handler:
 *   import { websitePipeline } from './src/inngest/website-pipeline.js';
 *   serve({ client: inngestClient, functions: [websitePipeline] });
 */

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { Inngest } from 'inngest';
import { AgentBudgetGuard, BudgetExceededError, AdmissionRejectedError } from '../lib/budget-guard.js';
import { CompensationRegistry } from '../lib/compensation.js';
import { PipelineRunner } from '../pipeline/PipelineRunner.js';
import { makeBuildId } from '../pipeline/BuildContext.js';
import { createWebsiteFactoryLLM } from '../services/llm.js';
import { DomainSpecLoaderStage } from '../stages/DomainSpecLoaderStage.js';
import { UnknownResolverStage } from '../stages/UnknownResolverStage.js';
import { DesignIntelligenceStage } from '../stages/DesignIntelligenceStage.js';
import { ContentGenerationStage } from '../stages/ContentGenerationStage.js';
import { SchemaGeneratorStage } from '../stages/SchemaGeneratorStage.js';
import { PostHogSnippetStage } from '../stages/PostHogSnippetStage.js';
import { VercelDeployStage } from '../stages/VercelDeployStage.js';
import { SEOBaselineStage } from '../stages/SEOBaselineStage.js';
import { VisualQAStage } from '../stages/VisualQAStage.js';
import { HandoffEmitterStage } from '../stages/HandoffEmitterStage.js';
import type { BuildContext, DomainSpec } from '../pipeline/BuildContext.js';

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

interface PipelineRunResult {
  buildId: string;
  deploymentUrl?: string;
  visualQaPassed: boolean;
  baselineRanks?: Record<string, number | null>;
  stageResults: Record<string, { ok: boolean; skipped?: boolean; error?: string }>;
}

export const websitePipeline = inngestClient.createFunction(
  {
    id: 'website-pipeline',
    name: 'Website Pipeline (Autonomous)',
    retries: 3,
    concurrency: { limit: 1 }, // Only one full pipeline at a time
    triggers: { event: 'website/pipeline.requested' },
  },
  async ({ event, step, logger }: { event: PipelineEvent; step: any; logger: any }) => {
    const { specPath, costCapUsd, dryRun = false, runId } = event.data;
    const jobId = `wp-${runId}`;
    const guard = new AgentBudgetGuard(jobId, costCapUsd, process.env.POSTGRES_URL);
    const saga = new CompensationRegistry(jobId);

    await guard.open(costCapUsd * 0.1); // Reject if initial forecast already exceeds cap

    // ── Resolve client_id up front (durable step; drives the buildId + LLM client) ──
    const clientId = await step.run('resolve-client-id', async () => {
      const raw = readFileSync(specPath, 'utf-8');
      const parsed = parse(raw) as { client_id?: string };
      return parsed.client_id ?? process.env.CLIENT_ID ?? 'unknown-client';
    });

    // Deploy is the one external mutation in the pipeline today; register its
    // compensation before running so a downstream failure (or budget exhaustion)
    // can attempt cleanup. VercelDeployStage has no rollback endpoint yet, so the
    // compensation action reports the deployment for manual rollback rather than
    // pretending an automated rollback exists.
    let lastDeploymentUrl: string | undefined;
    if (!dryRun) {
      saga.register('vercel-deploy', async () => {
        logger.warn(
          { jobId, deploymentUrl: lastDeploymentUrl },
          'Compensation: VercelDeployStage has no rollback API yet — manual rollback required',
        );
      });
    }

    // ── Run the full 10-stage pipeline as one durable step ──────────────────────
    let buildResult: PipelineRunResult;
    try {
      buildResult = await step.run('run-pipeline', async () => {
        guard.reserve(costCapUsd * 0.6);

        const buildId = makeBuildId(clientId);
        const ctx: BuildContext = {
          buildId,
          clientId,
          domainSpec: {} as DomainSpec, // populated by DomainSpecLoaderStage
          dryRun,
          autoRegisterSeoBot: false,
          llm: createWebsiteFactoryLLM(clientId),
          generatedContent: new Map(),
          generatedSchemas: new Map(),
          visualQaPassed: false,
          stageResults: new Map(),
          startedAt: new Date(),
        };

        const runner = new PipelineRunner()
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

        await runner.run(ctx);

        // PipelineRunner does not surface aggregate LLM spend from a single run()
        // call, so reconcile the full reservation as spent once the run succeeds.
        guard.reconcile(costCapUsd * 0.6);

        return {
          buildId,
          deploymentUrl: ctx.deploymentUrl,
          visualQaPassed: ctx.visualQaPassed,
          baselineRanks: ctx.baselineRanks,
          stageResults: Object.fromEntries(ctx.stageResults),
        };
      });
      lastDeploymentUrl = buildResult.deploymentUrl;
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof AdmissionRejectedError) {
        logger.error({ jobId, error: err.message }, 'Budget exhausted — compensating and aborting');
        const compensationResults = await saga.compensate();
        return {
          jobId,
          status: 'budget_exceeded',
          message: err.message,
          compensationResults,
        };
      }
      throw err;
    }

    if (dryRun) {
      logger.info({ jobId, mode: 'dry_run' }, 'Dry run complete');
      saga.clear();
      return { jobId, status: 'dry_run_complete', build: buildResult, budget: guard.enforce() };
    }

    // ── Emit SEO handoff event as its own durable step ───────────────────────────
    await step.run('emit-pipeline-completed', async () => {
      await inngestClient.send({
        name: 'website/pipeline.completed',
        data: {
          jobId,
          buildId: buildResult.buildId,
          deploymentUrl: buildResult.deploymentUrl,
          visualQaPassed: buildResult.visualQaPassed,
          baselineRanks: buildResult.baselineRanks,
          completedAt: new Date().toISOString(),
        },
      });
    });

    saga.clear();
    await guard.close();

    return {
      jobId,
      status: 'success',
      build: buildResult,
      budget: guard.enforce(),
    };
  },
);
