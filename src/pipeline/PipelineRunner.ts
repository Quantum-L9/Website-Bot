// L9_META: layer=pipeline, role=orchestration_engine, status=active, version=4.1.0
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import type Database from "better-sqlite3";
import { createModuleLogger } from "../core/logger.js";
import { MissingAltTextError, resolveAltText } from "../services/images/ImageAltText.js";
import { budgetedLLM } from "./BudgetedLLM.js";
import { type BuildContext, clientAssetRoot, clientPersistentAssetRoot } from "./BuildContext.js";
import { getBuildDb, llmUsage, syncEvidenceIndexToDb } from "./BuildDB.js";
import { BuildError } from "./BuildError.js";
import type { EconomicsRunStatus } from "./evidence/BuildEconomics.js";
import { sanitizeEvidenceDetails, sanitizeEvidenceText } from "./evidence/EvidenceCanonicalizer.js";
import type { EvidenceKind, EvidenceReference } from "./evidence/EvidenceReference.js";
import {
  type ImageAssetManifest,
  type ResolvedImageAsset,
  variantStagedPath,
} from "./evidence/ImageAssetManifest.js";
import type { StageFailureEvidence } from "./evidence/StageFailureEvidence.js";
import { admitPaidStage } from "./PaidStageAdmission.js";
import { checkpointDigest, checkpointIsValid, type StageCheckpoint } from "./StageCheckpoint.js";

const logger = createModuleLogger("pipeline:runner");

/**
 * Resolve the on-disk path for a persisted generated asset, preferring the
 * persistent prompt-hash cache, then the per-build copy, then the original.
 */
/** Alt text for a hydrated asset: recorded alt, operator slot alt, or section-derived. */
function hydratedAltText(ctx: BuildContext, asset: ImageAssetManifest["assets"][number]): string {
  const slot = { id: asset.slotId, placement: asset.placement };
  const slotAlt = ctx.domainSpec.assets?.imageSlots?.find(
    (candidate) => candidate.id === asset.slotId,
  )?.altText;
  try {
    return resolveAltText(slot, [asset.altText, slotAlt], {
      businessName: ctx.domainSpec.business_name,
      routes: ctx.domainSpec.routes,
    });
  } catch (error) {
    if (error instanceof MissingAltTextError)
      throw new BuildError("VALIDATION_FAILED", error.message);
    throw error;
  }
}

function resolveAssetAbsolutePath(
  asset: ImageAssetManifest["assets"][number],
  generatedRoot: string,
  buildGeneratedRoot: string,
): string {
  // ImageGenerationStage stages the optimised file as
  // `<promptHash>-<sha256[0:16]>.<ext>`; `<promptHash>.png` is the raw provider
  // output, whose bytes differ from the manifest's sha256.
  const extension = asset.outputPath.split(".").pop();
  const optimizedName = asset.promptHash
    ? `${asset.promptHash}-${asset.sha256.slice(0, 16)}.${extension}`
    : undefined;
  for (const root of [generatedRoot, buildGeneratedRoot]) {
    const candidate = optimizedName ? resolve(root, optimizedName) : undefined;
    if (candidate && existsSync(candidate)) return candidate;
  }
  const hashedPersistent = asset.promptHash
    ? resolve(generatedRoot, `${asset.promptHash}.png`)
    : undefined;
  const hashedBuild = asset.promptHash
    ? resolve(buildGeneratedRoot, `${asset.promptHash}.png`)
    : undefined;
  if (hashedPersistent && existsSync(hashedPersistent)) return hashedPersistent;
  if (hashedBuild && existsSync(hashedBuild)) return hashedBuild;
  const original = asset.originalPath;
  if (original && existsSync(original)) return original;
  return hashedPersistent ?? original ?? "";
}

export interface StageEvidenceDeclaration {
  inputs(ctx: BuildContext): EvidenceKind[];
  outputs(ctx: BuildContext): EvidenceKind[];
  resumable: boolean;
  externalMutation: boolean;
}

