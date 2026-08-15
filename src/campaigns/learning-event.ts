// L9_META: layer=campaign, role=learning_event, status=active, version=1.0.0
/**
 * LearningEvent — causal mutation → outcome records (design contract §4.4).
 * Negative learning and anti-patterns are first-class. One run may create a
 * hypothesis; it may not create a high-confidence global learning.
 */
import { payloadDigestOf } from './semantic-digest.js';
import { assertQualityDimension } from './quality-dimensions.js';
import { type ConfidenceClass, type CounterfactualPair, type DimensionStatus, type HypothesisOutcome, type LearningArtifactRef, type LearningEvent, type MemoryScope, type MutationLayer, type QualityVerdict } from './types.js';


export interface LearningEventInput {
  learning_id: string;
  campaign_id: string;
  candidate_id: string;
  parent_candidate_id: string | null;
  context: {
    vertical: string;
    page_archetype: string;
    component: string;
    viewport: string;
    quality_dimension: string;
  };
  hypothesis: string;
  mutation_ref: LearningArtifactRef | null;
  before: { quality_result: QualityVerdict | DimensionStatus | null };
  after: { quality_result: QualityVerdict | DimensionStatus | null };
  side_effects: Record<string, string>;
  outcome: HypothesisOutcome;
  anti_pattern?: { invariant: string } | null;
  counterfactual_pair?: CounterfactualPair | null;
  attribution_feedback?: {
    original_layer: MutationLayer;
    actual_layer: MutationLayer;
    original_confidence: number;
    result: 'MISATTRIBUTED' | 'CONFIRMED';
  } | null;
  scope_recommendation?: MemoryScope;
  evidence_refs?: string[];
  confirmations?: number;
  contradictions?: number;
  human_approval_correlation?: number;
  context_similarity?: number;
}

/** Deterministic confidence-class rule (design contract §4.4). */
export function confidenceClassOf(input: {
  causal_isolation: boolean;
  confirmations: number;
  contradictions: number;
}): ConfidenceClass {
  if (input.causal_isolation && input.confirmations >= 2 && input.contradictions === 0) return 'HIGH';
  if (input.causal_isolation && input.confirmations >= 1 && input.contradictions === 0) return 'MEDIUM';
  return 'LOW';
}

export function buildLearningEvent(input: LearningEventInput): LearningEvent {
  if (!input.learning_id) throw new Error('learning_id required');
  const dimension = assertQualityDimension(input.context.quality_dimension);
  const confirmations = input.confirmations ?? (input.outcome === 'CONFIRMED_FOR_CAMPAIGN' ? 1 : 0);
  const contradictions = input.contradictions ?? (input.outcome === 'CONTRADICTED' ? 1 : 0);
  const causal_isolation = Boolean(input.counterfactual_pair && input.counterfactual_pair.unchanged.length > 0);
  const payload: Omit<LearningEvent, 'integrity'> = {
    schema: 'website-bot.learning-event/v1',
    schema_version: '1.0.0',
    artifact_type: 'LearningEvent',
    learning_id: input.learning_id,
    source: {
      campaign_id: input.campaign_id,
      candidate_id: input.candidate_id,
      parent_candidate_id: input.parent_candidate_id,
    },
    context: { ...input.context, quality_dimension: dimension },
    hypothesis: input.hypothesis,
    mutation_ref: input.mutation_ref,
    before: input.before,
    after: input.after,
    side_effects: Object.fromEntries(
      Object.entries(input.side_effects).map(([key, value]) => [assertQualityDimension(key), value]),
    ) as LearningEvent['side_effects'],
    outcome: input.outcome,
    anti_pattern: input.anti_pattern ?? null,
    counterfactual_pair: input.counterfactual_pair ?? null,
    attribution_feedback: input.attribution_feedback ?? null,
    scope_recommendation: input.scope_recommendation ?? 'SITE_CAMPAIGN',
    evidence_refs: [...(input.evidence_refs ?? [])].sort((a, b) => a.localeCompare(b)),
    confidence: {
      class: confidenceClassOf({ causal_isolation, confirmations, contradictions }),
      causal_isolation,
      confirmations,
      contradictions,
      human_approval_correlation: input.human_approval_correlation ?? 0,
      context_similarity: input.context_similarity ?? 0,
    },
  };
  const digest = payloadDigestOf({
    protocol: 'l9.website-bot.learning-plane',
    protocol_version: '1',
    artifact_type: 'LearningEvent',
    input_refs: input.mutation_ref ? [input.mutation_ref] : [],
    payload,
  });
  return { ...payload, integrity: { algorithm: 'sha256', payload_digest: digest } };
}

export function learningEventRef(event: LearningEvent): LearningArtifactRef {
  return {
    artifact_type: 'LearningEvent',
    artifact_id: `LearningEvent:${event.integrity.payload_digest}`,
    payload_digest: event.integrity.payload_digest,
  };
}

export function isNegativeLearning(event: LearningEvent): boolean {
  return event.outcome === 'REJECTED' || event.outcome === 'CONTRADICTED' || event.anti_pattern !== null;
}
