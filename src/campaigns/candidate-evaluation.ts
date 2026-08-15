// L9_META: layer=campaign, role=candidate_evaluation, status=active, version=1.0.0
/**
 * CandidateEvaluation with FailureFingerprint, ChampionDelta, and the champion
 * promotion predicate (design contract §4.3, §9, §10).
 * Dual evaluation against baseline and champion is mandatory. The champion is
 * immutable; challenger failure never destroys it.
 */
import { payloadDigestOf } from './semantic-digest.js';
import { isHardGateDimension } from './quality-dimensions.js';
import { utilityOf } from './quality-delta-index.js';
import { type CandidateDisposition, type CandidateEvaluation, type ChampionDelta, type FailureFingerprint, type LearningArtifactRef, type QualityDeltaIndex, type QualityDimension, type QualityDimensionResult, type QualityVerdict } from './types.js';


export interface BuildCandidateEvaluationInput {
  campaign_id: string;
  candidate_id: string;
  index: QualityDeltaIndex;
  champion_index?: QualityDeltaIndex | null;
  target_dimension?: QualityDimension | null;
  disposition?: CandidateDisposition;
  reviewable: boolean;
}

export function buildCandidateEvaluation(input: BuildCandidateEvaluationInput): CandidateEvaluation {
  const results = input.index.results;
  const groups = groupResults(results, input.target_dimension);
  const failureFingerprint = buildFailureFingerprint(results);
  const championDelta = input.champion_index
    ? buildChampionDelta(input.index, input.champion_index, input.target_dimension ?? null)
    : null;
  const payload: Omit<CandidateEvaluation, 'integrity'> = {
    schema: 'website-bot.candidate-evaluation/v1',
    schema_version: '1.0.0',
    candidate_id: input.candidate_id,
    campaign_id: input.campaign_id,
    evaluated_against: input.champion_index ? ['BASELINE', 'CHAMPION'] : ['BASELINE'],
    dimension_results: results,
    groups,
    failure_fingerprint: failureFingerprint,
    champion_delta: championDelta,
    reviewable: input.reviewable,
    disposition: input.disposition ?? 'REJECTED',
  };
  const digest = payloadDigestOf({
    protocol: 'l9.website-bot.learning-plane',
    protocol_version: '1',
    artifact_type: 'CandidateEvaluation',
    input_refs: [],
    payload,
  });
  return { ...payload, integrity: { algorithm: 'sha256', payload_digest: digest } };
}

function groupResults(results: QualityDimensionResult[], targetDimension: QualityDimension | null | undefined): CandidateEvaluation['groups'] {
  const target: QualityDimension[] = [];
  const guardrail: QualityDimension[] = [];
  const sideEffects: QualityDimension[] = [];
  for (const result of results) {
    if (targetDimension && result.dimension === targetDimension) target.push(result.dimension);
    else if (result.verdict_vs_baseline === 'REGRESSED' || result.status === 'FAIL') guardrail.push(result.dimension);
    else if (result.verdict_vs_baseline === 'IMPROVED') sideEffects.push(result.dimension);
  }
  return { target, guardrail, side_effects: sideEffects };
}

function buildFailureFingerprint(results: QualityDimensionResult[]): FailureFingerprint | null {
  const failed = results.filter(result => result.status === 'FAIL' || result.verdict_vs_baseline === 'REGRESSED');
  if (failed.length === 0) return null;
  const primary = failed.find(result => result.hard_gate) ?? failed[0];
  const dimensions: FailureFingerprint['dimensions'] = {};
  for (const result of failed) {
    dimensions[result.dimension] = result.verdict_vs_baseline ?? undefined;
  }
  const structuralState: FailureFingerprint['structural_state'] = {};
  for (const result of results) {
    for (const [measurement, value] of Object.entries(result.measurements)) {
      structuralState[`${result.dimension}.${measurement}`] = value;
    }
  }
  return {
    primary_dimension: primary.dimension,
    dimensions,
    location: {
      page_archetype: 'homepage',
      component: componentForDimension(primary.dimension),
      viewport: viewportForDimension(primary.dimension),
    },
    structural_state: structuralState,
    suspected_layer: primary.responsible_layer,
  };
}

