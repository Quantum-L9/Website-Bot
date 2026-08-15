// L9_META: layer=campaign, role=human_review_receipt, status=active, version=1.0.0
/**
 * HumanReviewReceipt and HumanMachineGap (design contract §4.6, §5.5).
 * Human approval/rejection is structural training evidence. A machine-REVIEWABLE
 * candidate that a human rejects produces a measurement gap — gaps propose new
 * measurable dimensions, never prompt edits.
 */
import type {
  HumanMachineGap,
  HumanReviewReceipt,
  QualityDimension,
  QualityVerdict,
} from './types.js';

export const HUMAN_REVIEW_DECISIONS = ['APPROVED', 'REJECTED', 'APPROVE_WITH_NOTES'] as const;
export type HumanReviewDecision = (typeof HUMAN_REVIEW_DECISIONS)[number];

export const HUMAN_REVIEW_TAGS = [
  'generic',
  'weak_branding',
  'weak_hero',
  'too_busy',
  'too_sparse',
  'great_hierarchy',
  'great_conversion',
  'great_mobile',
] as const;
export type HumanReviewTag = (typeof HUMAN_REVIEW_TAGS)[number];

export interface HumanReviewReceiptInput {
  receipt_id: string;
  campaign_id: string;
  candidate_id: string;
  decision: HumanReviewDecision;
  positives?: string[];
  negatives?: string[];
  blocking_negatives?: string[];
  preference_signals?: string[];
  tags?: HumanReviewTag[];
  machine_quality?: Partial<Record<QualityDimension, QualityVerdict>>;
  unmeasured_signal_candidate?: string | null;
  created_at?: string;
}

export function buildHumanReviewReceipt(input: HumanReviewReceiptInput): HumanReviewReceipt {
  if (!input.receipt_id) throw new Error('receipt_id required');
  if (!input.campaign_id || !input.candidate_id) throw new Error('campaign_id and candidate_id required');
  if (!(HUMAN_REVIEW_DECISIONS as readonly string[]).includes(input.decision)) {
    throw new Error(`decision must be one of ${HUMAN_REVIEW_DECISIONS.join('|')}`);
  }
  const tags = [...new Set(input.tags ?? [])];
  for (const tag of tags) {
    if (!(HUMAN_REVIEW_TAGS as readonly string[]).includes(tag)) {
      throw new Error(`unknown review tag: ${tag}`);
    }
  }
  const humanMachineGap = deriveHumanMachineGap({
    decision: input.decision,
    negatives: input.negatives ?? [],
    machine_quality: input.machine_quality ?? {},
    unmeasured_signal_candidate: input.unmeasured_signal_candidate ?? null,
  });
  return {
    schema: 'website-bot.human-review-receipt/v1',
    schema_version: '1.0.0',
    receipt_id: input.receipt_id,
    campaign_id: input.campaign_id,
    candidate_id: input.candidate_id,
    decision: input.decision,
    positives: [...(input.positives ?? [])],
    negatives: [...(input.negatives ?? [])],
    blocking_negatives: [...(input.blocking_negatives ?? [])],
    preference_signals: [...(input.preference_signals ?? [])],
    tags,
    human_machine_gap: humanMachineGap,
    created_at: input.created_at ?? new Date().toISOString(),
  };
}

/** Gap derivation rule: a human rejection of a machine-passing candidate maps
 *  human reasons to unmeasured signal candidates (design contract §5.5). */
export function deriveHumanMachineGap(args: {
  decision: HumanReviewDecision;
  negatives: string[];
  machine_quality: Partial<Record<QualityDimension, QualityVerdict>>;
  unmeasured_signal_candidate: string | null;
}): HumanMachineGap | null {
  if (args.decision === 'APPROVED') return null;
  if (args.unmeasured_signal_candidate) {
    return {
      human_reason: args.negatives.join('; ') || 'unspecified',
      machine_quality: args.machine_quality,
      unmeasured_signal_candidate: args.unmeasured_signal_candidate,
    };
  }
  const reasonToSignal: Record<string, string> = {
    generic: 'brand_distinction',
    weak_branding: 'brand_distinction',
    weak_hero: 'hero_effectiveness',
    too_busy: 'visual_density',
    too_sparse: 'content_richness',
  };
  for (const negative of args.negatives) {
    const signal = reasonToSignal[negative];
    if (signal) {
      return {
        human_reason: negative,
        machine_quality: args.machine_quality,
        unmeasured_signal_candidate: signal,
      };
    }
  }
  return null;
}
