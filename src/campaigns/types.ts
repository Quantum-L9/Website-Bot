// L9_META: layer=campaign, role=learning_plane_types, status=active, version=1.0.0
/**
 * Learning-plane type system (design contract §4–§5).
 * Thin and reference-heavy: everything points back into the artifact DAG via ArtifactRef.
 */
import type { ArtifactRef } from '@quantum-l9/bot-interop';
import type {
  ConfidenceClass,
  DimensionStatus,
  QualityDimension,
  QualityVerdict,
} from './quality-dimensions.js';

export { ArtifactRef };
export type {
  ConfidenceClass,
  DimensionStatus,
  QualityDimension,
  QualityVerdict,
};

/**
 * Shape-compatible reference for learning-plane artifacts. bot-interop's
 * ArtifactRef constrains artifact_type to the truth-plane union; the learning
 * plane keeps the same three-field shape with a stringly artifact_type so the
 * shared package contract is untouched (design contract §2).
 */
export interface LearningArtifactRef {
  artifact_type: string;
  artifact_id: string;
  payload_digest: string;
}

/** Shape-compatible reference for truth-plane artifacts read from persisted records. */
export interface ArtifactRefLike {
  artifact_type: string;
  artifact_id: string;
  payload_digest: string;
}

// ---------------------------------------------------------------------------
// Campaign state
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['RUNNING', 'REVIEWABLE', 'EXHAUSTED', 'BLOCKED', 'APPROVED', 'REJECTED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RUNNER_TERMINAL_STATES = ['REVIEWABLE', 'EXHAUSTED', 'BLOCKED', 'NO_PROGRESS', 'FATAL'] as const;
export type RunnerTerminalState = (typeof RUNNER_TERMINAL_STATES)[number];

export const MUTATION_LAYERS = ['INITIAL', 'INTELLIGENCE', 'BLUEPRINT', 'CONTENT', 'DESIGN', 'ASSET', 'ASSEMBLY', 'REPAIR'] as const;
export type MutationLayer = (typeof MUTATION_LAYERS)[number];

export const CANDIDATE_DISPOSITIONS = ['CHAMPION', 'REJECTED', 'SUPERSEDED', 'REVIEWABLE'] as const;
export type CandidateDisposition = (typeof CANDIDATE_DISPOSITIONS)[number];

export const HYPOTHESIS_OUTCOMES = ['CONFIRMED_FOR_CAMPAIGN', 'REJECTED', 'INCONCLUSIVE', 'CONTRADICTED'] as const;
export type HypothesisOutcome = (typeof HYPOTHESIS_OUTCOMES)[number];

export const MEMORY_SCOPES = ['RUN_LOCAL', 'SITE_CAMPAIGN', 'VERTICAL', 'GLOBAL'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const PROMOTION_STATES = [
  'CAMPAIGN_LOCAL',
  'SITE_CONFIRMED',
  'VERTICAL_CANDIDATE',
  'VERTICAL_CONFIRMED',
  'GLOBAL_CANDIDATE',
  'GLOBAL_CONFIRMED',
] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export const PROMOTION_SCOPES = ['SITE', 'VERTICAL', 'GLOBAL'] as const;
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

export interface CampaignBudget {
  max_candidate_builds: number;
  max_targeted_repairs_per_candidate: number;
  max_blueprint_replans: number;
  max_content_regenerations: number;
  stop_after_no_improvement_rounds: number;
  require_reviewable: boolean;
}

export const DEFAULT_CAMPAIGN_BUDGET: CampaignBudget = {
  max_candidate_builds: 4,
  max_targeted_repairs_per_candidate: 1,
  max_blueprint_replans: 1,
  max_content_regenerations: 1,
  stop_after_no_improvement_rounds: 2,
  require_reviewable: true,
};

// ---------------------------------------------------------------------------
// Signal structures (§5)
// ---------------------------------------------------------------------------

export interface ContextSignature {
  vertical: string;
  market_model: string;
  conversion_model: string;
  consideration_level: string;
  service_complexity: string;
  location_strategy: string;
  trust_dependency: string;
  page_archetypes: string[];
  brand_maturity: string;
  baseline_quality: string;
}

export interface MutationSignature {
  layer: MutationLayer;
  archetype: string;
  component: string;
  operation_class: string;
  dimensions: {
    target: QualityDimension[];
    guardrails: QualityDimension[];
  };
  context: {
    vertical: string;
    conversion_model: string;
    mobile_priority: string;
  };
}

export interface FailureFingerprint {
  primary_dimension: QualityDimension;
  dimensions: Partial<Record<QualityDimension, QualityVerdict>>;
  location: {
    page_archetype: string;
    component: string;
    viewport: string;
  };
  structural_state: Partial<Record<string, number>>;
  suspected_layer: MutationLayer;
}

export interface CounterfactualPair {
  before_candidate: string;
  after_candidate: string;
  controlled_differences: string[];
  unchanged: string[];
  quality_movements: Partial<Record<QualityDimension, QualityVerdict>>;
}

export interface HumanMachineGap {
  human_reason: string;
  machine_quality: Partial<Record<QualityDimension, QualityVerdict>>;
  unmeasured_signal_candidate: string;
}

// ---------------------------------------------------------------------------
// Learning-plane artifacts (§4)
// ---------------------------------------------------------------------------

export interface CampaignManifest {
  schema: 'website-bot.campaign-manifest/v1';
  schema_version: '1.0.0';
  campaign_id: string;
  source_url: string;
  site_slug: string;
  status: CampaignStatus;
  convergence_target: 'REVIEWABLE';
  context_signature: ContextSignature;
  baseline_ref: ArtifactRef | null;
  champion: {
    candidate_id: string;
    build_ref: LearningArtifactRef;
    evaluation_ref: LearningArtifactRef;
  } | null;
  attempts: {
    total_candidates: number;
    no_progress_rounds: number;
    blueprint_replans: number;
    content_regenerations: number;
    repairs_by_candidate: Record<string, number>;
  };
  budget: CampaignBudget;
  reviewable: boolean;
  persistent_blocking_dimension: string | null;
  persistent_responsible_layer: MutationLayer | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  integrity: {
    algorithm: 'sha256';
    payload_digest: string;
  };
}

export interface CandidateMutationPlan {
  schema: 'website-bot.candidate-mutation-plan/v1';
  schema_version: '1.0.0';
  artifact_type: 'CandidateMutationPlan';
  candidate_id: string;
  parent_candidate_id: string | null;
  mutation: {
    layer: MutationLayer;
    target_paths: string[];
    forbidden_paths: string[];
    unchanged_contract: string[];
  };
  hypothesis: {
    primary_dimension: QualityDimension;
    guardrail_dimensions: QualityDimension[];
  };
  expected_causal_path: string[];
  expected_effects: Partial<Record<QualityDimension, QualityVerdict>>;
  confidence_before: number;
  inherited_artifacts: Record<string, ArtifactRefLike>;
  experimental_control: {
    inherited_exact: ArtifactRefLike[];
    changed: string[];
  };
  mutation_signature: MutationSignature;
  integrity: {
    algorithm: 'sha256';
    payload_digest: string;
  };
}

export interface QualityDimensionResult {
  schema: 'website-bot.quality-dimension-result/v1';
  schema_version: '1.0.0';
  dimension: QualityDimension;
  candidate_id: string;
  campaign_id: string;
  evidence: {
    baseline: string | null;
    champion: string | null;
    challenger: string | null;
  };
  verdict_vs_baseline: QualityVerdict | null;
  verdict_vs_champion: QualityVerdict | null;
  hard_gate: boolean;
  responsible_layer: MutationLayer;
  confidence: ConfidenceClass;
  measurements: Partial<Record<string, number>>;
  status: DimensionStatus;
  evidence_refs: string[];
}

export interface QualityDeltaIndex {
  schema: 'website-bot.quality-delta-index/v1';
  schema_version: '1.0.0';
  campaign_id: string;
  candidate_id: string;
  results: QualityDimensionResult[];
  aggregate: {
    hard_gate_failures: QualityDimension[];
    regressions_vs_baseline: QualityDimension[];
    regressions_vs_champion: QualityDimension[];
    inconclusive: QualityDimension[];
  };
}

export interface ChampionDelta {
  target_dimension: QualityDimension;
  verdict_vs_champion: QualityVerdict;
  material: boolean;
  utility_vs_champion: number;
  utility_vs_baseline: number;
}

export interface CandidateEvaluation {
  schema: 'website-bot.candidate-evaluation/v1';
  schema_version: '1.0.0';
  candidate_id: string;
  campaign_id: string;
  evaluated_against: Array<'BASELINE' | 'CHAMPION'>;
  dimension_results: QualityDimensionResult[];
  groups: {
    target: QualityDimension[];
    guardrail: QualityDimension[];
    side_effects: QualityDimension[];
  };
  failure_fingerprint: FailureFingerprint | null;
  champion_delta: ChampionDelta | null;
  reviewable: boolean;
  disposition: CandidateDisposition;
  integrity: {
    algorithm: 'sha256';
    payload_digest: string;
  };
}

export interface LearningEvent {
  schema: 'website-bot.learning-event/v1';
  schema_version: '1.0.0';
  artifact_type: 'LearningEvent';
  learning_id: string;
  source: {
    campaign_id: string;
    candidate_id: string;
    parent_candidate_id: string | null;
  };
  context: {
    vertical: string;
    page_archetype: string;
    component: string;
    viewport: string;
    quality_dimension: QualityDimension;
  };
  hypothesis: string;
  mutation_ref: LearningArtifactRef | null;
  before: { quality_result: QualityVerdict | DimensionStatus | null };
  after: { quality_result: QualityVerdict | DimensionStatus | null };
  side_effects: Partial<Record<QualityDimension, QualityVerdict>>;
  outcome: HypothesisOutcome;
  anti_pattern: { invariant: string } | null;
  counterfactual_pair: CounterfactualPair | null;
  attribution_feedback: {
    original_layer: MutationLayer;
    actual_layer: MutationLayer;
    original_confidence: number;
    result: 'MISATTRIBUTED' | 'CONFIRMED';
  } | null;
  scope_recommendation: MemoryScope;
  evidence_refs: string[];
  confidence: {
    class: ConfidenceClass;
    causal_isolation: boolean;
    confirmations: number;
    contradictions: number;
    human_approval_correlation: number;
    context_similarity: number;
  };
  integrity: {
    algorithm: 'sha256';
    payload_digest: string;
  };
}

export interface PromotionCandidate {
  schema: 'website-bot.promotion-candidate/v1';
  schema_version: '1.0.0';
  promotion_id: string;
  learning_ids: string[];
  scope: PromotionScope;
  vertical: string | null;
  supporting_campaigns: string[];
  contradicting_campaigns: string[];
  wins: number;
  losses: number;
  inconclusive: number;
  human_approved_campaigns: number;
  confidence: ConfidenceClass;
  owning_component: string;
  proposed_invariant: string;
  acceptance_test: string;
  risk: string;
  human_approval_required: boolean;
  status: 'PROPOSED' | 'APPROVED_BY_HUMAN' | 'REJECTED';
  promotion_state: PromotionState;
}

export interface HumanReviewReceipt {
  schema: 'website-bot.human-review-receipt/v1';
  schema_version: '1.0.0';
  receipt_id: string;
  campaign_id: string;
  candidate_id: string;
  decision: 'APPROVED' | 'REJECTED' | 'APPROVE_WITH_NOTES';
  positives: string[];
  negatives: string[];
  blocking_negatives: string[];
  preference_signals: string[];
  tags: string[];
  human_machine_gap: HumanMachineGap | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type RunnerWatchSink = (event: string) => void;

export interface CampaignDeps {
  evaluateCandidate(candidateId: string): Promise<QualityDeltaIndex>;
  retrieveLearnings(query: {
    context: ContextSignature;
    fingerprint: FailureFingerprint;
    layer: MutationLayer;
  }): Promise<unknown[]>;
  proposeMutation(args: {
    campaign: CampaignManifest;
    failure: FailureFingerprint;
    learnings: unknown[];
  }): Promise<CandidateMutationPlan>;
  buildIncrementally(plan: CandidateMutationPlan): Promise<{ buildRef: LearningArtifactRef | null }>;
  runCheapestAdequateTests(plan: CandidateMutationPlan): Promise<{ viable: boolean }>;
  watch?: RunnerWatchSink;
}

export interface RunnerOutcome {
  terminal: RunnerTerminalState;
  campaign: CampaignManifest;
  escalation: {
    best_candidate: string;
    persistent_blocking_dimension: string | null;
    earliest_responsible_layer: MutationLayer | null;
    attempts: number;
    recommendation: string;
  } | null;
}
