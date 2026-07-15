/**
 * CompensationRegistry — saga-pattern rollback for external mutations.
 *
 * Register a compensation action BEFORE executing the mutating step.
 * On failure, call compensate() to execute registered actions in reverse order.
 *
 * Usage:
 *   const saga = new CompensationRegistry(jobId);
 *   saga.register('vercel-preview', () => vercel.rollback(deployId));
 *   await vercel.deploy(...);
 *   // If later step fails:
 *   await saga.compensate();
 */

export interface CompensationEntry {
  stepId: string;
  action: () => Promise<void>;
  registeredAt: Date;
}

export class CompensationRegistry {
  private readonly entries: CompensationEntry[] = [];

  constructor(public readonly jobId: string) {}

  /**
   * Register a compensation action for a step that is about to mutate external state.
   * Must be called BEFORE the mutation, not after.
   */
  register(stepId: string, action: () => Promise<void>): void {
    this.entries.push({ stepId, action, registeredAt: new Date() });
  }

  /**
   * Execute all registered compensations in reverse order (last registered = first compensated).
   * Errors in individual compensations are collected and reported but do not abort others.
   */
  async compensate(): Promise<{ stepId: string; error?: string }[]> {
    const results: { stepId: string; error?: string }[] = [];
    const reversed = [...this.entries].reverse();
    for (const entry of reversed) {
      try {
        await entry.action();
        results.push({ stepId: entry.stepId });
        console.log(`[CompensationRegistry] job=${this.jobId} step=${entry.stepId} compensated OK`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ stepId: entry.stepId, error: message });
        console.error(`[CompensationRegistry] job=${this.jobId} step=${entry.stepId} compensation FAILED: ${message}`);
      }
    }
    return results;
  }

  /** Clear all entries after a successful run or after compensation completes. */
  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}
