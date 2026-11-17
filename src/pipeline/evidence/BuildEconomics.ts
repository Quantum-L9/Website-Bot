// L9_META: layer=pipeline, role=build_economics_evidence, status=active, version=1.0.0
//
// Per-build unit economics: cumulative spend by class, wall time and attempts
// per stage, persisted beside the build's evidence so it survives resumes. It
// is the single persisted spend ledger for a pipeline build (see SpendLedger);
// the process-local allowances in services/llm.ts and services/images remain
// in-call backstops, not a second record.

export const BUILD_ECONOMICS_SCHEMA = "website-bot.build-economics/v1" as const;
export const BUILD_ECONOMICS_FILE = "build-economics.json";

export const SPEND_CLASSES = ["dataforseo", "llm", "images"] as const;
export type SpendClass = (typeof SPEND_CLASSES)[number];
export type SpendByClass = Record<SpendClass, number>;

/**
 * provider_reported: the provider returned the billed usage (LLM).
 * cache_metadata: cost recorded by a fresh image generation in the asset cache.
 * upper_bound: Website-Bot has no billed figure (DataForSEO is billed inside
 * SEO-Bot), so the configured per-call reserve is charged in full.
 */
export type ChargeBasis = "provider_reported" | "cache_metadata" | "upper_bound";

export interface SpendCharge {
  spend_class: SpendClass;
  stage: string;
  run: number;
  amount_usd: number;
  basis: ChargeBasis;
  recorded_at: string;
}

export type EconomicsStageStatus = "running" | "completed" | "failed";

export interface StageEconomics {
  stage: string;
  status: EconomicsStageStatus;
  /** Real executions of the stage (fresh or re-executed), across all runs. */
  attempts: number;
  /** Times a completed stage was reused on resume instead of re-executed. */
  reuses: number;
  wall_time_ms: number;
  spend_usd: SpendByClass;
  spec_digest: string;
  input_digest?: string;
  last_error_code?: string;
  completed_at?: string;
}

export type EconomicsRunStatus = "running" | "success" | "partial" | "failed" | "budget_exceeded";

export interface RunEconomics {
  run: number;
  resumed: boolean;
  cap_usd: number;
  status: EconomicsRunStatus;
  started_at: string;
  completed_at?: string;
  wall_time_ms?: number;
  /** Stages whose checkpoints were reused on this run (resume only). */
  reused_stages: string[];
  /** Completed stages whose reuse was refused, and why (resume only). */
  refused_stages: Array<{ stage: string; reason: string }>;
  /** First stage this run actually executed. */
  resumed_from?: string;
}

export interface BudgetFailure {
  spend_class: SpendClass;
  stage: string;
  run: number;
  requested_usd: number;
  spent_class_usd: number;
  spent_total_usd: number;
  remaining_usd: number;
  cap_usd: number;
  recorded_at: string;
}

export interface BuildEconomics {
  schema: typeof BUILD_ECONOMICS_SCHEMA;
  build_id: string;
  client_id: string;
  mode: string;
  build_intent: string;
  spec_path: string;
  spec_digest: string;
  currency: "USD";
  cap_usd: number;
  totals: {
    spend_usd: number;
    by_class: SpendByClass;
    wall_time_ms: number;
    runs: number;
    stage_attempts: number;
  };
  runs: RunEconomics[];
  stages: StageEconomics[];
  charges: SpendCharge[];
  budget_failure?: BudgetFailure;
  created_at: string;
  updated_at: string;
}

export function zeroSpend(): SpendByClass {
  return { dataforseo: 0, llm: 0, images: 0 };
}

const SHA256 = /^[a-f0-9]{64}$/;

function nonNegative(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${path} must be a non-negative number`);
}

function spendByClass(value: unknown, path: string): void {
  if (!value || typeof value !== "object") throw new Error(`${path} must be an object`);
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== [...SPEND_CLASSES].sort().join(","))
    throw new Error(`${path} must carry exactly ${SPEND_CLASSES.join(", ")}`);
  for (const key of SPEND_CLASSES)
    nonNegative((value as Record<string, unknown>)[key], `${path}.${key}`);
}

/** Fail-closed structural validation; a record that fails is treated as corrupt. */
export function validateBuildEconomics(value: unknown): asserts value is BuildEconomics {
  if (!value || typeof value !== "object") throw new Error("build economics must be an object");
  const record = value as Partial<BuildEconomics>;
  if (record.schema !== BUILD_ECONOMICS_SCHEMA) throw new Error("build economics schema drift");
  for (const key of ["build_id", "client_id", "mode", "build_intent", "spec_path"] as const)
    if (typeof record[key] !== "string" || record[key] === "")
      throw new Error(`build economics ${key} is invalid`);
  if (!SHA256.test(String(record.spec_digest)))
    throw new Error("build economics spec_digest is invalid");
  if (record.currency !== "USD") throw new Error("build economics currency must be USD");
  nonNegative(record.cap_usd, "cap_usd");
  const totals = record.totals;
  if (!totals) throw new Error("build economics totals missing");
  nonNegative(totals.spend_usd, "totals.spend_usd");
  spendByClass(totals.by_class, "totals.by_class");
  nonNegative(totals.wall_time_ms, "totals.wall_time_ms");
  if (!Number.isInteger(totals.runs) || !Number.isInteger(totals.stage_attempts))
    throw new Error("build economics totals counters are invalid");
  if (
    !Array.isArray(record.runs) ||
    !Array.isArray(record.stages) ||
    !Array.isArray(record.charges)
  )
    throw new Error("build economics lists are invalid");
  for (const [i, stage] of record.stages.entries()) {
    if (!stage || typeof stage.stage !== "string" || stage.stage === "")
      throw new Error(`stages[${i}].stage is invalid`);
    if (!["running", "completed", "failed"].includes(stage.status))
      throw new Error(`stages[${i}].status is invalid`);
    spendByClass(stage.spend_usd, `stages[${i}].spend_usd`);
    if (!SHA256.test(String(stage.spec_digest)))
      throw new Error(`stages[${i}].spec_digest is invalid`);
  }
  for (const [i, charge] of record.charges.entries()) {
    if (!SPEND_CLASSES.includes(charge?.spend_class))
      throw new Error(`charges[${i}].spend_class is invalid`);
    nonNegative(charge.amount_usd, `charges[${i}].amount_usd`);
  }
  // Totals must be derivable from the charges: a hand-edited total is corrupt.
  const derived = zeroSpend();
  for (const charge of record.charges) derived[charge.spend_class] += charge.amount_usd;
  for (const key of SPEND_CLASSES)
    if (Math.abs(derived[key] - totals.by_class[key]) > 1e-6)
      throw new Error(`totals.by_class.${key} does not match recorded charges`);
}
