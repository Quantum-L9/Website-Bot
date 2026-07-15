/**
 * AgentBudgetGuard — four-move runtime budget control loop.
 *
 * Moves: Admission → Reserve → Reconcile → Enforce
 *
 * Usage:
 *   const guard = new AgentBudgetGuard(jobId, 1.00, process.env.POSTGRES_URL!);
 *   await guard.open();
 *   await guard.reserve(0.05);
 *   const result = await llmCall();
 *   await guard.reconcile(result.costUsd);
 *   const state = guard.enforce(); // throws BudgetExceededError when exhausted
 *   await guard.close();
 */

export class BudgetExceededError extends Error {}
export class AdmissionRejectedError extends Error {}

export type BudgetMode = 'normal' | 'cheaper_model' | 'narrow_scope' | 'require_approval' | 'stop';

export interface BudgetEnforcement {
  jobId: string;
  mode: BudgetMode;
  actualUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  forecastUsd: number;
}

export class AgentBudgetGuard {
  private capUsd: number;
  private actualUsd = 0;
  private reservedUsd = 0;
  private forecastUsd = 0;
  private mode: BudgetMode = 'normal';

  constructor(
    public readonly jobId: string,
    capUsd: number,
    private readonly postgresUrl?: string,
  ) {
    this.capUsd = capUsd;
  }

  /** MOVE 1 — Admission: verify forecast is feasible before starting work. */
  async open(initialForecastUsd = 0): Promise<void> {
    this.forecastUsd = initialForecastUsd;
    if (this.forecastUsd > this.capUsd) {
      throw new AdmissionRejectedError(
        `Admission rejected: forecast $${this.forecastUsd.toFixed(4)} exceeds cap $${this.capUsd.toFixed(4)} for job ${this.jobId}`,
      );
    }
  }

  /** MOVE 2 — Reserve: lock budget before each expensive step. */
  reserve(estimatedUsd: number): void {
    const remaining = this.capUsd - this.actualUsd - this.reservedUsd;
    if (estimatedUsd > remaining) {
      this._updateMode();
      const remainingAfterMode = this.capUsd - this.actualUsd - this.reservedUsd;
      if (estimatedUsd > remainingAfterMode) {
        throw new BudgetExceededError(
          `Reservation denied: need $${estimatedUsd.toFixed(4)}, remaining $${remainingAfterMode.toFixed(4)}, mode=${this.mode}, job=${this.jobId}`,
        );
      }
    }
    this.reservedUsd += estimatedUsd;
    this.forecastUsd = this.actualUsd + this.reservedUsd;
  }

  /** MOVE 3 — Reconcile: record actual spend and update forecast. */
  reconcile(actualUsd: number, nextEstimateUsd = 0): void {
    this.actualUsd += actualUsd;
    this.reservedUsd = Math.max(0, this.reservedUsd - actualUsd);
    this.forecastUsd = this.actualUsd + this.reservedUsd + nextEstimateUsd;
    if (this.actualUsd > this.capUsd) {
      throw new BudgetExceededError(
        `Budget cap $${this.capUsd.toFixed(4)} exceeded: actual=$${this.actualUsd.toFixed(4)}, job=${this.jobId}`,
      );
    }
    if (this.forecastUsd > this.capUsd) {
      this._updateMode();
    }
  }

  /** MOVE 4 — Enforce: return current state; throws if hard cap is exhausted. */
  enforce(): BudgetEnforcement {
    const remaining = this.capUsd - this.actualUsd;
    if (remaining <= 0) {
      this.mode = 'stop';
      throw new BudgetExceededError(
        `Cap exhausted for job ${this.jobId}: actual=$${this.actualUsd.toFixed(4)}, cap=$${this.capUsd.toFixed(4)}`,
      );
    }
    return {
      jobId: this.jobId,
      mode: this.mode,
      actualUsd: this.actualUsd,
      reservedUsd: this.reservedUsd,
      remainingUsd: remaining,
      forecastUsd: this.forecastUsd,
    };
  }

  async close(): Promise<void> {
    // Persist final actual cost to Postgres if URL provided.
    // Import pg dynamically to avoid hard dependency at construction time.
    if (!this.postgresUrl) return;
    try {
      const { default: pg } = await import('pg');
      const client = new pg.Client({ connectionString: this.postgresUrl });
      await client.connect();
      await client.query(
        `UPDATE agent_jobs SET cost_usd = $2, status = CASE WHEN status = 'running' THEN 'success' ELSE status END WHERE job_id = $1`,
        [this.jobId, this.actualUsd],
      );
      await client.end();
    } catch (err) {
      // Non-fatal: log but do not throw — state persistence failure should not mask the primary result.
      console.error('[AgentBudgetGuard] close persistence error', err);
    }
  }

  get currentMode(): BudgetMode {
    return this.mode;
  }

  private _updateMode(): void {
    const pressure = this.capUsd === 0 ? 1 : (this.actualUsd + this.reservedUsd) / this.capUsd;
    if (pressure < 0.70) this.mode = 'normal';
    else if (pressure < 0.85) this.mode = 'cheaper_model';
    else if (pressure < 0.95) this.mode = 'narrow_scope';
    else if (pressure < 1.00) this.mode = 'require_approval';
    else this.mode = 'stop';
  }
}
