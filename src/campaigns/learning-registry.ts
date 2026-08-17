// L9_META: layer=campaign, role=learning_registry, status=active, version=1.0.0
/**
 * LearningRegistry — proposal-only promotion surface with problem-first
 * retrieval (design contract §12). The runtime never self-modifies prompts or
 * canonical heuristics; promotions are proposals for human acceptance.
 * Retrieval keys (all six): responsible_layer, quality_dimension,
 * page_archetype, component, vertical, failure_fingerprint.
 * Ranking: context-signature similarity vs the querying campaign.
 */
import type {
  ContextSignature,
  FailureFingerprint,
  LearningEvent,
  MutationLayer,
  PromotionCandidate,
  PromotionScope,
  PromotionState,
  QualityDimension,
} from './types.js';
import { isNegativeLearning } from './learning-event.js';

export interface RegistryQuery {
  layer: MutationLayer;
  dimension: QualityDimension;
  archetype?: string;
  component?: string;
  vertical?: string;
  fingerprint?: FailureFingerprint;
  context?: ContextSignature;
}

export interface RetrievalResult {
  event: LearningEvent;
  similarity: number;
}

/** Deterministic context similarity: weighted matches on the six retrieval keys. */
export function contextSimilarity(event: LearningEvent, query: RegistryQuery): number {
  let score = 0;
  if (query.vertical && event.context.vertical === query.vertical) score += 0.25;
  if (query.archetype && event.context.page_archetype === query.archetype) score += 0.2;
  if (query.component && event.context.component === query.component) score += 0.2;
  if (event.context.quality_dimension === query.dimension) score += 0.2;
  if (event.attribution_feedback?.actual_layer === query.layer) score += 0.15;
  return score;
}

/**
 * Problem-first retrieval: rank events by context similarity, return confirmed
 * learnings and known anti-patterns separately so planners see both.
 */
export function retrieveRelevantLearnings(events: LearningEvent[], query: RegistryQuery): {
  confirmed: RetrievalResult[];
  anti_patterns: RetrievalResult[];
  contradictions: RetrievalResult[];
} {
  const scored = events.map(event => ({ event, similarity: contextSimilarity(event, query) }));
  const confirmed = scored
    .filter(({ event, similarity }) => similarity > 0 && !isNegativeLearning(event) && event.outcome === 'CONFIRMED_FOR_CAMPAIGN')
    .sort((a, b) => b.similarity - a.similarity);
  const anti_patterns = scored
    .filter(({ event, similarity }) => similarity > 0 && event.anti_pattern !== null)
    .sort((a, b) => b.similarity - a.similarity);
  const contradictions = scored
    .filter(({ event, similarity }) => similarity > 0 && event.outcome === 'CONTRADICTED')
    .sort((a, b) => b.similarity - a.similarity);
  return { confirmed, anti_patterns, contradictions };
}

export interface PromotionCandidateInput {
  promotion_id: string;
  learning_ids: string[];
  scope: PromotionScope;
  vertical?: string | null;
  supporting_campaigns?: string[];
  contradicting_campaigns?: string[];
  wins?: number;
  losses?: number;
  inconclusive?: number;
  human_approved_campaigns?: number;
  owning_component: string;
  proposed_invariant: string;
  acceptance_test: string;
  risk: string;
  human_approval_required?: boolean;
}

export function buildPromotionCandidate(input: PromotionCandidateInput): PromotionCandidate {
  if (!input.promotion_id || !input.owning_component || !input.proposed_invariant) {
    throw new Error('promotion_id, owning_component, and proposed_invariant are required');
  }
  const wins = input.wins ?? 0;
  const losses = input.losses ?? 0;
  const human_approved_campaigns = input.human_approved_campaigns ?? 0;
  const confidence = promotionConfidence(wins, losses, human_approved_campaigns);
  const promotionState = promotionStateFor(input.scope, human_approved_campaigns);
  const humanApprovalRequired = input.scope === 'GLOBAL' || input.human_approval_required === true;
  return {
    schema: 'website-bot.promotion-candidate/v1',
    schema_version: '1.0.0',
    promotion_id: input.promotion_id,
    learning_ids: [...input.learning_ids],
    scope: input.scope,
    vertical: input.vertical ?? null,
    supporting_campaigns: [...(input.supporting_campaigns ?? [])],
    contradicting_campaigns: [...(input.contradicting_campaigns ?? [])],
    wins,
    losses,
    inconclusive: input.inconclusive ?? 0,
    human_approved_campaigns,
    confidence,
    owning_component: input.owning_component,
    proposed_invariant: input.proposed_invariant,
    acceptance_test: input.acceptance_test,
    risk: input.risk,
    human_approval_required: humanApprovalRequired,
    status: 'PROPOSED',
    promotion_state: promotionState,
  };
}

/** Deterministic evidence-weighted confidence (design contract §10). */
export function promotionConfidence(wins: number, losses: number, humanApproved: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  const total = wins + losses;
  if (total >= 4 && wins / total >= 0.75 && humanApproved >= 1) return 'HIGH';
  if (total >= 2 && wins / total >= 0.5) return 'MEDIUM';
  return 'LOW';
}

export function promotionStateFor(scope: PromotionScope, humanApproved: number): PromotionState {
  switch (scope) {
    case 'SITE': return 'SITE_CONFIRMED';
    case 'VERTICAL': return 'VERTICAL_CANDIDATE';
    case 'GLOBAL': return humanApproved >= 1 ? 'GLOBAL_CONFIRMED' : 'GLOBAL_CANDIDATE';
  }
}

/**
 * The promotion boundary (design contract §12): a single run may create a
 * hypothesis; it may not create a high-confidence global learning.
 * Enforcement is layered: confidence never reaches HIGH without human approval,
 * GLOBAL_CONFIRMED requires human approval, and this boundary blocks any
 * GLOBAL_CONFIRMED promotion that lacks it.
 */
export function isAllowedPromotion(promotion: PromotionCandidate): { allowed: boolean; reason: string | null } {
  if (
    promotion.scope === 'GLOBAL' &&
    promotion.promotion_state === 'GLOBAL_CONFIRMED' &&
    promotion.human_approved_campaigns === 0
  ) {
    return { allowed: false, reason: 'a single run cannot create a high-confidence global learning' };
  }
  return { allowed: true, reason: null };
}
