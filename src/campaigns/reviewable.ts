// L9_META: layer=campaign, role=reviewable_gate, status=active, version=1.0.0
/**
 * The deterministic REVIEWABLE gate (design contract §9).
 * A pure boolean over QualityDimensionResult verdicts and campaign state.
 * An LLM never decides the final boolean. Identical inputs produce an
 * identical output.
 */
import type {
  CampaignManifest,
  MutationLayer,
  QualityDeltaIndex,
  QualityDimension,
  QualityDimensionResult,
} from './types.js';
import { dimensionResultOf } from './quality-delta-index.js';
import { isHardGateDimension } from './quality-dimensions.js';

export interface ReviewableInput {
  index: QualityDeltaIndex;
  build_passed: boolean;
  business_truth_passed: boolean;
  artifact_lineage_passed: boolean;
  blueprint_conformance_passed: boolean;
  seo_content_contract_passed: boolean;
  campaign_confidence_sufficient: boolean;
  champion_index?: QualityDeltaIndex | null;
}

const ALLOWED_CONVERSION_VERDICTS = new Set(['IMPROVED', 'NON_REGRESSED']);

function passesGateChecks(input: ReviewableInput, index: QualityDeltaIndex): boolean {
  if (!input.build_passed) return false;
  if (!input.business_truth_passed) return false;
  if (!input.artifact_lineage_passed) return false;
  if (!input.blueprint_conformance_passed) return false;
  if (!input.seo_content_contract_passed) return false;
  if (!input.campaign_confidence_sufficient) return false;

  // Accessibility and responsive must have no blocking regression (no hard-gate FAIL).
  if (hardGateFailuresOf(index, 'accessibility').length > 0) return false;
  if (hardGateFailuresOf(index, 'responsive').length > 0) return false;

  // No blocking INCONCLUSIVE and no unresolved blocking defect (hard-gate FAIL).
  if (index.aggregate.inconclusive.some(dimension => isHardGateDimension(dimension))) return false;
  if (index.aggregate.hard_gate_failures.length > 0) return false;
  return true;
}

function passesConversionChecks(index: QualityDeltaIndex): boolean {
  // conversion_clarity / visual_hierarchy / trust_presentation in {IMPROVED, NON_REGRESSED}
  const conversionClarity = bestVerdictOf(index, [
    'conversion.primary_cta',
    'conversion.mobile_cta',
    'conversion.trust_visibility',
  ]);
  const visualHierarchy = verdictOf(index, 'visual.hierarchy');
  const trustPresentation = verdictOf(index, 'conversion.trust_visibility');
  for (const verdict of [conversionClarity, visualHierarchy, trustPresentation]) {
    if (verdict === null || !ALLOWED_CONVERSION_VERDICTS.has(verdict)) return false;
  }
  return true;
}

function passesChampionCheck(input: ReviewableInput, index: QualityDeltaIndex): boolean {
  if (!input.champion_index) return true;
  // candidate >= champion: no regression vs champion on any hard-gate dimension.
  for (const result of index.results) {
    if (!isHardGateDimension(result.dimension)) continue;
    const championResult = dimensionResultOf(input.champion_index, result.dimension);
    if (championResult && result.verdict_vs_champion === 'REGRESSED') return false;
  }
  return true;
}

export function isReviewable(input: ReviewableInput): boolean {
  const { index } = input;
  if (!passesGateChecks(input, index)) return false;
  if (!passesConversionChecks(index)) return false;
  if (!passesChampionCheck(input, index)) return false;
  return true;
}

function hardGateFailuresOf(index: QualityDeltaIndex, family: string): QualityDimension[] {
  return index.results
    .filter(result => result.dimension.startsWith(`${family}.`) && result.hard_gate && result.status === 'FAIL')
    .map(result => result.dimension);
}

function verdictOf(index: QualityDeltaIndex, dimension: QualityDimension): QualityDimensionResult['verdict_vs_baseline'] {
  return dimensionResultOf(index, dimension)?.verdict_vs_baseline ?? null;
}

/** Best (highest) verdict across a set of dimensions. */
function bestVerdictOf(index: QualityDeltaIndex, dimensions: QualityDimension[]): QualityDimensionResult['verdict_vs_baseline'] {
  const rank: Record<string, number> = { REGRESSED: -1, NON_REGRESSED: 0, IMPROVED: 1 };
  let best: QualityDimensionResult['verdict_vs_baseline'] = null;
  for (const dimension of dimensions) {
    const verdict = verdictOf(index, dimension);
    if (verdict === null) continue;
    if (best === null || rank[verdict] > rank[best]) best = verdict;
  }
  return best;
}

/**
 * Exhaustion escalation (design contract §9): the best non-reviewable candidate
 * is never shown as a normal design review; the operator gets an escalation.
 */
export function buildExhaustionEscalation(args: {
  campaign: CampaignManifest;
  best_candidate_id: string;
  persistent_blocking_dimension: string | null;
  earliest_responsible_layer: MutationLayer | null;
}): {
  best_candidate: string;
  persistent_blocking_dimension: string | null;
  earliest_responsible_layer: MutationLayer | null;
  attempts: number;
  recommendation: string;
} {
  return {
    best_candidate: args.best_candidate_id,
    persistent_blocking_dimension: args.persistent_blocking_dimension,
    earliest_responsible_layer: args.earliest_responsible_layer,
    attempts: args.campaign.attempts.total_candidates,
    recommendation: 'human architecture or design intervention',
  };
}
