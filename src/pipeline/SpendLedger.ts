// L9_META: layer=pipeline, role=build_spend_ledger, status=active, version=1.0.0
//
// One persisted spend ledger per build, enforced across resumes. Every paid
// call or paid stage is admitted against the remaining cap BEFORE it starts;
// a denial is a typed BUDGET_EXCEEDED failure naming the class and amounts.
// Admission never interrupts a call that is already in flight.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { BuildError } from "./BuildError.js";
import {
  BUILD_ECONOMICS_FILE,
  BUILD_ECONOMICS_SCHEMA,
  type BudgetFailure,
  type BuildEconomics,
  type ChargeBasis,
  type EconomicsRunStatus,
  type RunEconomics,
  SPEND_CLASSES,
  type SpendClass,
  type StageEconomics,
  validateBuildEconomics,
  zeroSpend,
} from "./evidence/BuildEconomics.js";

export const DEFAULT_BUILD_CAP_USD = 10;

/** Reserve admitted before a paid call whose exact cost is unknown up front. */
export interface SpendReserves {
  /** Minimum remaining budget required before each LLM dispatch. */
  llm: number;
  /** Charged per SEO-Bot paid stage execution (DataForSEO is billed inside SEO-Bot). */
  dataforseo: number;
  /** Reserved before image generation when the spec sets no generation budget. */
  images: number;
}

export const DEFAULT_SPEND_RESERVES: SpendReserves = {
  llm: 0.05,
  // SEO-Bot's own per-call DataForSEO class cap (observed: "$1.988 + reserve
  // $0.05 exceeds $2"). Charged in full because no billed figure is returned.
  dataforseo: 2,
  images: 0.05,
};

export interface SpendLedgerIdentity {
  buildId: string;
  clientId: string;
  mode: string;
  buildIntent: string;
  specPath: string;
  specDigest: string;
}

export interface OpenSpendLedgerOptions extends SpendLedgerIdentity {
  /** Directory holding build-economics.json; undefined keeps the ledger in memory. */
  rootDir?: string;
  /** Explicit cap for this run; on resume, omitted keeps the persisted cap. */
  capUsd?: number;
  resume: boolean;
  reserves?: Partial<SpendReserves>;
  now?: () => Date;
}

const EPSILON = 1e-9;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function economicsPath(rootDir: string): string {
  return join(rootDir, BUILD_ECONOMICS_FILE);
}