export interface StageRunResult {
  externalId?: string;
}

export interface Stage {
  name: string;
  version?: string;
  evidence?: StageEvidenceDeclaration;
  canResume?(ctx: BuildContext, checkpoint: StageCheckpoint): Promise<boolean>;
  run(ctx: BuildContext): Promise<void | StageRunResult>;
}

export class PipelineRunner {
  private readonly stages: Stage[] = [];
  private readonly skipSet: Set<string>;
  private reusing = false;

  constructor(skipStages: string[] = []) {
    this.skipSet = new Set(skipStages);
  }

  register(stage: Stage): this {
    this.stages.push(stage);
    return this;
  }

  async run(ctx: BuildContext): Promise<void> {
    const { db, sqlite } = getBuildDb();
    let finalStatus: "success" | "failed" | "partial" = "success";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    const ledger = ctx.spendLedger;
    let economicsStatus: EconomicsRunStatus = "failed";
    // Strict resume applies while the run is still inside the prefix of stages
    // the build already completed; the first stage that cannot be reused is the
    // resume frontier and everything from it on executes normally.
    this.reusing = Boolean(ledger && ctx.resume);

    try {
      if (ledger) {
        ledger.beginRun(ctx.resume);
        ctx.llm = budgetedLLM(ctx.llm, ledger);
      }
      await this.recordBuildStart(ctx, sqlite);

      for (const stage of this.stages) {
        if (this.skipSet.has(stage.name)) {
          await this.recordSkip(ctx, sqlite, stage.name, "CLI flag");
          continue;
        }
        const checkpoint = this.reusing
          ? await this.readCheckpointStrict(ctx, stage.name)
          : await ctx.evidenceStore.readCheckpoint(stage.name);
        const result = await this.runStage(ctx, sqlite, stage, checkpoint);
        if (result.status !== "failed") continue;
        const { recoverable, code, message } = result.failed;
        if (!recoverable) {
          finalStatus = "failed";
          errorCode = code ?? "UNKNOWN";
          errorMessage = message;
          break;
        }
        finalStatus = "partial";
      }

      await this.recordBuildFinish(ctx, db, sqlite, finalStatus, errorCode, errorMessage);
      economicsStatus =
        errorCode === "BUDGET_EXCEEDED"
          ? "budget_exceeded"
          : finalStatus === "failed"
            ? "failed"
            : finalStatus;
    } finally {
      ledger?.finishRun(economicsStatus);
      sqlite.close();
    }

    if (finalStatus === "failed")
      throw new BuildError(errorCode as never, errorMessage ?? "Pipeline failed");
    logger.info(
      { buildId: ctx.buildId, status: finalStatus, evidenceRoot: ctx.evidenceStore.rootDir },
      "Pipeline complete",
    );
  }

  private async recordBuildStart(ctx: BuildContext, sqlite: Database.Database): Promise<void> {
    if (ctx.dryRun) return;
    sqlite
      .prepare(`
      INSERT INTO builds (id, client_id, status, started_at, dry_run, error_code, error_msg)
      VALUES (?, ?, 'running', ?, 0, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET status='running', completed_at=NULL, error_code=NULL, error_msg=NULL
    `)
      .run(ctx.buildId, ctx.clientId, ctx.startedAt.toISOString());
    syncEvidenceIndexToDb(sqlite, await ctx.evidenceStore.readIndex(), ctx.evidenceStore.rootDir);
  }

  private async recordBuildFinish(
    ctx: BuildContext,
    db: ReturnType<typeof getBuildDb>["db"],
    sqlite: Database.Database,
    finalStatus: "success" | "failed" | "partial",
    errorCode: string | undefined,
    errorMessage: string | undefined,
  ): Promise<void> {
    if (ctx.dryRun) return;
    for (const record of ctx.llm.flushUsage()) {
      db.insert(llmUsage)
        .values({
          buildId: ctx.buildId,
          stage: record.stage,
          taskType: record.taskType,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
          recordedAt: record.recordedAt,
        })
        .run();
    }
    sqlite
      .prepare(`
      UPDATE builds SET status=?, completed_at=?, deploy_url=?, error_code=?, error_msg=? WHERE id=?
    `)
      .run(
        finalStatus,
        new Date().toISOString(),
        ctx.deploymentUrl ?? null,
        errorCode ?? null,
        errorMessage ?? null,
        ctx.buildId,
      );
  }

