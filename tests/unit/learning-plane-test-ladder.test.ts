// L9_META: layer=test, role=test_ladder, status=active, version=1.0.0
// Test ladder Levels 0-4: any failed level stops that challenger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateMutationPlan } from '../../src/campaigns/mutation-plan.js';
import { runTestLadder, runLevel0 } from '../../src/campaigns/test-ladder.js';
import { buildQualityDeltaIndex } from '../../src/campaigns/quality-delta-index.js';
import { buildQualityDimensionResult } from '../../src/campaigns/quality-dimension-result.js';

const PLAN = buildCandidateMutationPlan({
  candidate_id: 'C2',
  parent_candidate_id: 'C1',
  layer: 'DESIGN',
  target_paths: ['tokens.cta.primary.background'],
  forbidden_paths: ['WebsiteBuildBlueprint.routes'],
  unchanged_contract: ['PageContentContract'],
  primary_dimension: 'conversion.primary_cta',
  guardrail_dimensions: ['visual.hierarchy'],
  expected_causal_path: ['stronger CTA distinction'],
  expected_effects: { 'conversion.primary_cta': 'IMPROVED' },
  confidence_before: 0.63,
  inherited_artifacts: {},
  experimental_control: {
    inherited_exact: [{ artifact_type: 'WebsiteBuildBlueprint', artifact_id: 'WebsiteBuildBlueprint:wb1', payload_digest: 'wb1' }],
    changed: ['DesignArtifact'],
  },
  mutation_signature: {
    layer: 'DESIGN',
    archetype: 'homepage',
    component: 'hero',
    operation_class: 'INCREASE_PRIMARY_ACTION_SALIENCE',
    dimensions: { target: ['conversion.primary_cta'], guardrails: ['visual.hierarchy'] },
    context: { vertical: 'roofing', conversion_model: 'lead_generation', mobile_priority: 'high' },
  },
});

function cleanEvidence() {
  return {
    build_passed: true,
    business_facts_passed: true,
    artifact_lineage_passed: true,
    blueprint_conformance_passed: true,
    seo_content_contract_passed: true,
    forbidden_claims_present: [] as string[],
    content_slots_missing: [] as string[],
    diff: [],
    attempted_stages: [],
  };
}

const GOOD_INDEX = () => buildQualityDeltaIndex({
  campaign_id: 'fixture-001',
  candidate_id: 'C2',
  results: [
    buildQualityDimensionResult({
      dimension: 'conversion.primary_cta',
      candidate_id: 'C2',
      campaign_id: 'fixture-001',
      verdict_vs_baseline: 'IMPROVED',
      verdict_vs_champion: 'IMPROVED',
      hard_gate: true,
      status: 'PASS',
    }),
  ],
});

test('Level 0 rejects a diff touching forbidden paths before any render', () => {
  const result = runLevel0(PLAN, {
    ...cleanEvidence(),
    diff: [{ path: 'WebsiteBuildBlueprint.routes', kind: 'changed' }],
  });
  assert.equal(result.passed, false);
  assert.ok(result.notes.some(note => note.includes('forbidden path')));
});

test('Level 0 rejects a frontier violation (recomputed reused stage)', () => {
  const result = runLevel0(PLAN, {
    ...cleanEvidence(),
    attempted_stages: [{ stage: 'dataforseo', reason: 'attempted' }],
  });
  assert.equal(result.passed, false);
  assert.ok(result.notes.some(note => note.includes('frontier')));
});

test('Level 0 rejects forbidden claims', () => {
  const result = runLevel0(PLAN, {
    ...cleanEvidence(),
    forbidden_claims_present: ['unlicensed guarantee claim'],
  });
  assert.equal(result.passed, false);
});

test('a clean Level 0 passes and the ladder runs through to Level 4', async () => {
  const results = await runTestLadder({
    plan: PLAN,
    evidence: cleanEvidence(),
    index: GOOD_INDEX(),
  });
  assert.equal(results.length, 5);
  assert.ok(results.every(result => result.passed));
  assert.deepEqual(results.map(result => result.level), [0, 1, 2, 3, 4]);
});

test('a failed higher level stops the challenger immediately', async () => {
  const failingIndex = buildQualityDeltaIndex({
    campaign_id: 'fixture-001',
    candidate_id: 'C2',
    results: [
      buildQualityDimensionResult({
        dimension: 'conversion.primary_cta',
        candidate_id: 'C2',
        campaign_id: 'fixture-001',
        verdict_vs_baseline: 'IMPROVED',
        verdict_vs_champion: 'IMPROVED',
        hard_gate: true,
        status: 'FAIL',
      }),
    ],
  });
  const results = await runTestLadder({
    plan: PLAN,
    evidence: cleanEvidence(),
    index: failingIndex,
  });
  assert.equal(results.length, 2, 'Level 1 must reject and stop the ladder');
  assert.equal(results[0].passed, true);
  assert.equal(results[1].passed, false);
});
