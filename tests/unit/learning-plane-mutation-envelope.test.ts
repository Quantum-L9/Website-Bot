// L9_META: layer=test, role=mutation_envelope, status=active, version=1.0.0
// Determinism contract 8: forbidden-path mutation is rejected before build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateMutationPlan, assertMutationEnvelope } from '../../src/campaigns/mutation-plan.js';

function designPlan(overrides: Partial<Parameters<typeof buildCandidateMutationPlan>[0]> = {}) {
  return buildCandidateMutationPlan({
    candidate_id: 'C2',
    parent_candidate_id: 'C1',
    layer: 'DESIGN',
    target_paths: ['tokens.cta.primary.background'],
    forbidden_paths: ['WebsiteBuildBlueprint.routes', 'StructuredContentPackage'],
    unchanged_contract: ['PageContentContract'],
    primary_dimension: 'conversion.primary_cta',
    guardrail_dimensions: ['visual.hierarchy', 'accessibility.contrast'],
    expected_causal_path: ['stronger CTA distinction'],
    expected_effects: { 'conversion.primary_cta': 'IMPROVED' },
    confidence_before: 0.63,
    inherited_artifacts: {},
    experimental_control: {
      inherited_exact: [
        { artifact_type: 'WebsiteBuildBlueprint', artifact_id: 'WebsiteBuildBlueprint:wb1', payload_digest: 'wb1' },
      ],
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
    ...overrides,
  });
}

test('envelope rejects a build diff touching a forbidden path', () => {
  const plan = designPlan();
  const violations = assertMutationEnvelope(plan, [
    { path: 'WebsiteBuildBlueprint.routes', kind: 'changed' },
  ]);
  assert.ok(violations.length > 0);
});

test('envelope rejects a build diff touching an unchanged_contract member', () => {
  const plan = designPlan();
  const violations = assertMutationEnvelope(plan, [
    { path: 'PageContentContract/home.md', kind: 'changed' },
  ]);
  assert.ok(violations.length > 0);
});

test('envelope accepts a diff confined to target paths', () => {
  const plan = designPlan();
  const violations = assertMutationEnvelope(plan, [
    { path: 'tokens.cta.primary.background', kind: 'changed' },
  ]);
  assert.equal(violations.length, 0);
});

test('a path cannot be both target and forbidden', () => {
  assert.throws(() => designPlan({
    target_paths: ['tokens.cta.primary.background'],
    forbidden_paths: ['tokens.cta.primary.background'],
  }), /both target and forbidden/);
});

test('a plan without guardrails or experimental control is invalid', () => {
  assert.throws(() => designPlan({ guardrail_dimensions: [] }), /guardrail/);
  assert.throws(() => designPlan({
    experimental_control: { inherited_exact: [], changed: [] },
  }), /experimental_control/);
});