  private async runStage(
    ctx: BuildContext,
    sqlite: Database.Database,
    stage: Stage,
    checkpoint: StageCheckpoint | undefined,
  ): Promise<
    | { status: "ok" | "skipped" }
    | { status: "failed"; failed: { recoverable: boolean; code?: string; message: string } }
  > {
    const inputEvidence = await this.requireEvidence(
      ctx,
      stage.evidence?.inputs(ctx) ?? [],
      stage.name,
      "input",
    );
    if (this.reusing) await this.assessReuse(ctx, stage, checkpoint, inputEvidence);
    if (await this.resumeStage(ctx, stage, checkpoint)) {
      await this.hydrateSkippedStage(ctx, stage);
      await this.recordSkip(ctx, sqlite, stage.name, "validated evidence checkpoint");
      ctx.spendLedger?.noteReuse(stage.name);
      return { status: "skipped" };
    }

    const attempt = (checkpoint?.attempt ?? 0) + 1;
    const startedAt = new Date();
    const runRow = !ctx.dryRun
      ? sqlite
          .prepare(
            `INSERT INTO stage_runs (build_id, stage_name, status, ran_at) VALUES (?, ?, 'running', ?)`,
          )
          .run(ctx.buildId, stage.name, startedAt.toISOString()).lastInsertRowid
      : undefined;
    const startedMs = Date.now();
    logger.info({ stage: stage.name, version: stage.version, attempt }, "Stage start");

    const ledger = ctx.spendLedger;
    const denialBefore = ledger?.lastDenial;
    let settle: () => void = () => {};
    ledger?.beginStage(stage.name);

    try {
      if (ledger) settle = admitPaidStage(ctx, ledger, stage.name);
      let stageResult: StageRunResult | undefined;
      try {
        stageResult = (await stage.run(ctx)) as StageRunResult | undefined;
      } finally {
        settle();
      }
      await this.completeStage(ctx, sqlite, stage, {
        attempt,
        startedAt,
        startedMs,
        runRow,
        inputEvidence,
        externalId: stageResult?.externalId,
      });
      ledger?.endStage(stage.name, {
        ok: true,
        durationMs: Date.now() - startedMs,
        inputDigest: checkpointDigest(inputEvidence),
      });
      return { status: "ok" };
    } catch (caught) {
      const durationMs = Date.now() - startedMs;
      // A stage may re-wrap the ledger's denial in its own error; the budget
      // event is still the cause, so the failure is re-typed BUDGET_EXCEEDED.
      const denial = ledger?.lastDenial;
      const error =
        ledger &&
        denial &&
        denial !== denialBefore &&
        denial.stage === stage.name &&
        !(caught instanceof BuildError && caught.code === "BUDGET_EXCEEDED")
          ? ledger.budgetError(denial)
          : caught;
      const buildError = error instanceof BuildError ? error : null;
      ledger?.endStage(stage.name, {
        ok: false,
        durationMs,
        errorCode: buildError?.code ?? "UNKNOWN",
      });
      const message = error instanceof Error ? error.message : String(error);
      ctx.stageResults.set(stage.name, { ok: false, error: message });
      await this.persistFailure(ctx, stage, buildError, message, inputEvidence, startedAt, attempt);
      if (!ctx.dryRun) {
        sqlite
          .prepare(`UPDATE stage_runs SET status='failed', duration_ms=?, error_msg=? WHERE id=?`)
          .run(durationMs, message, runRow);
        ctx.evidenceIndex = await ctx.evidenceStore.readIndex();
        syncEvidenceIndexToDb(sqlite, ctx.evidenceIndex, ctx.evidenceStore.rootDir);
      }
      logger.error({ stage: stage.name, durationMs, error: message }, "Stage FAILED");
      return {
        status: "failed",
        failed: {
          recoverable: buildError?.recoverable ?? false,
          code: buildError?.code,
          message,
        },
      };
    }
  }

