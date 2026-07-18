// L9_META: layer=pipeline, role=orchestration_engine, status=active, version=2.0.0
import { eq } from 'drizzle-orm';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from './BuildError.js';
import { getBuildDb, builds, stageRuns, llmUsage as llmUsageTable } from './BuildDB.js';
import type { BuildContext } from './BuildContext.js';

const logger = createModuleLogger('pipeline:runner');

export interface Stage {
  name: string;
  run(ctx: BuildContext): Promise<void>;
}

export class PipelineRunner {
  private stages: Stage[] = [];
  private skipSet: Set<string>;

  constructor(private readonly skipStages: string[] = []) {
    this.skipSet = new Set(skipStages);
  }

  register(stage: Stage): this {
    this.stages.push(stage);
    return this;
  }

  async run(ctx: BuildContext): Promise<void> {
    const { db, sqlite } = getBuildDb();

    let finalStatus: 'success' | 'failed' | 'partial' = 'success';
    let errorCode: string | undefined;
    let errorMsg: string | undefined;

    try {
    // Insert build record
    if (!ctx.dryRun) {
      db.insert(builds).values({
        id: ctx.buildId,
        clientId: ctx.clientId,
        status: 'running',
        startedAt: ctx.startedAt.toISOString(),
        dryRun: ctx.dryRun,
      }).run();
    }

    for (const stage of this.stages) {
      if (this.skipSet.has(stage.name)) {
        logger.info({ stage: stage.name }, 'Stage skipped (CLI flag)');
        ctx.stageResults.set(stage.name, { ok: true, skipped: true });
        if (!ctx.dryRun) {
          db.insert(stageRuns).values({
            buildId: ctx.buildId, stageName: stage.name, status: 'skipped',
            ranAt: new Date().toISOString(),
          }).run();
        }
        continue;
      }

      const t0 = Date.now();
      logger.info({ stage: stage.name }, 'Stage start');

      try {
        await stage.run(ctx);
        const durationMs = Date.now() - t0;
        ctx.stageResults.set(stage.name, { ok: true });
        logger.info({ stage: stage.name, durationMs }, 'Stage OK');

        if (!ctx.dryRun) {
          db.insert(stageRuns).values({
            buildId: ctx.buildId, stageName: stage.name, status: 'ok',
            durationMs, ranAt: new Date().toISOString(),
          }).run();
        }
      } catch (err) {
        const durationMs = Date.now() - t0;
        const be = err instanceof BuildError ? err : null;
        const msg = err instanceof Error ? err.message : String(err);
        ctx.stageResults.set(stage.name, { ok: false, error: msg });
        logger.error({ stage: stage.name, durationMs, err }, 'Stage FAILED');

        if (!ctx.dryRun) {
          db.insert(stageRuns).values({
            buildId: ctx.buildId, stageName: stage.name, status: 'failed',
            durationMs, errorMsg: msg, ranAt: new Date().toISOString(),
          }).run();
        }

        if (!be?.recoverable) {
          finalStatus = 'failed';
          errorCode = be?.code ?? 'UNKNOWN';
          errorMsg = msg;
          break;
        }
        finalStatus = 'partial';
      }
    }

    // ── V-04 FIX: flush LLM usage into llm_usage table ────────────────────
    if (!ctx.dryRun) {
      const records = ctx.llm.flushUsage();
      for (const rec of records) {
        db.insert(llmUsageTable).values({
          buildId: ctx.buildId,
          stage: rec.stage,
          taskType: rec.taskType,
          model: rec.model,
          inputTokens: rec.inputTokens,
          outputTokens: rec.outputTokens,
          costUsd: rec.costUsd,
          recordedAt: rec.recordedAt,
        }).run();
      }
      logger.info({ count: records.length }, 'LLM usage flushed to DB');
    }

    // Update build record
    if (!ctx.dryRun) {
      db.update(builds)
        .set({
          status: finalStatus,
          completedAt: new Date().toISOString(),
          deployUrl: ctx.deploymentUrl,
          errorCode,
          errorMsg,
        })
        .where(eq(builds.id, ctx.buildId))
        .run();
    }

    } finally {
      sqlite.close();
    }

    if (finalStatus === 'failed') throw new BuildError(errorCode as never, errorMsg ?? 'Pipeline failed');
    logger.info({ buildId: ctx.buildId, status: finalStatus }, 'Pipeline complete');
  }
}