function componentForDimension(dimension: QualityDimension): string {
  if (dimension.startsWith('conversion.') || dimension.startsWith('visual.')) return 'hero';
  if (dimension.startsWith('responsive.')) return 'layout';
  if (dimension.startsWith('accessibility.')) return 'typography';
  return 'page';
}

function viewportForDimension(dimension: QualityDimension): string {
  if (dimension === 'conversion.mobile_cta' || dimension === 'responsive.touch_targets') return 'mobile';
  return 'desktop';
}

function buildChampionDelta(
  index: QualityDeltaIndex,
  championIndex: QualityDeltaIndex,
  targetDimension: QualityDimension | null,
): ChampionDelta {
  const dimension = targetDimension ?? 'conversion.primary_cta';
  const challenger = index.results.find(result => result.dimension === dimension);
  const champion = championIndex.results.find(result => result.dimension === dimension);
  const verdictVsChampion: QualityVerdict = compareVerdicts(
    challenger?.verdict_vs_baseline ?? null,
    champion?.verdict_vs_baseline ?? null,
  );
  return {
    target_dimension: dimension,
    verdict_vs_champion: verdictVsChampion,
    material: verdictVsChampion === 'IMPROVED',
    utility_vs_champion: utilityOf(index) - utilityOf(championIndex),
    utility_vs_baseline: utilityOf(index),
  };
}

function compareVerdicts(a: QualityVerdict | null, b: QualityVerdict | null): QualityVerdict {
  const rank = { REGRESSED: -1, NON_REGRESSED: 0, IMPROVED: 1 } as const;
  const ra = a === null ? 0 : rank[a];
  const rb = b === null ? 0 : rank[b];
  if (ra > rb) return 'IMPROVED';
  if (ra < rb) return 'REGRESSED';
  return 'NON_REGRESSED';
}

/**
 * Champion promotion predicate (all required, design contract §10):
 * target dimension materially improves; all hard gates pass; no new blocking
 * regression; absolute baseline comparison still passes; challenger utility >
 * champion utility. Returns {promote, reasons}.
 */
export function evaluateChampionPromotion(args: {
  challenger: QualityDeltaIndex;
  champion: QualityDeltaIndex;
  target_dimension: QualityDimension;
}): { promote: boolean; reasons: string[] } {
  const { challenger, champion, target_dimension } = args;
  const reasons: string[] = [];
  const challengerTarget = challenger.results.find(result => result.dimension === target_dimension);
  if (!challengerTarget || challengerTarget.verdict_vs_baseline !== 'IMPROVED') {
    reasons.push('target dimension did not materially improve');
  }
  if (challenger.aggregate.hard_gate_failures.length > 0) {
    reasons.push(`hard gates failed: ${challenger.aggregate.hard_gate_failures.join(', ')}`);
  }
  const newRegressions = challenger.aggregate.regressions_vs_baseline.filter(
    dimension => !champion.aggregate.regressions_vs_baseline.includes(dimension),
  );
  if (newRegressions.length > 0) {
    reasons.push(`new blocking regressions: ${newRegressions.join(', ')}`);
  }
  const championTarget = champion.results.find(result => result.dimension === target_dimension);
  const challengerFailsBaseline = challenger.results.some(
    result => isHardGateDimension(result.dimension) && result.status === 'FAIL',
  );
  if (challengerFailsBaseline) reasons.push('absolute baseline comparison fails (hard-gate FAIL)');
  if (championTarget && challengerTarget) {
    const challengerBetter = compareVerdicts(challengerTarget.verdict_vs_baseline, championTarget.verdict_vs_baseline) === 'IMPROVED';
    if (!challengerBetter && utilityOf(challenger) <= utilityOf(champion)) {
      reasons.push('challenger utility does not exceed champion utility');
    }
  }
  return { promote: reasons.length === 0, reasons };
}

export function candidateEvaluationRef(evaluation: CandidateEvaluation): LearningArtifactRef {
  return {
    artifact_type: 'CandidateEvaluation',
    artifact_id: `CandidateEvaluation:${evaluation.integrity.payload_digest}`,
    payload_digest: evaluation.integrity.payload_digest,
  };
}
