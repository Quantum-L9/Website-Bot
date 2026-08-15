// L9_META: layer=campaign, role=quality_dimension_result, status=active, version=1.0.0
/**
 * QualityDimensionResult — atomic, queryable dimension outputs (design contract §7).
 * QualityDeltaReport becomes an aggregate index over these; this module never
 * redefines the truth-plane report itself.
 */
import type { LearningArtifactRef } from './types.js';
import { payloadDigestOf } from './semantic-digest.js';
import type {
  ConfidenceClass,
  DimensionStatus,
  QualityDimension,
  QualityDimensionResult,
  QualityVerdict,
  MutationLayer,
} from './types.js';
import { assertQualityDimension, isQualityDimension } from './quality-dimensions.js';

export interface QualityDimensionResultInput {
  dimension: string;
  candidate_id: string;
  campaign_id: string;
  evidence?: {
    baseline?: string | null;
    champion?: string | null;
    challenger?: string | null;
  };
  verdict_vs_baseline?: QualityVerdict | null;
  verdict_vs_champion?: QualityVerdict | null;
  hard_gate?: boolean;
  responsible_layer?: MutationLayer;
  confidence?: ConfidenceClass;
  measurements?: Record<string, number>;
  status?: DimensionStatus;
  evidence_refs?: string[];
}

export function buildQualityDimensionResult(input: QualityDimensionResultInput): QualityDimensionResult {
  const dimension = assertQualityDimension(input.dimension);
  const status: DimensionStatus = input.status ?? 'PASS';
  const verdictsPresent = input.verdict_vs_baseline != null || input.verdict_vs_champion != null;
  if (status === 'INCONCLUSIVE' && verdictsPresent) {
    throw new Error(`Dimension ${dimension} cannot be INCONCLUSIVE with verdicts present`);
  }
  const measurements = input.measurements ?? {};
  for (const key of Object.keys(measurements)) {
    if (typeof measurements[key] !== 'number' || !Number.isFinite(measurements[key])) {
      throw new Error(`Measurement ${key} for ${dimension} must be a finite number`);
    }
  }
  const result: QualityDimensionResult = {
    schema: 'website-bot.quality-dimension-result/v1',
    schema_version: '1.0.0',
    dimension,
    candidate_id: input.candidate_id,
    campaign_id: input.campaign_id,
    evidence: {
      baseline: input.evidence?.baseline ?? null,
      champion: input.evidence?.champion ?? null,
      challenger: input.evidence?.challenger ?? null,
    },
    verdict_vs_baseline: input.verdict_vs_baseline ?? null,
    verdict_vs_champion: input.verdict_vs_champion ?? null,
    hard_gate: input.hard_gate ?? false,
    responsible_layer: input.responsible_layer ?? 'DESIGN',
    confidence: input.confidence ?? 'MEDIUM',
    measurements,
    status,
    evidence_refs: [...(input.evidence_refs ?? [])].sort(),
  };
  return result;
}

/** Content-addressed identity for a dimension result (observed artifact conventions). */
export function qualityDimensionResultRef(result: QualityDimensionResult): LearningArtifactRef {
  const digest = payloadDigestOf({
    protocol: 'l9.website-bot.learning-plane',
    protocol_version: '1',
    artifact_type: 'QualityDimensionResult',
    input_refs: [],
    payload: result,
  });
  return { artifact_type: 'QualityDimensionResult', artifact_id: `QualityDimensionResult:${digest}`, payload_digest: digest };
}

export function validateQualityDimensionResult(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['not an object'];
  const result = value as Partial<QualityDimensionResult>;
  const errors: string[] = [];
  if (result.schema !== 'website-bot.quality-dimension-result/v1') errors.push('schema must be website-bot.quality-dimension-result/v1');
  if (typeof result.dimension !== 'string' || !isQualityDimension(result.dimension)) {
    errors.push('dimension must be a locked quality dimension');
  }
  if (typeof result.candidate_id !== 'string' || !result.candidate_id) errors.push('candidate_id required');
  if (typeof result.campaign_id !== 'string' || !result.campaign_id) errors.push('campaign_id required');
  if (result.status !== 'PASS' && result.status !== 'FAIL' && result.status !== 'INCONCLUSIVE') {
    errors.push('status must be PASS | FAIL | INCONCLUSIVE');
  }
  return errors;
}

/** Verdicts that count as a regression for promotion/gating logic. */
export function isRegression(verdict: QualityVerdict | null): boolean {
  return verdict === 'REGRESSED';
}

export function isImprovement(verdict: QualityVerdict | null): boolean {
  return verdict === 'IMPROVED';
}
