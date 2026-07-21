// L9_META: layer=pipeline, role=orchestration_engine, status=active, version=4.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from './BuildError.js';
import type Database from 'better-sqlite3';
import { getBuildDb, llmUsage, syncEvidenceIndexToDb } from './BuildDB.js';
import { checkpointDigest, checkpointIsValid, type StageCheckpoint } from './StageCheckpoint.js';
import type { BuildContext } from './BuildContext.js';
import { sanitizeEvidenceDetails, sanitizeEvidenceText } from './evidence/EvidenceCanonicalizer.js';
import type { EvidenceKind, EvidenceReference } from './evidence/EvidenceReference.js';
import type { StageFailureEvidence } from './evidence/StageFailureEvidence.js';

const logger = createModuleLogger('pipeline:runner');

export interface StageEvidenceDeclaration {
  inputs(ctx: BuildContext): EvidenceKind[];
  outputs(ctx: BuildContext): EvidenceKind[];
  resumable: boolean;
  externalMutation: boolean;
}

export interface Stage {
  name: string;
  version?: string;
  evidence?: StageEvidenceDeclaration;
  canResume?(ctx: BuildContext, checkpoint: StageCheckpoint): Promise<boolean>;
  run(ctx: BuildContext): Promise<void>;
}

export class PipelineRunner {
  private readonly stages: Stage[] = [];
  private readonly skipSet: Set<string>;

  constructor(skipStages: string[] = []) {
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
    let errorMessage: string | undefined;

    try {
      if (!ctx.dryRun) {
        sqlite.prepare(`
          INSERT INTO builds (id, client_id, status, started_at, dry_run, error_code, error_msg)
          VALUES (?, ?, 'running', ?, 0, NULL, NULL)
          ON CONFLICT(id) DO UPDATE SET status='running', completed_at=NULL, error_code=NULL, error_msg=NULL
        `).run(ctx.buildId, ctx.clientId, ctx.startedAt.toISOString());
        syncEvidenceIndexToDb(sqlite, await ctx.evidenceStore.readIndex(), ctx.evidenceStore.rootDir);
      }

      for (const stage of this.stages) {
        if (this.skipSet.has(stage.name)) {
          await this.recordSkip(ctx, sqlite, stage.name, 'CLI flag');
          continue;
        }

        const inputEvidence = await this.requireEvidence(ctx, stage.evidence?.inputs(ctx) ?? [], stage.name, 'input');
        const checkpoint = await ctx.evidenceStore.readCheckpoint(stage.name);
        if (await this.resumeStage(ctx, stage, checkpoint)) {
          await this.recordSkip(ctx, sqlite, stage.name, 'validated evidence checkpoint');
          continue;
        }

        const attempt = (checkpoint?.attempt ?? 0) + 1;
        const startedAt = new Date();
        const runRow = !ctx.dryRun
          ? sqlite.prepare(`INSERT INTO stage_runs (build_id, stage_name, status, ran_at) VALUES (?, ?, 'running', ?)`)
            .run(ctx.buildId, stage.name, startedAt.toISOString()).lastInsertRowid
          : undefined;
        const startedMs = Date.now();
        logger.info({ stage: stage.name, version: stage.version, attempt }, 'Stage start');

        try {
          await stage.run(ctx);
          const outputEvidence = await this.requireEvidence(ctx, stage.evidence?.outputs(ctx) ?? [], stage.name, 'output');
          await this.ensureCheckpoint(ctx, stage, checkpoint, attempt, startedAt, inputEvidence, outputEvidence);
          const durationMs = Date.now() - startedMs;
          ctx.stageResults.set(stage.name, { ok: true });
          ctx.evidenceIndex = await ctx.evidenceStore.readIndex();
          ctx.evidenceIndex.last_successful_stage = stage.name;
          ctx.evidenceIndex.failed_stage = undefined;
          if (!ctx.dryRun) {
            sqlite.prepare(`UPDATE stage_runs SET status='ok', duration_ms=? WHERE id=?`).run(durationMs, runRow);
            syncEvidenceIndexToDb(sqlite, ctx.evidenceIndex, ctx.evidenceStore.rootDir);
          }
          logger.info({ stage: stage.name, durationMs, evidenceRevision: ctx.evidenceIndex.revision }, 'Stage OK');
        } catch (error) {
          const durationMs = Date.now() - startedMs;
          const buildError = error instanceof BuildError ? error : null;
          const message = error instanceof Error ? error.message : String(error);
          ctx.stageResults.set(stage.name, { ok: false, error: message });
          await this.persistFailure(ctx, stage, buildError, message, inputEvidence, startedAt, attempt);
          if (!ctx.dryRun) {
            sqlite.prepare(`UPDATE stage_runs SET status='failed', duration_ms=?, error_msg=? WHERE id=?`).run(durationMs, message, runRow);
            ctx.evidenceIndex = await ctx.evidenceStore.readIndex();
            syncEvidenceIndexToDb(sqlite, ctx.evidenceIndex, ctx.evidenceStore.rootDir);
          }
          logger.error({ stage: stage.name, durationMs, error: message }, 'Stage FAILED');
          if (!buildError?.recoverable) {
            finalStatus = 'failed';
            errorCode = buildError?.code ?? 'UNKNOWN';
            errorMessage = message;
            break;
          }
          finalStatus = 'partial';
        }
      }

      if (!ctx.dryRun) {
        for (const record of ctx.llm.flushUsage()) {
          db.insert(llmUsage).values({
            buildId: ctx.buildId,
            stage: record.stage,
            taskType: record.taskType,
            model: record.model,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            costUsd: record.costUsd,
            recordedAt: record.recordedAt,
          }).run();
        }
        sqlite.prepare(`
          UPDATE builds SET status=?, completed_at=?, deploy_url=?, error_code=?, error_msg=? WHERE id=?
        `).run(finalStatus, new Date().toISOString(), ctx.deploymentUrl ?? null, errorCode ?? null, errorMessage ?? null, ctx.buildId);
      }
    } finally {
      sqlite.close();
    }

    if (finalStatus === 'failed') throw new BuildError(errorCode as never, errorMessage ?? 'Pipeline failed');
    logger.info({ buildId: ctx.buildId, status: finalStatus, evidenceRoot: ctx.evidenceStore.rootDir }, 'Pipeline complete');
  }