/** Read and validate a persisted economics record; corrupt is a hard failure. */
export function readBuildEconomics(rootDir: string): BuildEconomics | undefined {
  const path = economicsPath(rootDir);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
    validateBuildEconomics(parsed);
  } catch (error) {
    throw new BuildError(
      "CHECKPOINT_INVALID",
      `Build economics record ${path} is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed;
}

export class SpendLedger {
  private readonly reserves: SpendReserves;
  private readonly now: () => Date;
  private runStartedMs = 0;
  private activeStage: string | undefined;
  private denial: BudgetFailure | undefined;

  private constructor(
    private record: BuildEconomics,
    private readonly rootDir: string | undefined,
    reserves: SpendReserves,
    now: () => Date,
  ) {
    this.reserves = reserves;
    this.now = now;
  }

  static open(options: OpenSpendLedgerOptions): SpendLedger {
    const now = options.now ?? (() => new Date());
    const reserves = { ...DEFAULT_SPEND_RESERVES, ...options.reserves };
    for (const [key, value] of Object.entries(reserves))
      if (!Number.isFinite(value) || value < 0)
        throw new BuildError("VALIDATION_FAILED", `spend reserve ${key} must be non-negative`);
    if (options.capUsd !== undefined && (!Number.isFinite(options.capUsd) || options.capUsd <= 0))
      throw new BuildError("VALIDATION_FAILED", "build budget cap must be a positive number");
    const existing = options.rootDir ? readBuildEconomics(options.rootDir) : undefined;
    if (options.resume) {
      if (!existing)
        throw new BuildError(
          "RESUME_STATE_MISSING",
          `Cannot resume ${options.buildId}: no ${BUILD_ECONOMICS_FILE} under ${options.rootDir ?? "(memory)"}; start a new build`,
        );
      SpendLedger.assertSameBuild(existing, options);
      const ledger = new SpendLedger(existing, options.rootDir, reserves, now);
      if (options.capUsd !== undefined) ledger.record.cap_usd = options.capUsd;
      return ledger;
    }
    if (existing)
      throw new BuildError(
        "EVIDENCE_RESUME_CONFLICT",
        `Build ${options.buildId} already has spend history; resume it with --resume ${options.buildId} or start a new build id`,
      );
    const timestamp = now().toISOString();
    const record: BuildEconomics = {
      schema: BUILD_ECONOMICS_SCHEMA,
      build_id: options.buildId,
      client_id: options.clientId,
      mode: options.mode,
      build_intent: options.buildIntent,
      spec_path: options.specPath,
      spec_digest: options.specDigest,
      currency: "USD",
      cap_usd: options.capUsd ?? DEFAULT_BUILD_CAP_USD,
      totals: { spend_usd: 0, by_class: zeroSpend(), wall_time_ms: 0, runs: 0, stage_attempts: 0 },
      runs: [],
      stages: [],
      charges: [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    return new SpendLedger(record, options.rootDir, reserves, now);
  }

  private static assertSameBuild(existing: BuildEconomics, options: SpendLedgerIdentity): void {
    if (existing.build_id !== options.buildId || existing.client_id !== options.clientId)
      throw new BuildError(
        "EVIDENCE_IDENTITY_MISMATCH",
        `Economics record belongs to ${existing.client_id}/${existing.build_id}, not ${options.clientId}/${options.buildId}`,
      );
    if (existing.mode !== options.mode)
      throw new BuildError(
        "RESUME_INPUT_CHANGED",
        `Cannot resume ${options.buildId}: mode changed ${existing.mode} -> ${options.mode}`,
      );
    if (existing.build_intent !== options.buildIntent)
      throw new BuildError(
        "RESUME_INPUT_CHANGED",
        `Cannot resume ${options.buildId}: build intent changed ${existing.build_intent} -> ${options.buildIntent}`,
      );
    if (existing.spec_digest !== options.specDigest) {
      const bound = existing.stages
        .filter((stage) => stage.status === "completed")
        .map((stage) => stage.stage);
      throw new BuildError(
        "RESUME_INPUT_CHANGED",
        `Cannot resume ${options.buildId}: spec digest changed ${existing.spec_digest.slice(0, 12)} -> ${options.specDigest.slice(0, 12)}; completed stages bound to the old spec: ${bound.join(", ") || "(none)"}`,
        false,
        { previous_spec_digest: existing.spec_digest, current_spec_digest: options.specDigest },
      );
    }
  }

  get snapshot(): BuildEconomics {
    return structuredClone(this.record);
  }

  get capUsd(): number {
    return this.record.cap_usd;
  }

  get specDigest(): string {
    return this.record.spec_digest;
  }

  get spentUsd(): number {
    return this.record.totals.spend_usd;
  }

  get remainingUsd(): number {
    return round(Math.max(0, this.record.cap_usd - this.record.totals.spend_usd));
  }

  get reserve(): Readonly<SpendReserves> {
    return this.reserves;
  }

  get currentStage(): string | undefined {
    return this.activeStage;
  }

  get currentRun(): number {
    return this.record.runs.at(-1)?.run ?? 0;
  }

  /** The most recent admission denial, if any (survives a stage re-wrapping the error). */
  get lastDenial(): BudgetFailure | undefined {
    return this.denial;
  }

  stageRecord(stage: string): StageEconomics | undefined {
    return this.record.stages.find((entry) => entry.stage === stage);
  }

  beginRun(resumed: boolean): void {
    this.runStartedMs = Date.now();
    this.denial = undefined;
    const run: RunEconomics = {
      run: this.currentRun + 1,
      resumed,
      cap_usd: this.record.cap_usd,
      status: "running",
      started_at: this.now().toISOString(),
      reused_stages: [],
      refused_stages: [],
    };
    this.record.runs.push(run);
    this.record.totals.runs = this.record.runs.length;
    this.persist();
  }

  noteReuse(stage: string): void {
    const run = this.requireRun();
    run.reused_stages.push(stage);
    const entry = this.stageRecord(stage);
    if (entry) entry.reuses += 1;
    this.persist();
  }

  noteRefusal(stage: string, reason: string): void {
    const run = this.requireRun();
    run.refused_stages.push({ stage, reason });
    run.resumed_from ??= stage;
    this.persist();
  }

  /** The first stage of a resumed run that the build had not completed. */
  noteFrontier(stage: string): void {
    this.requireRun().resumed_from ??= stage;
    this.persist();
  }

  beginStage(stage: string): void {
    this.activeStage = stage;
    const entry = this.ensureStage(stage);
    entry.status = "running";
    entry.attempts += 1;
    this.record.totals.stage_attempts += 1;
    this.persist();
  }

  endStage(
    stage: string,
    outcome: { ok: boolean; durationMs: number; inputDigest?: string; errorCode?: string },
  ): void {
    const entry = this.ensureStage(stage);
    entry.wall_time_ms += Math.max(0, outcome.durationMs);
    entry.spec_digest = this.record.spec_digest;
    if (outcome.ok) {
      entry.status = "completed";
      entry.completed_at = this.now().toISOString();
      if (outcome.inputDigest) entry.input_digest = outcome.inputDigest;
      delete entry.last_error_code;
    } else {
      entry.status = "failed";
      entry.last_error_code = outcome.errorCode ?? "UNKNOWN";
      delete entry.completed_at;
    }
    this.activeStage = undefined;
    this.persist();
  }

  /**
   * Admit a paid call/stage of `amountUsd` for `spendClass`. Denial throws a
   * non-recoverable BUDGET_EXCEEDED before any money is committed.
   */
  admit(spendClass: SpendClass, amountUsd: number, stage = this.activeStage ?? "pipeline"): void {
    const remaining = this.record.cap_usd - this.record.totals.spend_usd;
    if (amountUsd <= remaining + EPSILON && remaining > EPSILON) return;
    this.denial = {
      spend_class: spendClass,
      stage,
      run: this.currentRun,
      requested_usd: round(amountUsd),
      spent_class_usd: round(this.record.totals.by_class[spendClass]),
      spent_total_usd: round(this.record.totals.spend_usd),
      remaining_usd: round(Math.max(0, remaining)),
      cap_usd: this.record.cap_usd,
      recorded_at: this.now().toISOString(),
    };
    this.record.budget_failure = this.denial;
    this.persist();
    throw this.budgetError(this.denial);
  }

  budgetError(denial: BudgetFailure): BuildError {
    return new BuildError(
      "BUDGET_EXCEEDED",
      `Build budget exceeded at ${denial.stage}: class ${denial.spend_class} spent $${denial.spent_class_usd.toFixed(4)} + requested $${denial.requested_usd.toFixed(4)}; build spent $${denial.spent_total_usd.toFixed(4)} of cap $${denial.cap_usd.toFixed(4)} (remaining $${denial.remaining_usd.toFixed(4)})`,
      false,
      { ...denial },
    );
  }

  charge(
    spendClass: SpendClass,
    amountUsd: number,
    basis: ChargeBasis,
    stage = this.activeStage ?? "pipeline",
  ): void {
    if (!Number.isFinite(amountUsd) || amountUsd < 0)
      throw new BuildError("VALIDATION_FAILED", `invalid ${spendClass} charge ${amountUsd}`);
    if (amountUsd === 0) return;
    this.record.charges.push({
      spend_class: spendClass,
      stage,
      run: this.currentRun,
      amount_usd: amountUsd,
      basis,
      recorded_at: this.now().toISOString(),
    });
    this.ensureStage(stage).spend_usd[spendClass] += amountUsd;
    this.persist();
  }

  finishRun(status: EconomicsRunStatus): void {
    const run = this.requireRun();
    const elapsed = Date.now() - this.runStartedMs;
    run.status = status;
    run.completed_at = this.now().toISOString();
    run.wall_time_ms = elapsed;
    this.record.totals.wall_time_ms += elapsed;
    this.persist();
  }

  private requireRun(): RunEconomics {
    const run = this.record.runs.at(-1);
    if (!run) throw new BuildError("VALIDATION_FAILED", "spend ledger run was not started");
    return run;
  }

  private ensureStage(stage: string): StageEconomics {
    let entry = this.stageRecord(stage);
    if (!entry) {
      entry = {
        stage,
        status: "running",
        attempts: 0,
        reuses: 0,
        wall_time_ms: 0,
        spend_usd: zeroSpend(),
        spec_digest: this.record.spec_digest,
      };
      this.record.stages.push(entry);
    }
    return entry;
  }

  private persist(): void {
    this.record.updated_at = this.now().toISOString();
    // Totals are always re-derived from the charge list so rounding never drifts.
    const byClass = zeroSpend();
    for (const charge of this.record.charges) byClass[charge.spend_class] += charge.amount_usd;
    for (const key of SPEND_CLASSES) byClass[key] = round(byClass[key]);
    this.record.totals.by_class = byClass;
    this.record.totals.spend_usd = round(SPEND_CLASSES.reduce((sum, key) => sum + byClass[key], 0));
    validateBuildEconomics(this.record);
    if (!this.rootDir) return;
    const path = economicsPath(this.rootDir);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(this.record, null, 2)}\n`, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