  private async completeStage(
    ctx: BuildContext,
    sqlite: Database.Database,
    stage: Stage,
    run: {
      attempt: number;
      startedAt: Date;
      startedMs: number;
      runRow: number | bigint | undefined;
      inputEvidence: EvidenceReference[];
      externalId?: string;
    },
  ): Promise<void> {
    const outputEvidence = await this.requireEvidence(
      ctx,
      stage.evidence?.outputs(ctx) ?? [],
      stage.name,
      "output",
    );
    await this.ensureCheckpoint(
      ctx,
      stage,
      run.attempt,
      run.startedAt,
      run.inputEvidence,
      outputEvidence,
      run.externalId,
    );
    const durationMs = Date.now() - run.startedMs;
    ctx.stageResults.set(stage.name, { ok: true });
    if (!ctx.dryRun) {
      ctx.evidenceIndex = await ctx.evidenceStore.transitionStageSucceeded(stage.name);
      if (stage.name === "terminal-convergence") {
        // The stage's own checks have passed and its success (which clears
        // any prior active failure) is now recorded — only then may the
        // evidence chain converge.
        ctx.evidenceIndex = await ctx.evidenceStore.transitionRunConverged();
      }
      sqlite
        .prepare(`UPDATE stage_runs SET status='ok', duration_ms=? WHERE id=?`)
        .run(durationMs, run.runRow);
      syncEvidenceIndexToDb(sqlite, ctx.evidenceIndex, ctx.evidenceStore.rootDir);
    }
    logger.info(
      { stage: stage.name, durationMs, evidenceRevision: ctx.evidenceIndex.revision },
      "Stage OK",
    );
  }

