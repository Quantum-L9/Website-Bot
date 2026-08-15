// L9_META: layer=test, role=champion_immutability, status=active, version=1.0.0
// Determinism contract 9: the champion remains immutable after a failed challenger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualityDeltaIndex } from '../../src/campaigns/quality-delta-index.js';
import { buildQualityDimensionResult } from '../../src/campaigns/quality-dimension-result.js';
import { evaluateChampionPromotion } from '../../src/campaigns/candidate-evaluation.js';

function indexFor(candidate: string, dimensions: Array<{
  dimension: string;
  verdict: 'IMPROVED' | 'REGRESSED' | 'NON_REGRESSED' | null;
  status?: 'PASS' | 'FAIL';
  hardGate?: boolean;
}>) {
  return buildQualityDeltaIndex({
    campaign_id: 'fixture-001',
    candidate_id: candidate,
    results: dimensions.map(({ dimension, verdict, status, hardGate }) => buildQualityDimensionResult({
      dimension,
      candidate_id: candidate,
      campaign_id: 'fixture-001',
      verdict_vs_baseline: verdict,
      verdict_vs_champion: verdict,
      hard_gate: hardGate ?? true,
      status: status ?? 'PASS',
    })),
  });
}

test('a challenger that fixes nothing is not promoted', () => {
  const champion = indexFor('C1', [
    { dimension: 'conversion.primary_cta', verdict: 'NON_REGRESSED' },
    { dimension: 'visual.hierarchy', verdict: 'NON_REGRESSED' },
  ]);
  const challenger = indexFor('C2', [
    { dimension: 'conversion.primary_cta', verdict: 'NON_REGRESSED' },
    { dimension: 'visual.hierarchy', verdict: 'NON_REGRESSED' },
  ]);
  const result = evaluateChampionPromotion({
    challenger,
    champion,
    target_dimension: 'conversion.primary_cta',
  });
  assert.equal(result.promote, false);
  assert.ok(result.reasons.some(reason => reason.includes('target dimension')));
});

test('a challenger with a new regression is not promoted', () => {
  const champion = indexFor('C1', [
    { dimension: 'conversion.primary_cta', verdict: 'NON_REGRESSED' },
  ]);
  const challenger = indexFor('C2', [
    { dimension: 'conversion.primary_cta', verdict: 'IMPROVED' },
    { dimension: 'accessibility.contrast', verdict: 'REGRESSED' },
  ]);
  const result = evaluateChampionPromotion({
    challenger,
    champion,
    target_dimension: 'conversion.primary_cta',
  });
  assert.equal(result.promote, false);
  assert.ok(result.reasons.some(reason => reason.includes('new blocking regression')));
});

test('a challenger that improves the target without regressions is promoted', () => {
  const champion = indexFor('C1', [
    { dimension: 'conversion.primary_cta', verdict: 'NON_REGRESSED' },
    { dimension: 'visual.hierarchy', verdict: 'NON_REGRESSED' },
  ]);
  const challenger = indexFor('C2', [
    { dimension: 'conversion.primary_cta', verdict: 'IMPROVED' },
    { dimension: 'visual.hierarchy', verdict: 'NON_REGRESSED' },
  ]);
  const result = evaluateChampionPromotion({
    challenger,
    champion,
    target_dimension: 'conversion.primary_cta',
  });
  assert.equal(result.promote, true);
  assert.deepEqual(result.reasons, []);
});

test('champion remains immutable after a failed challenger: rejection never rewrites champion refs', () => {
  const champion = indexFor('C1', [
    { dimension: 'conversion.primary_cta', verdict: 'NON_REGRESSED' },
  ]);
  const championSnapshot = JSON.stringify(champion);
  const failedChallenger = indexFor('C2', [
    { dimension: 'conversion.primary_cta', verdict: 'REGRESSED' },
  ]);
  const result = evaluateChampionPromotion({
    challenger: failedChallenger,
    champion,
    target_dimension: 'conversion.primary_cta',
  });
  assert.equal(result.promote, false);
  assert.equal(JSON.stringify(champion), championSnapshot, 'champion index must be untouched');
});
