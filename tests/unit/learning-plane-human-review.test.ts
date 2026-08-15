// L9_META: layer=test, role=human_review_receipt, status=active, version=1.0.0
// HumanReviewReceipt and HumanMachineGap: gaps propose new measurable
// dimensions, never prompt edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHumanReviewReceipt, deriveHumanMachineGap } from '../../src/campaigns/human-review.js';

test('an approval produces no human-machine gap', () => {
  const receipt = buildHumanReviewReceipt({
    receipt_id: 'r1',
    campaign_id: 'safehaven-001',
    candidate_id: 'C3',
    decision: 'APPROVED',
    positives: ['navigation', 'visual hierarchy'],
  });
  assert.equal(receipt.human_machine_gap, null);
  assert.deepEqual(receipt.positives, ['navigation', 'visual hierarchy']);
});

test('a rejection of a machine-passing candidate maps to an unmeasured signal candidate', () => {
  const receipt = buildHumanReviewReceipt({
    receipt_id: 'r2',
    campaign_id: 'safehaven-001',
    candidate_id: 'C3',
    decision: 'REJECTED',
    negatives: ['generic'],
    machine_quality: {
      'visual.hierarchy': 'IMPROVED',
      'conversion.primary_cta': 'IMPROVED',
      'accessibility.contrast': 'NON_REGRESSED',
    },
  });
  assert.ok(receipt.human_machine_gap);
  assert.equal(receipt.human_machine_gap?.unmeasured_signal_candidate, 'brand_distinction');
});

test('an explicit unmeasured signal is preserved verbatim', () => {
  const gap = deriveHumanMachineGap({
    decision: 'REJECTED',
    negatives: ['too_busy'],
    machine_quality: {},
    unmeasured_signal_candidate: 'brand.distinction',
  });
  assert.equal(gap?.unmeasured_signal_candidate, 'brand.distinction');
});

test('unknown tags are rejected', () => {
  assert.throws(() => buildHumanReviewReceipt({
    receipt_id: 'r3',
    campaign_id: 'safehaven-001',
    candidate_id: 'C3',
    decision: 'APPROVED',
    tags: ['not-a-tag' as never],
  }), /unknown review tag/);
});