  /** Read a checkpoint while reusing completed stages; unreadable is corrupt, never "absent". */
  private async readCheckpointStrict(
    ctx: BuildContext,
    stageName: string,
  ): Promise<StageCheckpoint | undefined> {
    try {
      return await ctx.evidenceStore.readCheckpoint(stageName);
    } catch (error) {
      throw new BuildError(
        "CHECKPOINT_INVALID",
        `Cannot resume ${ctx.buildId}: checkpoint for ${stageName} is corrupt (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  /**
   * Strict-resume gate for one stage inside the completed prefix. Fails closed
   * when a stage the build completed has a missing or corrupt checkpoint; ends
   * the reusable prefix (the resume frontier) at the first stage that never
   * completed or whose reuse must be refused because its version, spec or
   * input digest changed — that stage and every later one execute again.
   */
  private async assessReuse(
    ctx: BuildContext,
    stage: Stage,
    checkpoint: StageCheckpoint | undefined,
    inputEvidence: EvidenceReference[],
  ): Promise<void> {
    const ledger = ctx.spendLedger;
    if (!ledger) return;
    const recorded = ledger.stageRecord(stage.name);
    const recordedComplete = recorded?.status === "completed";
    if (checkpoint?.status !== "passed") {
      if (recordedComplete)
        throw new BuildError(
          "CHECKPOINT_INVALID",
          `Cannot resume ${ctx.buildId}: ${stage.name} is recorded completed but its checkpoint is ${checkpoint ? `"${checkpoint.status}"` : "missing"}`,
        );
      this.reusing = false;
      ledger.noteFrontier(stage.name);
      logger.info({ stage: stage.name, buildId: ctx.buildId }, "Resume frontier");
      return;
    }
    if (!(await checkpointIsValid(ctx, checkpoint)))
      throw new BuildError(
        "CHECKPOINT_INVALID",
        `Cannot resume ${ctx.buildId}: checkpoint for completed stage ${stage.name} failed identity or evidence-digest verification`,
      );
    const refuse = (reason: string): void => {
      ledger.noteRefusal(stage.name, reason);
      this.reusing = false;
      ctx.resume = false;
      logger.warn({ stage: stage.name, reason }, "Resume refused for stage; re-executing");
    };
    // Reuse is keyed on the declared version (config/stage-version-manifest.json
    // keeps it honest): a checkpoint with no recorded version, or one recorded
    // by a stage that then declared one, is never matched.
    if (checkpoint.stageVersion !== stage.version)
      return refuse(
        `stage version changed ${checkpoint.stageVersion ?? "unrecorded"} -> ${stage.version ?? "undeclared"}`,
      );
    if (recorded && recorded.spec_digest !== ledger.specDigest)
      return refuse(
        `spec digest changed ${recorded.spec_digest.slice(0, 12)} -> ${ledger.specDigest.slice(0, 12)}`,
      );
    const currentInputDigest = checkpointDigest(inputEvidence);
    if (currentInputDigest !== checkpoint.inputDigest) {
      const before = new Map(checkpoint.inputEvidence.map((ref) => [ref.kind, ref.sha256]));
      const changed = inputEvidence
        .filter((ref) => before.get(ref.kind) !== ref.sha256)
        .map((ref) => ref.kind);
      const dropped = checkpoint.inputEvidence
        .filter((ref) => !inputEvidence.some((current) => current.kind === ref.kind))
        .map((ref) => ref.kind);
      return refuse(
        `dependency digest changed (${[...changed, ...dropped].join(", ") || "input set"}): ${checkpoint.inputDigest.slice(0, 12)} -> ${currentInputDigest.slice(0, 12)}`,
      );
    }
  }

  private async requireEvidence(
    ctx: BuildContext,
    kinds: EvidenceKind[],
    stageName: string,
    direction: "input" | "output",
  ): Promise<EvidenceReference[]> {
    if (ctx.dryRun) return [];
    const references: EvidenceReference[] = [];
    for (const kind of kinds) {
      const reference = await ctx.evidenceStore.referenceFor(kind);
      if (!reference)
        throw new BuildError(
          "EVIDENCE_REFERENCE_MISSING",
          `${stageName} requires ${direction} ${kind} evidence`,
        );
      if (!(await ctx.evidenceStore.verifyReference(reference))) {
        throw new BuildError(
          "EVIDENCE_DIGEST_MISMATCH",
          `${stageName} ${direction} ${kind} evidence is missing or corrupt`,
        );
      }
      references.push(reference);
    }
    return references;
  }

  private async resumeStage(
    ctx: BuildContext,
    stage: Stage,
    checkpoint?: StageCheckpoint,
  ): Promise<boolean> {
    if (!ctx.resume || !stage.evidence?.resumable || !checkpoint) return false;
    if (!(await checkpointIsValid(ctx, checkpoint))) return false;
    if (checkpoint.stageVersion !== stage.version) return false;
    if (stage.evidence.externalMutation) {
      if (!stage.canResume || !(await stage.canResume(ctx, checkpoint))) {
        throw new BuildError(
          "EVIDENCE_RESUME_CONFLICT",
          `External state re-verification failed for ${stage.name}`,
        );
      }
    } else if (stage.canResume && !(await stage.canResume(ctx, checkpoint))) {
      // A local stage may decline a checkpoint whose inputs it cannot prove
      // unchanged; it simply re-runs.
      return false;
    }
    return true;
  }

  private async hydrateSkippedStage(ctx: BuildContext, stage: Stage): Promise<void> {
    if (stage.name === "source-site-ingestion") {
      const stored = await ctx.evidenceStore.readSourceSite();
      if (stored) ctx.sourceSiteManifest = stored.value;
      return;
    }
    if (stage.name === "image-asset-planning") {
      const stored = await ctx.evidenceStore.readImagePlan();
      if (stored) ctx.imageAssetPlan = stored.value;
      return;
    }
    if (stage.name === "image-generation") await this.hydrateImageGeneration(ctx);
  }

  private async hydrateImageGeneration(ctx: BuildContext): Promise<void> {
    const stored = await ctx.evidenceStore.readImageAssets();
    if (!stored) return;
    ctx.imageAssetManifest = stored.value;
    ctx.resolvedImages ??= new Map();
    const generatedRoot = resolve(clientPersistentAssetRoot(ctx), "generated");
    const buildGeneratedRoot = resolve(clientAssetRoot(ctx), "generated");
    for (const asset of stored.value.assets) {
      const outputFileName = basename(asset.outputPath);
      const absolutePath = resolveAssetAbsolutePath(asset, generatedRoot, buildGeneratedRoot);
      const resolved: ResolvedImageAsset = {
        slotId: asset.slotId,
        placement: asset.placement,
        source: asset.source,
        absolutePath,
        outputFileName,
        // The manifest records the alt that shipped; a manifest from before it
        // did falls back to the operator's slot alt, then to the alt derived
        // from the section — never the slot id (ImageAltText).
        altText: hydratedAltText(ctx, asset),
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteLength: asset.byteLength,
        sha256: asset.sha256,
        sourceUrl: asset.sourceUrl,
        originalPath: asset.originalPath,
        promptHash: asset.promptHash,
        model: asset.model,
        estimatedCostUsd: asset.estimatedCostUsd,
        disposition: asset.disposition,
        provenanceWarnings: asset.provenanceWarnings,
        // Variants are reused only when every staged rendition is still beside the file.
        ...(asset.variants?.length &&
        asset.variants.every((variant) =>
          existsSync(variantStagedPath(absolutePath, variant.width)),
        )
          ? { variants: asset.variants }
          : {}),
      };
      ctx.resolvedImages.set(asset.placement, resolved);
    }
  }

  private async ensureCheckpoint(
    ctx: BuildContext,
    stage: Stage,
    attempt: number,
    startedAt: Date,
    inputs: EvidenceReference[],
    outputs: EvidenceReference[],
    externalId?: string,
  ): Promise<void> {
    if (ctx.dryRun) return;
    await ctx.evidenceStore.writeCheckpoint({
      schema: "website-bot.stage-checkpoint/v2",
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      stageVersion: stage.version,
      attempt,
      inputEvidence: inputs,
      outputEvidence: outputs,
      inputDigest: checkpointDigest(inputs),
      outputDigest: checkpointDigest(outputs),
      ...(externalId ? { externalId } : {}),
      status: "passed",
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
      schema: "website-bot.stage-failure/v2",
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      attempt,
      code: error?.code ?? "UNKNOWN",
      message: sanitizeEvidenceText(message),
      recoverable: error?.recoverable ?? false,
      inputEvidence,
      sanitizedDetails: error?.context
        ? (sanitizeEvidenceDetails(error.context) as Record<string, unknown>)
        : undefined,
      failedAt: new Date().toISOString(),
    };
    const failureRecord = await ctx.evidenceStore.writeFailure(failure);
    const outputEvidence = [
      {
        kind: failureRecord.kind,
        schema: failureRecord.schema,
        logical_id: failureRecord.logicalId,
        relative_path: failureRecord.relativePath,
        sha256: failureRecord.sha256,
      },
    ];
    await ctx.evidenceStore.writeCheckpoint({
      schema: "website-bot.stage-checkpoint/v2",
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: stage.name,
      stageVersion: stage.version,
      attempt,
      inputEvidence,
      outputEvidence,
      inputDigest: checkpointDigest(inputEvidence),
      outputDigest: checkpointDigest(outputEvidence),
      status: "failed",
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
      sqlite
        .prepare(`
        INSERT INTO stage_runs (build_id, stage_name, status, error_msg, ran_at)
        VALUES (?, ?, 'skipped', ?, ?)
      `)
        .run(ctx.buildId, stageName, reason, new Date().toISOString());
    }
  }
}