  private async requireEvidence(
    ctx: BuildContext,
    kinds: EvidenceKind[],
    stageName: string,
    direction: 'input' | 'output',
  ): Promise<EvidenceReference[]> {
    if (ctx.dryRun) return [];
    const references: EvidenceReference[] = [];
    for (const kind of kinds) {
      const reference = await ctx.evidenceStore.referenceFor(kind);
      if (!reference) throw new BuildError('EVIDENCE_REFERENCE_MISSING', `${stageName} requires ${direction} ${kind} evidence`);
      if (!await ctx.evidenceStore.verifyReference(reference)) {
        throw new BuildError('EVIDENCE_DIGEST_MISMATCH', `${stageName} ${direction} ${kind} evidence is missing or corrupt`);
      }
      references.push(reference);
    }
    return references;
  }

  private async resumeStage(ctx: BuildContext, stage: Stage, checkpoint?: StageCheckpoint): Promise<boolean> {
    if (!ctx.resume || !stage.evidence?.resumable || !checkpoint) return false;
    if (!await checkpointIsValid(ctx, checkpoint)) return false;
    if (checkpoint.stageVersion && stage.version && checkpoint.stageVersion !== stage.version) return false;
    if (stage.evidence.externalMutation) {
      if (!stage.canResume || !await stage.canResume(ctx, checkpoint)) {
        throw new BuildError('EVIDENCE_RESUME_CONFLICT', `External state re-verification failed for ${stage.name}`);
      }
    }
    return true;
  }

  private async ensureCheckpoint(
    ctx: BuildContext,
    stage: Stage,
    previous: StageCheckpoint | undefined,
    attempt: number,
    startedAt: Date,
    inputs: EvidenceReference[],
    outputs: EvidenceReference[],
  ): Promise<void> {
    if (ctx.dryRun) return;
    const current = await ctx.evidenceStore.readCheckpoint(stage.name);
    if (current && current !== previous && await checkpointIsValid(ctx, current)) return;
    await ctx.evidenceStore.writeCheckpoint({
      schema: 'website-bot.stage-checkpoint/v1',
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      stageVersion: stage.version,
      attempt,
      inputEvidence: inputs,
      outputEvidence: outputs,
      inputDigest: checkpointDigest(inputs),
      outputDigest: checkpointDigest(outputs),
      status: 'passed',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    });
  }

  private async persistFailure(
    ctx: BuildContext,
    stage: Stage,
    error: BuildError | null,
    message: string,
    inputEvidence: EvidenceReference[],
    startedAt: Date,
    attempt: number,
  ): Promise<void> {
    if (ctx.dryRun) return;
    const failure: StageFailureEvidence = {
      schema: 'website-bot.stage-failure/v1',
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      attempt,
      code: error?.code ?? 'UNKNOWN',
      message: sanitizeEvidenceText(message),
      recoverable: error?.recoverable ?? false,
      inputEvidence,
      sanitizedDetails: error?.context
        ? sanitizeEvidenceDetails(error.context) as Record<string, unknown>
        : undefined,
      failedAt: new Date().toISOString(),
    };
    const failureRecord = await ctx.evidenceStore.writeFailure(failure);
    const outputEvidence = [{
      kind: failureRecord.kind,
      schema: failureRecord.schema,
      logical_id: failureRecord.logicalId,
      relative_path: failureRecord.relativePath,
      sha256: failureRecord.sha256,
    }];
    await ctx.evidenceStore.writeCheckpoint({
      schema: 'website-bot.stage-checkpoint/v1',
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      stageVersion: stage.version,
      attempt,
      inputEvidence,
      outputEvidence,
      inputDigest: checkpointDigest(inputEvidence),
      outputDigest: checkpointDigest(outputEvidence),
      status: 'failed',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    });
  }

  private async recordSkip(
    ctx: BuildContext,
    sqlite: Database.Database,
    stageName: string,
    reason: string,
  ): Promise<void> {
    ctx.stageResults.set(stageName, { ok: true, skipped: true });
    if (!ctx.dryRun) {
      sqlite.prepare(`
        INSERT INTO stage_runs (build_id, stage_name, status, error_msg, ran_at)
        VALUES (?, ?, 'skipped', ?, ?)
      `).run(ctx.buildId, stageName, reason, new Date().toISOString());
    }
  }
}
