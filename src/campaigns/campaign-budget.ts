// L9_META: layer=campaign, role=campaign_budget, status=active, version=1.0.0
/**
 * Campaign budgets and no-progress accounting (design contract §10).
 * Budget defaults are locked in the execution contract; unbounded iteration
 * is forbidden.
 */
export { DEFAULT_CAMPAIGN_BUDGET } from "./types.js";

import type { CampaignManifest } from "./types.js";

export function budgetExhausted(
  manifest: CampaignManifest,
  budget: CampaignManifest["budget"],
): boolean {
  const attempts = manifest.attempts;
  if (attempts.total_candidates >= budget.max_candidate_builds) return true;
  if (attempts.blueprint_replans > budget.max_blueprint_replans) return true;
  if (attempts.content_regenerations > budget.max_content_regenerations) return true;
  if (manifest.attempts.no_progress_rounds > budget.stop_after_no_improvement_rounds) return true;
  return false;
}

export function repairsBudgeted(manifest: CampaignManifest, candidateId: string): boolean {
  const repairs = manifest.attempts.repairs_by_candidate[candidateId] ?? 0;
  return repairs < manifest.budget.max_targeted_repairs_per_candidate;
}

export function recordRepair(manifest: CampaignManifest, candidateId: string): CampaignManifest {
  return {
    ...manifest,
    attempts: {
      ...manifest.attempts,
      repairs_by_candidate: {
        ...manifest.attempts.repairs_by_candidate,
        [candidateId]: (manifest.attempts.repairs_by_candidate[candidateId] ?? 0) + 1,
      },
    },
  };
}

export interface NoProgressInput {
  challenger_beats_champion: boolean;
  same_fingerprint_persists: boolean;
  repair_yielded_material_improvement: boolean | null;
}

/** No-progress counts when a challenger does not beat the champion, the same
 *  failure fingerprint persists, or a repair yields no material improvement. */
export function countsAsNoProgress(input: NoProgressInput): boolean {
  if (!input.challenger_beats_champion) return true;
  if (input.same_fingerprint_persists) return true;
  if (input.repair_yielded_material_improvement === false) return true;
  return false;
}
