// L9_META: layer=service, role=image_generation_budget, status=active, version=1.0.0
//
// Build-level spend guard for image generation. Enforced before each generation
// call so a build can never exceed its configured budgetUsd. Cache hits cost
// nothing and never touch the budget.

export class ImageBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageBudgetExceededError';
  }
}

export class ImageBudget {
  private spentUsd = 0;

  constructor(private readonly limitUsd?: number) {}

  get spent(): number {
    return this.spentUsd;
  }

  wouldExceed(costUsd: number): boolean {
    if (this.limitUsd === undefined) return false;
    return this.spentUsd + costUsd > this.limitUsd + 1e-9;
  }

  /** Charge a generation to the budget; throws if it would exceed the limit. */
  charge(costUsd: number): void {
    if (this.wouldExceed(costUsd)) {
      throw new ImageBudgetExceededError(
        `Image generation budget exceeded: ${(this.spentUsd + costUsd).toFixed(2)} USD would exceed limit ${this.limitUsd?.toFixed(2)} USD`,
      );
    }
    this.spentUsd += costUsd;
  }
}
